mod store;

use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

/// Everything lives in ~/.local/share/dev.zornote.app/
///   zornote.db          – the notebooks (SQLite)
///   backups/            – one dated copy per day, newest 30 kept
///   notebooks.json      – the old store; imported once on first start and left untouched
struct Db {
    conn: Mutex<Connection>,
    dir: PathBuf,
}

impl Db {
    fn backups(&self) -> PathBuf {
        self.dir.join("backups")
    }
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn lock<'a>(db: &'a State<'a, Db>) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    db.conn.lock().map_err(|_| "database is busy".to_string())
}

#[tauri::command]
fn load_data(db: State<Db>) -> Result<Option<String>, String> {
    let conn = lock(&db)?;
    match store::load(&conn)? {
        Some(data) => serde_json::to_string(&data).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

/// `tree`: the whole notebook tree as JSON (page contents may be left empty);
/// `changed`: only the pages whose HTML changed since the last save.
#[tauri::command]
fn save_changes(db: State<Db>, tree: String, changed: Vec<store::PageContent>) -> Result<(), String> {
    let data: store::AppData = serde_json::from_str(&tree).map_err(|e| e.to_string())?;
    let mut conn = lock(&db)?;
    store::save(&mut conn, &data, &changed)?;
    // ZorNote may stay open for days: write the day's backup on the first save of a new day
    let _ = store::backup_if_due(&conn, &db.backups(), &today());
    Ok(())
}

#[tauri::command]
fn list_versions(db: State<Db>, page_id: String) -> Result<Vec<store::VersionInfo>, String> {
    store::list_versions(&*lock(&db)?, &page_id)
}

#[tauri::command]
fn list_deleted(db: State<Db>) -> Result<Vec<store::VersionInfo>, String> {
    store::list_deleted(&*lock(&db)?)
}

#[tauri::command]
fn get_version(db: State<Db>, id: i64) -> Result<String, String> {
    store::get_version(&*lock(&db)?, id)
}

#[tauri::command]
fn snapshot_page(db: State<Db>, page_id: String) -> Result<(), String> {
    store::snapshot(&*lock(&db)?, &page_id, "before restore")
}

#[tauri::command]
fn backup_now(db: State<Db>) -> Result<String, String> {
    let conn = lock(&db)?;
    let name = format!("zornote-{}.db", chrono::Local::now().format("%Y-%m-%d-%H%M%S"));
    let target = db.backups().join(name);
    store::backup_to(&conn, &target)?;
    store::prune_backups(&db.backups())?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_backups(db: State<Db>) -> Vec<store::BackupInfo> {
    store::list_backups(&db.backups())
}

#[tauri::command]
fn open_data_folder(app: AppHandle, db: State<Db>, backups: bool) -> Result<(), String> {
    let path = if backups { db.backups() } else { db.dir.clone() };
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn data_location(db: State<Db>) -> String {
    db.dir.join("zornote.db").to_string_lossy().into_owned()
}

/// Font families really installed on this computer (from fontconfig), so the Font list can say which are missing.
#[tauri::command]
fn installed_fonts() -> Vec<String> {
    let out = std::process::Command::new("fc-list").args([":", "family"]).output();
    let mut v: Vec<String> = match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout)
            .lines()
            .flat_map(|l| l.split(',').map(|f| f.trim().to_string()).collect::<Vec<_>>())
            .filter(|f| !f.is_empty())
            .collect(),
        Err(_) => Vec::new(),
    };
    v.sort();
    v.dedup();
    v
}

/// Export the page shown in the window to a PDF file (A4), without a print dialog.
/// The page's own print styles hide everything but the title, date and content.
/// Emits "pdf-export" with "ok" or an error message when done.
#[tauri::command]
fn export_pdf(app: AppHandle, path: String, landscape: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use tauri::Emitter;
        let win = app.get_webview_window("main").ok_or("no window")?;
        let uri = gtk::glib::filename_to_uri(&path, None).map_err(|e| e.to_string())?.to_string();
        let app2 = app.clone();
        win.with_webview(move |wv| {
            use webkit2gtk::PrintOperationExt;
            let op = webkit2gtk::PrintOperation::new(&wv.inner());
            let settings = gtk::PrintSettings::new();
            settings.set_printer("Print to File");
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(&uri));
            let orient = if landscape { gtk::PageOrientation::Landscape } else { gtk::PageOrientation::Portrait };
            settings.set_orientation(orient);
            let setup = gtk::PageSetup::new();
            setup.set_paper_size(&gtk::PaperSize::new(Some(&gtk::PAPER_NAME_A4)));
            setup.set_orientation(orient);
            setup.set_top_margin(10.0, gtk::Unit::Mm);
            setup.set_bottom_margin(10.0, gtk::Unit::Mm);
            setup.set_left_margin(10.0, gtk::Unit::Mm);
            setup.set_right_margin(10.0, gtk::Unit::Mm);
            op.set_print_settings(&settings);
            op.set_page_setup(&setup);
            let done = app2.clone();
            op.connect_finished(move |_| { let _ = done.emit("pdf-export", "ok"); });
            let fail = app2.clone();
            op.connect_failed(move |_, err| { let _ = fail.emit("pdf-export", err.to_string()); });
            op.print();
        })
        .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, path, landscape);
        Err("PDF export is only available on Linux".into())
    }
}

/// Open a web or mail link in the default browser / mail app (only http, https and mailto).
#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")) {
        return Err("only web and mail links can be opened".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// The system Print dialog (also offers "Print to File" → PDF).
#[tauri::command]
fn print_page(app: AppHandle) -> Result<(), String> {
    let win = app.get_webview_window("main").ok_or("no window")?;
    win.print().map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

fn open_db(app: &AppHandle) -> Result<Db, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut conn = store::open(&dir.join("zornote.db"))?;
    store::migrate_from_json(&mut conn, &dir.join("notebooks.json"))?;
    let _ = store::backup_if_due(&conn, &dir.join("backups"), &today());
    Ok(Db { conn: Mutex::new(conn), dir })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db = open_db(app.handle()).map_err(|e| format!("could not open the ZorNote database: {e}"))?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_changes,
            list_versions,
            list_deleted,
            get_version,
            snapshot_page,
            backup_now,
            list_backups,
            open_data_folder,
            data_location,
            installed_fonts,
            export_pdf,
            open_url,
            print_page,
            write_text_file,
            read_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running ZorNote");
}
