//! ZorNote storage: one SQLite database (`zornote.db`).
//!
//! * The notebook tree (notebooks → section groups → sections → pages) lives in small tables.
//! * Each page's HTML is a row of its own; a save only rewrites the pages that changed.
//! * Pasted images are pulled out of the HTML and stored once (by SHA-256) in `images`;
//!   the page keeps a short `zn-img:<hash>` reference that is turned back into the image on load.
//! * Before a page is overwritten, its previous content is kept in `page_versions`
//!   (at most one snapshot per page every 10 minutes). Deleted pages are kept there too.
//! * `backup_if_due` writes a dated copy (`backups/zornote-YYYY-MM-DD.db`) once a day and keeps the newest 30.
//! * On first start, an existing `notebooks.json` is imported; the JSON file is left untouched.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const VERSION_EVERY_MS: i64 = 10 * 60 * 1000;
pub const KEEP_BACKUPS: usize = 30;
const IMG_TOKEN: &str = "zn-img:";

/* ---------------------------------------------------------------- model (mirrors src/lib/types.ts) */

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collapsed: Option<bool>,
    #[serde(default)]
    pub created_at: f64,
    #[serde(default)]
    pub updated_at: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Section {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub pages: Vec<Page>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Group {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub sections: Vec<Section>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Notebook {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub sections: Vec<Section>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub groups: Option<Vec<Group>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppData {
    pub version: i64,
    pub notebooks: Vec<Notebook>,
    #[serde(default)]
    pub selection: serde_json::Value,
}

/// A page whose HTML changed since the last save.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PageContent {
    pub id: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub id: i64,
    pub page_id: String,
    pub saved_at: i64,
    pub title: String,
    pub reason: String,
    pub size: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
}

/* ---------------------------------------------------------------- helpers */

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn e<T: std::fmt::Display>(err: T) -> String {
    err.to_string()
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta      (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notebooks (id TEXT PRIMARY KEY, name TEXT NOT NULL, ord INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS groups    (id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL, name TEXT NOT NULL, ord INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sections  (id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL, group_id TEXT,
                                      name TEXT NOT NULL, color TEXT NOT NULL, ord INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pages     (id TEXT PRIMARY KEY, section_id TEXT NOT NULL, title TEXT NOT NULL,
                                      level INTEGER, collapsed INTEGER, ord INTEGER NOT NULL,
                                      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                                      content TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS images    (hash TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS page_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, page_id TEXT NOT NULL,
                                      saved_at INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
                                      reason TEXT NOT NULL DEFAULT 'edit', section_id TEXT);
CREATE INDEX IF NOT EXISTS pages_section   ON pages(section_id, ord);
CREATE INDEX IF NOT EXISTS versions_page   ON page_versions(page_id, saved_at);
"#;

/// Open (or create) the database and make sure the tables exist.
pub fn open(db_path: &Path) -> Result<Connection, String> {
    if let Some(dir) = db_path.parent() {
        fs::create_dir_all(dir).map_err(e)?;
    }
    let conn = Connection::open(db_path).map_err(e)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;",
    )
    .map_err(e)?;
    conn.execute_batch(SCHEMA).map_err(e)?;
    Ok(conn)
}

fn meta_get(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0))
        .optional()
        .map_err(e)
}

fn meta_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )
    .map(|_| ())
    .map_err(e)
}

/* ---------------------------------------------------------------- images */

fn is_b64(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'+' || c == b'/' || c == b'='
}

/// Move every `data:image/...;base64,...` in the HTML into the images table, leaving `zn-img:<hash>`.
fn extract_images(conn: &Connection, html: &str) -> Result<String, String> {
    if !html.contains("data:image/") {
        return Ok(html.to_string());
    }
    let bytes = html.as_bytes();
    let mut out = String::with_capacity(html.len() / 4);
    let mut i = 0;
    let mut last = 0;
    while let Some(off) = html[i..].find("data:image/") {
        let start = i + off;
        let rest = &html[start..];
        let Some(semi) = rest.find(";base64,") else { break };
        let mime = &rest[5..semi];
        // a real mime type is short and has no quotes/spaces
        if mime.len() > 40 || mime.contains(|c: char| c == '"' || c == '\'' || c.is_whitespace()) {
            i = start + 11;
            continue;
        }
        let data_start = start + semi + 8;
        let mut j = data_start;
        while j < bytes.len() && is_b64(bytes[j]) {
            j += 1;
        }
        let b64 = &html[data_start..j];
        match B64.decode(b64) {
            Ok(raw) if !raw.is_empty() => {
                let hash = hex(&Sha256::digest(&raw));
                conn.execute(
                    "INSERT OR IGNORE INTO images(hash,mime,data,created_at) VALUES(?1,?2,?3,?4)",
                    params![hash, mime, raw, now_ms()],
                )
                .map_err(e)?;
                out.push_str(&html[last..start]);
                out.push_str(IMG_TOKEN);
                out.push_str(&hash);
                last = j;
            }
            _ => {} // not decodable: leave it in the page as it is
        }
        i = j.max(start + 11);
    }
    out.push_str(&html[last..]);
    Ok(out)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Turn `zn-img:<hash>` references back into data URIs.
fn inline_images(conn: &Connection, html: &str, cache: &mut HashMap<String, String>) -> Result<String, String> {
    if !html.contains(IMG_TOKEN) {
        return Ok(html.to_string());
    }
    let mut out = String::with_capacity(html.len() * 2);
    let mut rest = html;
    while let Some(off) = rest.find(IMG_TOKEN) {
        out.push_str(&rest[..off]);
        let after = &rest[off + IMG_TOKEN.len()..];
        let hash: String = after.chars().take(64).collect();
        if hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
            if !cache.contains_key(&hash) {
                let row: Option<(String, Vec<u8>)> = conn
                    .query_row("SELECT mime,data FROM images WHERE hash=?1", [&hash], |r| Ok((r.get(0)?, r.get(1)?)))
                    .optional()
                    .map_err(e)?;
                let uri = match row {
                    Some((mime, data)) => format!("data:{};base64,{}", mime, B64.encode(data)),
                    None => String::new(), // image missing: leave an empty src rather than a broken token
                };
                cache.insert(hash.clone(), uri);
            }
            out.push_str(&cache[&hash]);
            rest = &after[64..];
        } else {
            out.push_str(IMG_TOKEN);
            rest = after;
        }
    }
    out.push_str(rest);
    Ok(out)
}

/* ---------------------------------------------------------------- load */

pub fn load(conn: &Connection) -> Result<Option<AppData>, String> {
    let mut nbs: Vec<Notebook> = Vec::new();
    {
        let mut st = conn.prepare("SELECT id,name FROM notebooks ORDER BY ord").map_err(e)?;
        let rows = st
            .query_map([], |r| Ok(Notebook { id: r.get(0)?, name: r.get(1)?, ..Default::default() }))
            .map_err(e)?;
        for r in rows {
            nbs.push(r.map_err(e)?);
        }
    }
    if nbs.is_empty() {
        return Ok(None);
    }

    // pages by section
    let mut cache = HashMap::new();
    let mut pages: HashMap<String, Vec<Page>> = HashMap::new();
    {
        let mut st = conn
            .prepare("SELECT id,section_id,title,level,collapsed,created_at,updated_at,content FROM pages ORDER BY section_id, ord")
            .map_err(e)?;
        let mut rows = st.query([]).map_err(e)?;
        while let Some(r) = rows.next().map_err(e)? {
            let section: String = r.get(1).map_err(e)?;
            let content: String = r.get(7).map_err(e)?;
            let collapsed: Option<i64> = r.get(4).map_err(e)?;
            let p = Page {
                id: r.get(0).map_err(e)?,
                title: r.get(2).map_err(e)?,
                level: r.get(3).map_err(e)?,
                collapsed: collapsed.map(|c| c != 0),
                created_at: r.get::<_, i64>(5).map_err(e)? as f64,
                updated_at: r.get::<_, i64>(6).map_err(e)? as f64,
                content: inline_images(conn, &content, &mut cache)?,
            };
            pages.entry(section).or_default().push(p);
        }
    }

    // sections, then groups
    let mut sec_by_owner: HashMap<(String, Option<String>), Vec<Section>> = HashMap::new();
    {
        let mut st = conn.prepare("SELECT id,notebook_id,group_id,name,color FROM sections ORDER BY ord").map_err(e)?;
        let mut rows = st.query([]).map_err(e)?;
        while let Some(r) = rows.next().map_err(e)? {
            let id: String = r.get(0).map_err(e)?;
            let s = Section {
                pages: pages.remove(&id).unwrap_or_default(),
                id,
                name: r.get(3).map_err(e)?,
                color: r.get(4).map_err(e)?,
            };
            sec_by_owner
                .entry((r.get(1).map_err(e)?, r.get(2).map_err(e)?))
                .or_default()
                .push(s);
        }
    }
    let mut groups_by_nb: HashMap<String, Vec<Group>> = HashMap::new();
    {
        let mut st = conn.prepare("SELECT id,notebook_id,name FROM groups ORDER BY ord").map_err(e)?;
        let mut rows = st.query([]).map_err(e)?;
        while let Some(r) = rows.next().map_err(e)? {
            let id: String = r.get(0).map_err(e)?;
            let nb: String = r.get(1).map_err(e)?;
            let g = Group {
                sections: sec_by_owner.remove(&(nb.clone(), Some(id.clone()))).unwrap_or_default(),
                id,
                name: r.get(2).map_err(e)?,
            };
            groups_by_nb.entry(nb).or_default().push(g);
        }
    }
    for nb in nbs.iter_mut() {
        nb.sections = sec_by_owner.remove(&(nb.id.clone(), None)).unwrap_or_default();
        nb.groups = groups_by_nb.remove(&nb.id);
    }

    let selection = meta_get(conn, "selection")?
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null);
    Ok(Some(AppData { version: 1, notebooks: nbs, selection }))
}

/* ---------------------------------------------------------------- save */

/// Save the tree (`data`, page contents ignored) plus the HTML of the pages listed in `changed`.
/// Pages that are no longer in the tree are deleted (a copy is kept in page_versions).
pub fn save(conn: &mut Connection, data: &AppData, changed: &[PageContent]) -> Result<(), String> {
    if data.notebooks.is_empty() {
        return Err("refusing to save an empty notebook list".into());
    }
    let now = now_ms();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;

    tx.execute_batch("DELETE FROM notebooks; DELETE FROM groups; DELETE FROM sections;").map_err(e)?;
    let mut keep: HashSet<String> = HashSet::new();
    let mut titles: HashMap<String, (String, String)> = HashMap::new(); // page id -> (title, section)
    {
        let mut ins_nb = tx.prepare("INSERT INTO notebooks(id,name,ord) VALUES(?1,?2,?3)").map_err(e)?;
        let mut ins_gr = tx.prepare("INSERT INTO groups(id,notebook_id,name,ord) VALUES(?1,?2,?3,?4)").map_err(e)?;
        let mut ins_sec = tx
            .prepare("INSERT OR REPLACE INTO sections(id,notebook_id,group_id,name,color,ord) VALUES(?1,?2,?3,?4,?5,?6)")
            .map_err(e)?;
        let mut up_page = tx
            .prepare(
                "INSERT INTO pages(id,section_id,title,level,collapsed,ord,created_at,updated_at,content)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'')
                 ON CONFLICT(id) DO UPDATE SET section_id=excluded.section_id, title=excluded.title,
                   level=excluded.level, collapsed=excluded.collapsed, ord=excluded.ord,
                   created_at=excluded.created_at, updated_at=excluded.updated_at",
            )
            .map_err(e)?;

        let mut sec_ord = 0i64;
        let mut put_sections = |nb: &str, group: Option<&str>, secs: &[Section]| -> Result<(), String> {
            for s in secs {
                ins_sec.execute(params![s.id, nb, group, s.name, s.color, sec_ord]).map_err(e)?;
                sec_ord += 1;
                for (i, p) in s.pages.iter().enumerate() {
                    up_page
                        .execute(params![
                            p.id,
                            s.id,
                            p.title,
                            p.level,
                            p.collapsed.map(|c| c as i64),
                            i as i64,
                            p.created_at as i64,
                            p.updated_at as i64
                        ])
                        .map_err(e)?;
                    keep.insert(p.id.clone());
                    titles.insert(p.id.clone(), (p.title.clone(), s.id.clone()));
                }
            }
            Ok(())
        };
        for (ni, nb) in data.notebooks.iter().enumerate() {
            ins_nb.execute(params![nb.id, nb.name, ni as i64]).map_err(e)?;
            put_sections(&nb.id, None, &nb.sections)?;
            if let Some(groups) = &nb.groups {
                for (gi, g) in groups.iter().enumerate() {
                    ins_gr.execute(params![g.id, nb.id, g.name, gi as i64]).map_err(e)?;
                    put_sections(&nb.id, Some(&g.id), &g.sections)?;
                }
            }
        }
    }

    // page contents
    for pc in changed {
        if !keep.contains(&pc.id) {
            continue;
        }
        let html = extract_images(&tx, &pc.content)?;
        let old: Option<String> = tx
            .query_row("SELECT content FROM pages WHERE id=?1", [&pc.id], |r| r.get(0))
            .optional()
            .map_err(e)?;
        if old.as_deref() == Some(html.as_str()) {
            continue;
        }
        if let Some(old) = old.filter(|o| !o.is_empty()) {
            let last: Option<i64> = tx
                .query_row("SELECT MAX(saved_at) FROM page_versions WHERE page_id=?1", [&pc.id], |r| r.get(0))
                .map_err(e)?;
            if last.map_or(true, |t| now - t >= VERSION_EVERY_MS) {
                let (title, sec) = titles.get(&pc.id).cloned().unwrap_or_default();
                tx.execute(
                    "INSERT INTO page_versions(page_id,saved_at,title,content,reason,section_id) VALUES(?1,?2,?3,?4,'edit',?5)",
                    params![pc.id, now, title, old, sec],
                )
                .map_err(e)?;
            }
        }
        tx.execute("UPDATE pages SET content=?2 WHERE id=?1", params![pc.id, html]).map_err(e)?;
    }

    // deleted pages: keep a copy, then remove
    let gone: Vec<(String, String, String, String)> = {
        let mut st = tx.prepare("SELECT id,title,content,section_id FROM pages").map_err(e)?;
        let rows = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(e)?;
        let mut v = Vec::new();
        for r in rows {
            let r: (String, String, String, String) = r.map_err(e)?;
            if !keep.contains(&r.0) {
                v.push(r);
            }
        }
        v
    };
    for (id, title, content, sec) in gone {
        tx.execute(
            "INSERT INTO page_versions(page_id,saved_at,title,content,reason,section_id) VALUES(?1,?2,?3,?4,'deleted',?5)",
            params![id, now, title, content, sec],
        )
        .map_err(e)?;
        tx.execute("DELETE FROM pages WHERE id=?1", [&id]).map_err(e)?;
    }

    meta_set(&tx, "selection", &data.selection.to_string())?;
    tx.commit().map_err(e)
}

/// Save everything (used for the first import).
pub fn save_all(conn: &mut Connection, data: &AppData) -> Result<(), String> {
    let mut changed = Vec::new();
    let mut add = |secs: &[Section]| {
        for s in secs {
            for p in &s.pages {
                changed.push(PageContent { id: p.id.clone(), content: p.content.clone() });
            }
        }
    };
    for nb in &data.notebooks {
        add(&nb.sections);
        for g in nb.groups.iter().flatten() {
            add(&g.sections);
        }
    }
    save(conn, data, &changed)
}

/* ---------------------------------------------------------------- first start: import notebooks.json */

/// If the database is new and `notebooks.json` (or its .bak) exists, import it. Returns true when imported.
pub fn migrate_from_json(conn: &mut Connection, json_path: &Path) -> Result<bool, String> {
    if meta_get(conn, "initialized")?.is_some() {
        return Ok(false);
    }
    let has_data: i64 = conn.query_row("SELECT COUNT(*) FROM notebooks", [], |r| r.get(0)).map_err(e)?;
    let mut imported = false;
    if has_data == 0 {
        let candidates = [json_path.to_path_buf(), json_path.with_extension("json.bak")];
        for p in candidates.iter().filter(|p| p.exists()) {
            let Ok(text) = fs::read_to_string(p) else { continue };
            let Ok(data) = serde_json::from_str::<AppData>(&text) else { continue };
            if data.notebooks.is_empty() {
                continue;
            }
            save_all(conn, &data)?;
            meta_set(conn, "migrated_from", &p.to_string_lossy())?;
            imported = true;
            break;
        }
    }
    meta_set(conn, "initialized", &now_ms().to_string())?;
    Ok(imported)
}

/* ---------------------------------------------------------------- page versions */

pub fn list_versions(conn: &Connection, page_id: &str) -> Result<Vec<VersionInfo>, String> {
    let mut st = conn
        .prepare(
            "SELECT id,page_id,saved_at,title,reason,length(content) FROM page_versions
             WHERE page_id=?1 ORDER BY saved_at DESC, id DESC",
        )
        .map_err(e)?;
    let rows = st
        .query_map([page_id], |r| {
            Ok(VersionInfo {
                id: r.get(0)?,
                page_id: r.get(1)?,
                saved_at: r.get(2)?,
                title: r.get(3)?,
                reason: r.get(4)?,
                size: r.get(5)?,
            })
        })
        .map_err(e)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(e)
}

/// Pages that were deleted (newest first), so they can be brought back.
pub fn list_deleted(conn: &Connection) -> Result<Vec<VersionInfo>, String> {
    let mut st = conn
        .prepare(
            "SELECT id,page_id,saved_at,title,reason,length(content) FROM page_versions
             WHERE reason='deleted' AND page_id NOT IN (SELECT id FROM pages)
             ORDER BY saved_at DESC LIMIT 200",
        )
        .map_err(e)?;
    let rows = st
        .query_map([], |r| {
            Ok(VersionInfo {
                id: r.get(0)?,
                page_id: r.get(1)?,
                saved_at: r.get(2)?,
                title: r.get(3)?,
                reason: r.get(4)?,
                size: r.get(5)?,
            })
        })
        .map_err(e)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(e)
}

/// Keep the page's current content as a version right now (used before restoring an older version).
pub fn snapshot(conn: &Connection, page_id: &str, reason: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO page_versions(page_id,saved_at,title,content,reason,section_id)
         SELECT id, ?2, title, content, ?3, section_id FROM pages WHERE id=?1 AND content<>''",
        params![page_id, now_ms(), reason],
    )
    .map(|_| ())
    .map_err(e)
}

pub fn get_version(conn: &Connection, id: i64) -> Result<String, String> {
    let html: String = conn
        .query_row("SELECT content FROM page_versions WHERE id=?1", [id], |r| r.get(0))
        .map_err(e)?;
    inline_images(conn, &html, &mut HashMap::new())
}

/* ---------------------------------------------------------------- backups */

fn backup_files(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|d| d.ok().map(|d| d.path()))
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .map_or(false, |n| n.starts_with("zornote-") && n.ends_with(".db"))
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

/// Write a consistent copy of the database (safe while ZorNote is running).
pub fn backup_to(conn: &Connection, target: &Path) -> Result<(), String> {
    if let Some(dir) = target.parent() {
        fs::create_dir_all(dir).map_err(e)?;
    }
    let tmp = target.with_extension("db.part");
    let _ = fs::remove_file(&tmp);
    conn.execute("VACUUM INTO ?1", [tmp.to_string_lossy()]).map_err(e)?;
    fs::rename(&tmp, target).map_err(e)
}

/// Remove images nothing refers to any more, and thin out very old page versions.
pub fn tidy(conn: &Connection) -> Result<(), String> {
    let cutoff = now_ms() - 90 * 24 * 3600 * 1000;
    conn.execute(
        "DELETE FROM page_versions WHERE saved_at < ?1 AND reason='edit' AND id NOT IN (
           SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY page_id ORDER BY saved_at DESC) AS n
                           FROM page_versions WHERE reason='edit') WHERE n <= 10)",
        [cutoff],
    )
    .map_err(e)?;
    conn.execute(
        "DELETE FROM images WHERE
           NOT EXISTS (SELECT 1 FROM pages WHERE instr(content, images.hash) > 0) AND
           NOT EXISTS (SELECT 1 FROM page_versions WHERE instr(content, images.hash) > 0)",
        [],
    )
    .map_err(e)?;
    Ok(())
}

/// Once a day: tidy up and write `backups/zornote-<date>.db`; keep the newest `KEEP_BACKUPS`.
/// Returns the path written, if any.
pub fn backup_if_due(conn: &Connection, dir: &Path, date: &str) -> Result<Option<PathBuf>, String> {
    let target = dir.join(format!("zornote-{}.db", date));
    if target.exists() {
        return Ok(None);
    }
    tidy(conn)?;
    backup_to(conn, &target)?;
    prune_backups(dir)?;
    Ok(Some(target))
}

pub fn prune_backups(dir: &Path) -> Result<(), String> {
    let files = backup_files(dir);
    if files.len() > KEEP_BACKUPS {
        for p in &files[..files.len() - KEEP_BACKUPS] {
            let _ = fs::remove_file(p);
        }
    }
    Ok(())
}

pub fn list_backups(dir: &Path) -> Vec<BackupInfo> {
    let mut v: Vec<BackupInfo> = backup_files(dir)
        .into_iter()
        .map(|p| BackupInfo {
            name: p.file_name().unwrap_or_default().to_string_lossy().into_owned(),
            size: fs::metadata(&p).map(|m| m.len()).unwrap_or(0),
            path: p.to_string_lossy().into_owned(),
        })
        .collect();
    v.reverse();
    v
}
