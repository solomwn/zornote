import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import logo from "./assets/logo.svg";
import Editor, { applyViewPrefs, loadSystemFonts, type RibbonActions } from "./components/Editor";
import { AskHost, ask } from "./components/Ask";
import type { AppData, Group, Notebook, Page, Section, Selection } from "./lib/types";
import {
  duplicateGroupStructure, isTauri, loadData, newGroup, newNotebook, newPage, newSection,
  readTextFile, saveData,
  listVersions, listDeleted, getVersion, snapshotPage, backupNow, openDataFolder, dataLocation,
  type VersionInfo,
} from "./lib/storage";
import { exportPdf, notebookToMarkdown, pageToHtml, pageToMarkdown, printPage, safeName, saveFile } from "./lib/export";
import { importRemoteNotebook, listRemoteNotebooks } from "./lib/graph";

type CtxItem = { label: string; onClick: () => void; danger?: boolean };

const stripHtml = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const lvl = (p: Page) => p.level ?? 0;
/** Index just past a page and all of its descendants. */
const blockEnd = (pages: Page[], i: number) => {
  let e = i + 1;
  while (e < pages.length && lvl(pages[e]) > lvl(pages[i])) e++;
  return e;
};

const allSections = (nb: Notebook) => [...nb.sections, ...(nb.groups ?? []).flatMap((g) => g.sections)];

/** Selection pointing at the first section found in a notebook. */
function firstLoc(nb: Notebook): Selection {
  if (nb.sections[0]) {
    const s = nb.sections[0];
    return { notebookId: nb.id, sectionId: s.id, pageId: s.pages[0].id };
  }
  const g = nb.groups?.find((x) => x.sections.length);
  const s = g!.sections[0];
  return { notebookId: nb.id, groupId: g!.id, sectionId: s.id, pageId: s.pages[0].id };
}

/** Work out what is currently selected, falling back gracefully if something was deleted. */
function resolve(d: AppData) {
  const nb = d.notebooks.find((n) => n.id === d.selection.notebookId) ?? d.notebooks[0];
  let group: Group | undefined = nb.groups?.find((g) => g.id === d.selection.groupId);
  let section = (group ? group.sections : nb.sections).find((s) => s.id === d.selection.sectionId);
  if (!section) {
    group = undefined;
    section = nb.sections[0];
    if (!section) {
      group = nb.groups?.find((g) => g.sections.length);
      section = group?.sections[0];
    }
  }
  const page = section?.pages.find((p) => p.id === d.selection.pageId) ?? section?.pages[0];
  return { notebook: nb, group, section, page };
}

/** Apply a change to the section list of one container (the notebook root, or one group). */
function mapContainer(d: AppData, nbId: string, groupId: string | undefined, fn: (s: Section[]) => Section[]): AppData {
  return {
    ...d,
    notebooks: d.notebooks.map((n) => {
      if (n.id !== nbId) return n;
      if (!groupId) return { ...n, sections: fn(n.sections) };
      return { ...n, groups: (n.groups ?? []).map((g) => (g.id === groupId ? { ...g, sections: fn(g.sections) } : g)) };
    }),
  };
}

const mapGroups = (d: AppData, nbId: string, fn: (g: Group[]) => Group[]): AppData => ({
  ...d,
  notebooks: d.notebooks.map((n) => (n.id === nbId ? { ...n, groups: fn(n.groups ?? []) } : n)),
});

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sortMenu, setSortMenu] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; items: CtxItem[] } | null>(null);
  const [fullPage, setFullPage] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; after: boolean } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const addPageRef = useRef<(sub: boolean) => void>(() => {});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const saveTimer = useRef<number | undefined>(undefined);
  const [history, setHistory] = useState<null | { page?: Page }>(null); // page → its versions; no page → deleted pages
  const [editorRev, setEditorRev] = useState(0);
  const [note, setNote] = useState("");
  const [showTags, setShowTags] = useState(false);
  const [dragTab, setDragTab] = useState<string | null>(null);
  const [tabDrop, setTabDrop] = useState<{ id: string; before: boolean } | null>(null);
  const colorInput = useRef<HTMLInputElement>(null);
  const [colorFor, setColorFor] = useState<{ nb: string; g?: string; s: string } | null>(null);

  useEffect(() => { applyViewPrefs(); if (isTauri()) void loadSystemFonts(); }, []);
  useEffect(() => { loadData().then(setData); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setCtx(null); setFullPage(false); }
      const k = e.key.toLowerCase();
      if (e.ctrlKey && !e.altKey && !e.shiftKey && k === "n") { e.preventDefault(); addPageRef.current(false); }
      if (e.ctrlKey && e.altKey && e.shiftKey && k === "n") { e.preventDefault(); addPageRef.current(true); }
      if (e.ctrlKey && !e.altKey && !e.shiftKey && k === "e") { e.preventDefault(); setFullPage(false); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Debounced autosave
  const persist = useCallback((d: AppData) => {
    setSaved(false);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await saveData(d);
        setSaved(true);
      } catch (err) {
        // stays "unsaved"; the next change retries (pages not written are sent again)
        console.error("Save failed", err);
      }
    }, 500);
  }, []);

  const flash = (msg: string) => { setNote(msg); window.setTimeout(() => setNote(""), 5000); };

  const update = useCallback((fn: (d: AppData) => AppData) => {
    setData((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      persist(next);
      return next;
    });
  }, [persist]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return [];
    const hits: { sel: Selection; path: string; title: string; snippet: string }[] = [];
    const scan = (nb: Notebook, g: Group | undefined, secs: Section[]) => {
      for (const s of secs)
        for (const p of s.pages) {
          const text = stripHtml(p.content);
          const i = text.toLowerCase().indexOf(q);
          if (p.title.toLowerCase().includes(q) || i >= 0) {
            hits.push({
              sel: { notebookId: nb.id, groupId: g?.id, sectionId: s.id, pageId: p.id },
              path: [nb.name, g?.name, s.name].filter(Boolean).join(" › "),
              title: p.title,
              snippet: i >= 0 ? text.slice(Math.max(0, i - 30), i + 70) : "",
            });
          }
        }
    };
    for (const nb of data.notebooks) {
      scan(nb, undefined, nb.sections);
      for (const g of nb.groups ?? []) scan(nb, g, g.sections);
    }
    return hits.slice(0, 50);
  }, [query, data]);

  if (!data) return <div className="loading">Loading…</div>;
  const { notebook, group, section, page } = resolve(data);
  if (!section || !page) return <div className="loading">This notebook has no sections.</div>;
  const sections = group ? group.sections : notebook.sections;

  const selectLoc = (s: Selection) => update((d) => ({ ...d, selection: s }));
  const select = (sectionId: string, pageId: string) =>
    selectLoc({ notebookId: notebook.id, groupId: group?.id, sectionId, pageId });

  const isOpen = (id: string, dflt: boolean) => open[id] ?? dflt;
  const toggle = (id: string, cur: boolean) => setOpen((o) => ({ ...o, [id]: !cur }));

  const mutateContainer = (fn: (s: Section[]) => Section[]) =>
    update((d) => mapContainer(d, notebook.id, group?.id, fn));

  const mutateSection = (fn: (s: Section) => Section) =>
    mutateContainer((secs) => secs.map((s) => (s.id === section.id ? fn(s) : s)));

  const updatePage = (patch: Partial<Page>) =>
    mutateSection((s) => ({
      ...s,
      pages: s.pages.map((p) => (p.id === page.id ? { ...p, ...patch, updatedAt: Date.now() } : p)),
    }));

  // ---------- pages ----------
  const addPage = (sub = false) => {
    const i = section.pages.findIndex((x) => x.id === page.id);
    const p = newPage();
    if (sub && lvl(page) < 2) {
      p.level = lvl(page) + 1;
      const at = blockEnd(section.pages, i);
      mutateSection((s) => ({
        ...s,
        pages: [...s.pages.slice(0, at), p, ...s.pages.slice(at)].map((x) =>
          x.id === page.id ? { ...x, collapsed: false } : x
        ),
      }));
    } else {
      mutateSection((s) => ({ ...s, pages: [...s.pages, p] }));
    }
    update((d) => ({ ...d, selection: { ...d.selection, pageId: p.id } }));
    setTimeout(() => { const el = document.querySelector<HTMLInputElement>(".title"); el?.focus(); el?.select(); }, 60);
  };
  addPageRef.current = addPage;

  const setLevel = (dir: 1 | -1, target: Page = page) => {
    const i = section.pages.findIndex((x) => x.id === target.id);
    const prev = section.pages[i - 1];
    const max = prev ? Math.min(2, lvl(prev) + 1) : 0;
    const next = Math.max(0, Math.min(max, lvl(target) + dir));
    if (next === lvl(target)) return;
    const delta = next - lvl(target);
    const end = blockEnd(section.pages, i);
    mutateSection((s) => ({
      ...s,
      pages: s.pages.map((x, idx) =>
        idx >= i && idx < end ? { ...x, level: Math.max(0, Math.min(2, lvl(x) + delta)) } : x
      ),
    }));
  };

  const toggleCollapse = (id: string) =>
    mutateSection((s) => ({ ...s, pages: s.pages.map((x) => (x.id === id ? { ...x, collapsed: !x.collapsed } : x)) }));

  const sortPages = (mode: "title" | "created" | "modified") => {
    setSortMenu(false);
    const blocks: Page[][] = [];
    section.pages.forEach((p) => {
      if (lvl(p) === 0 || blocks.length === 0) blocks.push([p]);
      else blocks[blocks.length - 1].push(p);
    });
    blocks.sort((a, b) =>
      mode === "title"
        ? (a[0].title || "").localeCompare(b[0].title || "", undefined, { sensitivity: "base", numeric: true })
        : mode === "created"
        ? a[0].createdAt - b[0].createdAt
        : b[0].updatedAt - a[0].updatedAt
    );
    mutateSection((sec) => ({ ...sec, pages: blocks.flat() }));
  };

  const deletePageAt = async (target: Page) => {
    if (!await ask.confirm(`Delete page "${target.title}"?`)) return;
    const remaining = section.pages.filter((p) => p.id !== target.id);
    const pages = remaining.length ? remaining : [newPage()];
    mutateSection((s) => ({ ...s, pages }));
    if (target.id === page.id) update((d) => ({ ...d, selection: { ...d.selection, pageId: pages[0].id } }));
  };
  const deletePage = () => deletePageAt(page);

  const duplicatePageAt = (target: Page) => {
    const copy: Page = { ...newPage(`${target.title || "Untitled page"} (copy)`), content: target.content, level: lvl(target) };
    const i = section.pages.findIndex((x) => x.id === target.id);
    const at = blockEnd(section.pages, i);
    mutateSection((sec) => ({ ...sec, pages: [...sec.pages.slice(0, at), copy, ...sec.pages.slice(at)] }));
    select(section.id, copy.id);
  };

  /** Drag a page (with its subpages) before/after another page. */
  const movePageTo = (fromId: string, toId: string, after: boolean) => {
    if (fromId === toId) return;
    const pages = section.pages;
    const i = pages.findIndex((x) => x.id === fromId);
    if (i < 0) return;
    const e = blockEnd(pages, i);
    const block = pages.slice(i, e);
    if (block.some((x) => x.id === toId)) return; // cannot drop a page into its own subpages
    const rest = [...pages.slice(0, i), ...pages.slice(e)];
    let t = rest.findIndex((x) => x.id === toId);
    if (t < 0) return;
    if (after) t = blockEnd(rest, t);
    rest.splice(t, 0, ...block);
    let prev = -1;
    const fixed = rest.map((x) => {
      const L = Math.max(0, Math.min(lvl(x), prev + 1, 2));
      prev = L;
      return L === lvl(x) ? x : { ...x, level: L };
    });
    mutateSection((sec) => ({ ...sec, pages: fixed }));
  };

  const renamePageAt = (target: Page) => {
    select(section.id, target.id);
    setTimeout(() => { const el = document.querySelector<HTMLInputElement>(".title"); el?.focus(); el?.select(); }, 60);
  };

  /** Move a page together with its subpages, past its neighbouring sibling. */
  const movePage = (dir: -1 | 1, target: Page = page) => {
    const pages = section.pages;
    const i = pages.findIndex((p) => p.id === target.id);
    const L = lvl(target);
    const e = blockEnd(pages, i);
    if (dir === -1) {
      let j = i - 1;
      while (j >= 0 && lvl(pages[j]) > L) j--;
      if (j < 0 || lvl(pages[j]) < L) return;
      mutateSection((s) => ({
        ...s,
        pages: [...pages.slice(0, j), ...pages.slice(i, e), ...pages.slice(j, i), ...pages.slice(e)],
      }));
    } else {
      if (e >= pages.length || lvl(pages[e]) < L) return;
      const e2 = blockEnd(pages, e);
      mutateSection((s) => ({
        ...s,
        pages: [...pages.slice(0, i), ...pages.slice(e, e2), ...pages.slice(i, e), ...pages.slice(e2)],
      }));
    }
  };

  const visiblePages: Page[] = [];
  {
    let hideBelow: number | null = null;
    for (const p of section.pages) {
      if (hideBelow !== null && lvl(p) > hideBelow) continue;
      hideBelow = null;
      visiblePages.push(p);
      if (p.collapsed) hideBelow = lvl(p);
    }
  }
  const hasChildren = (p: Page) => {
    const i = section.pages.indexOf(p);
    return i >= 0 && i + 1 < section.pages.length && lvl(section.pages[i + 1]) > lvl(p);
  };

  // ---------- sections ----------
  const addSection = async () => {
    const name = await ask.prompt("Section name", "New Section");
    if (!name) return;
    const s = newSection(name, sections.length);
    update((d) => ({
      ...mapContainer(d, notebook.id, group?.id, (secs) => [...secs, s]),
      selection: { notebookId: notebook.id, groupId: group?.id, sectionId: s.id, pageId: s.pages[0].id },
    }));
  };

  const renameSectionAt = async (nbId: string, gId: string | undefined, s: Section) => {
    const name = await ask.prompt("Rename section", s.name);
    if (!name) return;
    update((d) => mapContainer(d, nbId, gId, (secs) => secs.map((x) => (x.id === s.id ? { ...x, name } : x))));
  };
  const renameSection = (s: Section) => renameSectionAt(notebook.id, group?.id, s);

  const recolorSection = (s: Section, color: string) =>
    mutateContainer((secs) => secs.map((x) => (x.id === s.id ? { ...x, color } : x)));

  const deleteSectionAt = async (nb: Notebook, g: Group | undefined, s: Section) => {
    if (allSections(nb).length < 2) return void ask.alert("A notebook needs at least one section.");
    const secs = g ? g.sections : nb.sections;
    if (g && secs.length < 2) return void ask.alert("A group needs at least one section. Delete the group instead.");
    if (!await ask.confirm(`Delete section "${s.name}" and all its pages?`)) return;
    const remaining = secs.filter((x) => x.id !== s.id);
    update((d) => {
      const next = mapContainer(d, nb.id, g?.id, () => remaining);
      if (!(d.selection.notebookId === nb.id && d.selection.sectionId === s.id)) return next; // deleted a section you weren't in
      if (remaining[0]) {
        return { ...next, selection: { notebookId: nb.id, groupId: g?.id, sectionId: remaining[0].id, pageId: remaining[0].pages[0].id } };
      }
      return { ...next, selection: firstLoc({ ...nb, sections: remaining }) };
    });
  };
  const deleteSection = (s: Section) => deleteSectionAt(notebook, group, s);

  // ---------- groups ----------
  const addGroup = async () => {
    const name = await ask.prompt("New group name (e.g. a customer)", "New customer");
    if (!name) return;
    const g = newGroup(name, true);
    update((d) => ({
      ...mapGroups(d, notebook.id, (gs) => [...gs, g]),
      selection: { notebookId: notebook.id, groupId: g.id, sectionId: g.sections[0].id, pageId: g.sections[0].pages[0].id },
    }));
    setOpen((o) => ({ ...o, [g.id]: true }));
  };

  const duplicateGroupAt = async (nb: Notebook, g0: Group) => {
    const name = await ask.prompt("Name for the copy (sections and colors are copied, pages start empty)", `${g0.name} copy`);
    if (!name) return;
    const g = duplicateGroupStructure(g0, name);
    update((d) => ({
      ...mapGroups(d, nb.id, (gs) => [...gs, g]),
      selection: { notebookId: nb.id, groupId: g.id, sectionId: g.sections[0].id, pageId: g.sections[0].pages[0].id },
    }));
    setOpen((o) => ({ ...o, [g.id]: true }));
  };
  const duplicateGroup = () => { if (group) duplicateGroupAt(notebook, group); };

  const renameGroupAt = async (nb: Notebook, g0: Group) => {
    const name = await ask.prompt("Rename group", g0.name);
    if (!name) return;
    update((d) => mapGroups(d, nb.id, (gs) => gs.map((g) => (g.id === g0.id ? { ...g, name } : g))));
  };
  const renameGroup = () => { if (group) renameGroupAt(notebook, group); };

  const deleteGroupAt = async (nb: Notebook, g0: Group) => {
    if (allSections(nb).length <= g0.sections.length) return void ask.alert("A notebook needs at least one section outside this group.");
    if (!await ask.confirm(`Delete group "${g0.name}" with ${g0.sections.length} sections and all their pages?`)) return;
    update((d) => {
      const nb2 = { ...nb, groups: (nb.groups ?? []).filter((g) => g.id !== g0.id) };
      const next = mapGroups(d, nb.id, (gs) => gs.filter((g) => g.id !== g0.id));
      const inside = d.selection.notebookId === nb.id && d.selection.groupId === g0.id;
      return inside ? { ...next, selection: firstLoc(nb2) } : next;
    });
  };
  const deleteGroup = () => { if (group) deleteGroupAt(notebook, group); };

  // ---------- notebooks ----------
  const addNotebook = async () => {
    const name = await ask.prompt("Notebook name", "New Notebook");
    if (!name) return;
    const nb = newNotebook(name);
    update((d) => ({ ...d, notebooks: [...d.notebooks, nb], selection: firstLoc(nb) }));
    setOpen((o) => ({ ...o, [nb.id]: true }));
  };

  const renameNotebookAt = async (nb: Notebook) => {
    const name = await ask.prompt("Rename notebook", nb.name);
    if (!name) return;
    update((d) => ({ ...d, notebooks: d.notebooks.map((n) => (n.id === nb.id ? { ...n, name } : n)) }));
  };
  const renameNotebook = () => renameNotebookAt(notebook);

  const deleteNotebookAt = async (nb: Notebook) => {
    if (data.notebooks.length < 2) return void ask.alert("You need at least one notebook.");
    if (!await ask.confirm(`Delete notebook "${nb.name}" and everything in it?`)) return;
    const rest = data.notebooks.filter((n) => n.id !== nb.id);
    update((d) => ({ ...d, notebooks: rest, selection: d.selection.notebookId === nb.id ? firstLoc(rest[0]) : d.selection }));
  };
  const deleteNotebook = () => deleteNotebookAt(notebook);

  const openCtx = (e: ReactMouseEvent, items: CtxItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu(false);
    setSortMenu(false);
    setCtx({ x: e.clientX, y: e.clientY, items });
  };
  /** Move a section tab to position `to` (0 = first) among the current tabs. */
  const moveSectionTo = (id: string, to: number) => {
    update((d) => mapContainer(d, notebook.id, group?.id, (secs) => {
      const from = secs.findIndex((x) => x.id === id);
      if (from < 0) return secs;
      const next = [...secs];
      const [moved] = next.splice(from, 1);
      next.splice(from < to ? to - 1 : to, 0, moved);
      return next;
    }));
  };

  const shiftSection = (nbId: string, gId: string | undefined, id: string, by: -1 | 1) => {
    update((d) => mapContainer(d, nbId, gId, (secs) => {
      const i = secs.findIndex((x) => x.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= secs.length) return secs;
      const next = [...secs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    }));
  };

  const sectionMenu = (nb: Notebook, g: Group | undefined, sec: Section): CtxItem[] => [
    { label: "Rename section", onClick: () => renameSectionAt(nb.id, g?.id, sec) },
    { label: "Section color…", onClick: () => { setColorFor({ nb: nb.id, g: g?.id, s: sec.id }); setTimeout(() => colorInput.current?.click(), 0); } },
    { label: "Move left", onClick: () => shiftSection(nb.id, g?.id, sec.id, -1) },
    { label: "Move right", onClick: () => shiftSection(nb.id, g?.id, sec.id, 1) },
    { label: "Delete section", danger: true, onClick: () => deleteSectionAt(nb, g, sec) },
  ];

  // ---------- import / export ----------
  const exportMd = () => { setMenu(false); saveFile(`${safeName(page.title)}.md`, pageToMarkdown(page), "text/markdown"); };
  const exportHtml = () => { setMenu(false); saveFile(`${safeName(page.title)}.html`, pageToHtml(page), "text/html"); };
  const exportNb = () => {
    setMenu(false);
    // flatten groups into the markdown export as extra sections prefixed with the group name
    const flat: Notebook = {
      ...notebook,
      sections: [
        ...notebook.sections,
        ...(notebook.groups ?? []).flatMap((g) => g.sections.map((s) => ({ ...s, name: `${g.name} / ${s.name}` }))),
      ],
    };
    saveFile(`${safeName(notebook.name)}.md`, notebookToMarkdown(flat), "text/markdown");
  };
  const exportBackup = () => { setMenu(false); saveFile("zornote-backup.json", JSON.stringify(data, null, 2), "application/json"); };

  const importBackup = async () => {
    setMenu(false);
    try {
      let raw: string;
      if (isTauri()) {
        const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
        const path = await openDialog({ filters: [{ name: "ZorNote backup", extensions: ["json"] }] });
        if (!path || Array.isArray(path)) return;
        raw = await readTextFile(path);
      } else {
        const text = await ask.prompt("Paste backup JSON");
        if (!text) return;
        raw = text;
      }
      const parsed = JSON.parse(raw) as AppData;
      if (parsed.version !== 1 || !parsed.notebooks?.length) throw new Error("Not a ZorNote backup");
      const n = parsed.notebooks.length;
      if (!(await ask.confirm(`Replace ALL your notebooks with the ${n} notebook${n > 1 ? "s" : ""} in this file?\n\nPages that are not in the file are moved to "Recently deleted pages", and today's backup still has everything.`, "Replace"))) return;
      update(() => parsed);
    } catch (e) {
      ask.alert(`Import failed: ${e}`);
    }
  };

  const created = new Date(page.createdAt);
  const headerDate = created.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const headerTime = created.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  const SectionRow = ({ nb, g, s, indent }: { nb: Notebook; g?: Group; s: Section; indent: number }) => {
    const active = nb.id === notebook.id && g?.id === group?.id && s.id === section.id;
    return (
      <div
        className={"tree-row" + (active ? " sel" : "")}
        style={{ paddingLeft: indent }}
        onClick={() => selectLoc({ notebookId: nb.id, groupId: g?.id, sectionId: s.id, pageId: s.pages[0].id })}
        title={s.name}
        onContextMenu={(e) => openCtx(e, sectionMenu(nb, g, s))}
      >
        <i className="dot" style={{ background: s.color }} />
        <span className="tr-name">{s.name}</span>
      </div>
    );
  };

  const ribbonActions: RibbonActions = {
    desktop: isTauri(),
    fullPage,
    toggleFullPage: () => setFullPage((f) => !f),
    findTags: () => setShowTags(true),
    pageVersions: () => setHistory({ page }),
    deletedPages: () => setHistory({}),
    backupNow: async () => {
      try { const p = await backupNow(); flash("Backup written: " + p.split("/").pop()); }
      catch (err) { ask.alert("Backup failed: " + err); }
    },
    openBackups: () => { openDataFolder(true).catch((err) => ask.alert(String(err))); },
    whereIsData: async () => {
      ask.alert("Your notebooks are stored in:\n" + (await dataLocation()) + "\n\nDaily backups (last 30 days) are in the \"backups\" folder next to it.");
    },
    oneNoteColors: async () => {
      const MAP: Record<string, string> = {
        "#cfe8ff": "#d6dce4", "#d9d9d9": "#d0cece", "#3a3a3a": "#3a3838", "#3f3f3f": "#3a3838",
        "#404040": "#3a3838", "#808080": "#7f7f7f",
      };
      // only shading / panel colours (data-bg, data-color, background-color) — never text
      const re = /(data-bg="|data-color="|background-color:\s*)(#[0-9a-fA-F]{6})/g;
      let pages = 0;
      const changedIds: string[] = [];
      const next = mapAllPages(data, (p) => {
        const html = p.content.replace(re, (m, pre: string, hex: string) => (MAP[hex.toLowerCase()] ? pre + MAP[hex.toLowerCase()] : m));
        if (html === p.content) return p;
        pages++;
        changedIds.push(p.id);
        return { ...p, content: html };
      });
      if (!pages) { ask.alert("Nothing to change: your pages already use OneNote's colours."); return; }
      if (!(await ask.confirm(
        `Switch the shading on ${pages} page${pages > 1 ? "s" : ""} to OneNote's exact colours?\n\n` +
        "#CFE8FF → #D6DCE4   #D9D9D9 → #D0CECE   #3A3A3A / #3F3F3F / #404040 → #3A3838   #808080 → #7F7F7F\n\n" +
        "Text colours are not touched. Each page keeps its previous version (History ▸ Page Versions).", "Switch"))) return;
      if (isTauri()) {
        // a version of every page exactly as it is now, so the switch can be undone page by page
        await saveData(data).catch(() => {});
        for (const id of changedIds) await snapshotPage(id).catch(() => {});
      }
      update(() => next);
      setEditorRev((r) => r + 1);
      flash(`OneNote colours applied to ${pages} page${pages > 1 ? "s" : ""}`);
    },
    exportPagePdf: async () => {
      try {
        flash("Exporting to PDF…");
        const f = await exportPdf(`${safeName(page.title)}.pdf`);
        if (f) flash("PDF saved: " + f.split("/").pop());
        else setNote("");
      } catch (err) { setNote(""); ask.alert("PDF export failed: " + err); }
    },
    printPage: () => { printPage().catch((err) => ask.alert("Print failed: " + err)); },
    exportPageMd: exportMd,
    exportPageHtml: exportHtml,
    exportNotebookMd: exportNb,
    exportAll: exportBackup,
    importAll: importBackup,
    importOneNote: () => setShowImport(true),
  };

  return (
    <div className={"app" + (fullPage ? " full" : "")}>
      <div id="ribbon-host" className="ribbon-host" />
      <div className="app-body">
      <aside className="sidebar">
        <div className="brand"><img src={logo} alt="" className="brand-logo" />ZorNote</div>
        <input
          className="search"
          ref={searchRef}
          placeholder="Search all notebooks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="nb-header">
          <span>Notebooks</span>
          <button className="icon" title="New notebook" onClick={addNotebook}>＋</button>
        </div>
        <div className="tree">
          {data.notebooks.map((n) => {
            const selNb = n.id === notebook.id;
            const nOpen = isOpen(n.id, selNb);
            return (
              <div key={n.id}>
                <div
                  className={"tree-row nb" + (selNb && !group ? " sel-soft" : "")}
                  onClick={() => { if (!selNb) selectLoc(firstLoc(n)); }}
                  onContextMenu={(e) => openCtx(e, [
                    { label: "Rename notebook", onClick: () => renameNotebookAt(n) },
                    { label: "Delete notebook", danger: true, onClick: () => deleteNotebookAt(n) },
                  ])}
                >
                  <span className="chev" onClick={(e) => { e.stopPropagation(); toggle(n.id, nOpen); }}>{nOpen ? "▾" : "▸"}</span>
                  <span className="nb-ico" />
                  <span className="tr-name">{n.name}</span>
                </div>
                {nOpen && (
                  <>
                    {n.sections.map((s) => <SectionRow key={s.id} nb={n} s={s} indent={28} />)}
                    {(n.groups ?? []).map((g) => {
                      const selG = selNb && g.id === group?.id;
                      const gOpen = isOpen(g.id, selG);
                      return (
                        <div key={g.id}>
                          <div
                            className={"tree-row grp" + (selG ? " sel-soft" : "")}
                            style={{ paddingLeft: 22 }}
                            onContextMenu={(e) => openCtx(e, [
                              { label: "Rename group", onClick: () => renameGroupAt(n, g) },
                              { label: "Duplicate group structure", onClick: () => duplicateGroupAt(n, g) },
                              { label: "Delete group", danger: true, onClick: () => deleteGroupAt(n, g) },
                            ])}
                            onClick={() => {
                              if (!selG) selectLoc({ notebookId: n.id, groupId: g.id, sectionId: g.sections[0].id, pageId: g.sections[0].pages[0].id });
                              setOpen((o) => ({ ...o, [g.id]: true }));
                            }}
                          >
                            <span className="chev" onClick={(e) => { e.stopPropagation(); toggle(g.id, gOpen); }}>{gOpen ? "▾" : "▸"}</span>
                            <span className="tr-name">{g.name}</span>
                          </div>
                          {gOpen && g.sections.map((s) => <SectionRow key={s.id} nb={n} g={g} s={s} indent={44} />)}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="tree-actions">
          <div className="ta-row">
            <span className="ta-label">Notebook</span>
            <button className="icon" title="Rename notebook" onClick={renameNotebook}>✎</button>
            <button className="icon" title="Delete notebook" onClick={deleteNotebook}>🗑</button>
          </div>
          <div className="ta-row">
            <span className="ta-label">Group</span>
            <button className="icon" title="New group with the standard sections" onClick={addGroup}>＋</button>
            <button className="icon" title="Rename group" disabled={!group} onClick={renameGroup}>✎</button>
            <button className="icon" title="Duplicate group structure" disabled={!group} onClick={duplicateGroup}>⧉</button>
            <button className="icon" title="Delete group" disabled={!group} onClick={deleteGroup}>🗑</button>
          </div>
        </div>

        <div className="status">{note || (saved ? "✓ Saved" : "Saving…")}</div>
      </aside>

      <main className="main">
        <div className="tabs" style={{ borderBottomColor: section.color }}>
          {sections.map((s, i) => (
            <div
              key={s.id}
              className={
                "tab" + (s.id === section.id ? " active" : "") + (dragTab === s.id ? " dragging" : "") +
                (tabDrop?.id === s.id ? (tabDrop.before ? " drop-before" : " drop-after") : "")
              }
              style={{ background: s.color }}
              draggable
              onDragStart={(e) => { setDragTab(s.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/x-zornote-section", s.id); }}
              onDragOver={(e) => {
                if (!dragTab) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const before = e.clientX < r.left + r.width / 2;
                if (tabDrop?.id !== s.id || tabDrop.before !== before) setTabDrop({ id: s.id, before });
              }}
              onDrop={(e) => { e.preventDefault(); if (dragTab && tabDrop) moveSectionTo(dragTab, tabDrop.before ? i : i + 1); setDragTab(null); setTabDrop(null); }}
              onDragEnd={() => { setDragTab(null); setTabDrop(null); }}
              onClick={() => select(s.id, s.pages[0].id)}
              onDoubleClick={() => renameSection(s)}
              onContextMenu={(e) => openCtx(e, sectionMenu(notebook, group, s))}
              title="Drag to move · double-click to rename"
            >
              {s.name}
            </div>
          ))}
          <button className="tab add" onClick={addSection} title="New section">＋</button>
          <span className="crumb">{[notebook.name, group?.name].filter(Boolean).join(" › ")}</span>
        </div>

        <div className="body">
          <section className="canvas">
            <div className="title-row">
              <input
                className="title"
                value={page.title}
                placeholder="Page title"
                onChange={(e) => updatePage({ title: e.target.value })}
              />
              <button className="tool boxed" title="Search (Ctrl+E)" onClick={() => { setFullPage(false); searchRef.current?.focus(); }}>🔍</button>
              <button className="tool" title={fullPage ? "Exit full page view (Esc)" : "Full page view"} onClick={() => setFullPage(!fullPage)}>{fullPage ? "⤡" : "⤢"}</button>
            </div>
            <div className="meta" title={`Last edited ${new Date(page.updatedAt).toLocaleString()}`}>
              {headerDate}&nbsp;&nbsp;&nbsp;{headerTime}
            </div>
            <Editor key={page.id + ":" + editorRev} pageId={page.id} content={page.content} onChange={(html) => updatePage({ content: html })} actions={ribbonActions} />
          </section>

          <nav className="pages">
            {query.trim() ? (
              <>
                <div className="pages-head">Results ({results.length})</div>
                {results.map(({ sel, path, title, snippet }) => (
                  <div key={sel.pageId} className="page-item" onClick={() => { selectLoc(sel); setQuery(""); }}>
                    <div className="pt">{title}</div>
                    <div className="ps">{path}</div>
                    {snippet && <div className="ps">…{snippet}…</div>}
                  </div>
                ))}
              </>
            ) : (
              <>
                <div className="pages-head head-btns">
                  <button className="add-page" title="New Page (Ctrl+N)" onClick={() => addPage(false)}>✎ Add Page</button>
                  <button className="icon" title="New Subpage (Ctrl+Alt+Shift+N)" disabled={lvl(page) >= 2} onClick={() => addPage(true)}>↳</button>
                  <button className="icon" title="Sort pages" onClick={() => setSortMenu(!sortMenu)}>⇅</button>
                  {sortMenu && (
                    <div className="menu sort">
                      <button onClick={() => sortPages("title")}>Page title (A → Z)</button>
                      <button onClick={() => sortPages("created")}>Date created (oldest first)</button>
                      <button onClick={() => sortPages("modified")}>Date modified (newest first)</button>
                    </div>
                  )}
                </div>
                {visiblePages.map((p) => (
                  <div
                    key={p.id}
                    className={
                      "page-item" + (p.id === page.id ? " active" : "") +
                      (dropHint?.id === p.id ? (dropHint.after ? " drop-after" : " drop-before") : "")
                    }
                    style={{ paddingLeft: 12 + lvl(p) * 16 }}
                    onClick={() => select(section.id, p.id)}
                    draggable
                    onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.id); }}
                    onDragEnd={() => { setDragId(null); setDropHint(null); }}
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      const r = e.currentTarget.getBoundingClientRect();
                      setDropHint({ id: p.id, after: e.clientY > r.top + r.height / 2 });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragId && dropHint) movePageTo(dragId, dropHint.id, dropHint.after);
                      setDragId(null); setDropHint(null);
                    }}
                    onContextMenu={(e) => {
                      const idx = section.pages.findIndex((x) => x.id === p.id);
                      const items: CtxItem[] = [
                        { label: "Rename", onClick: () => renamePageAt(p) },
                        { label: "Delete", danger: true, onClick: () => deletePageAt(p) },
                      ];
                      if (idx > 0 && lvl(p) < 2) items.push({ label: "Make Subpage", onClick: () => setLevel(1, p) });
                      if (lvl(p) > 0) items.push({ label: "Promote Subpage", onClick: () => setLevel(-1, p) });
                      items.push({ label: "Duplicate page", onClick: () => duplicatePageAt(p) });
                      items.push({ label: "Move up", onClick: () => movePage(-1, p) });
                      items.push({ label: "Move down", onClick: () => movePage(1, p) });
                      if (isTauri()) items.push({ label: "Page versions…", onClick: () => { select(section.id, p.id); setHistory({ page: p }); } });
                      openCtx(e, items);
                    }}
                  >
                    <div className="pt">
                      {hasChildren(p) ? (
                        <span className="chev" onClick={(e) => { e.stopPropagation(); toggleCollapse(p.id); }}>
                          {p.collapsed ? "▸" : "▾"}
                        </span>
                      ) : (
                        <span className="chev" />
                      )}
                      <i className="pg-ico" />
                      {p.title || "Untitled page"}
                    </div>
                  </div>
                ))}
              </>
            )}
          </nav>
        </div>
      </main>
      </div>

      {ctx && (
        <>
          <div className="ctx-overlay" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
          <div
            className="ctx"
            style={{ left: Math.min(ctx.x, window.innerWidth - 210), top: Math.min(ctx.y, window.innerHeight - ctx.items.length * 34 - 14) }}
          >
            {ctx.items.map((it) => (
              <button key={it.label} className={it.danger ? "danger" : ""} onClick={() => { setCtx(null); it.onClick(); }}>
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}

      <AskHost />

      <input
        ref={colorInput} type="color" className="vh" value="#8fbcf0"
        onChange={(e) => {
          const c = e.target.value;
          const f = colorFor;
          if (f) update((d) => mapContainer(d, f.nb, f.g, (secs) => secs.map((x) => (x.id === f.s ? { ...x, color: c } : x))));
        }}
      />

      {showTags && (
        <FindTagsDialog
          data={data}
          onClose={() => setShowTags(false)}
          onGo={(loc) => { setShowTags(false); selectLoc(loc); }}
        />
      )}

      {history && (
        <HistoryDialog
          page={history.page}
          onClose={() => setHistory(null)}
          onRestore={async (v, html) => {
            if (history.page) {
              // restore over the current page; its current content is kept as a version first
              await saveData(data).catch(() => {});
              await snapshotPage(history.page.id).catch(() => {});
              const id = history.page.id;
              update((d) => mapAllPages(d, (p) => (p.id === id ? { ...p, content: html, updatedAt: Date.now() } : p)));
              setEditorRev((r) => r + 1);
              flash("Restored the version from " + fmtTime(v.savedAt));
            } else {
              // bring a deleted page back at the end of the current section
              const restored: Page = { ...newPage(v.title || "Restored page"), id: v.pageId, content: html };
              mutateSection((s) => ({ ...s, pages: [...s.pages, restored] }));
              select(section.id, restored.id);
              setEditorRev((r) => r + 1);
              flash(`Restored "${restored.title}" into ${section.name}`);
            }
            setHistory(null);
          }}
        />
      )}

      {showImport && (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onImported={(nb) => {
            update((d) => ({ ...d, notebooks: [...d.notebooks, nb], selection: firstLoc(nb) }));
            setShowImport(false);
          }}
        />
      )}
    </div>
  );
}

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function mapAllPages(d: AppData, fn: (p: Page) => Page): AppData {
  const sec = (s: Section): Section => ({ ...s, pages: s.pages.map(fn) });
  return {
    ...d,
    notebooks: d.notebooks.map((nb) => ({
      ...nb,
      sections: nb.sections.map(sec),
      groups: nb.groups?.map((g) => ({ ...g, sections: g.sections.map(sec) })),
    })),
  };
}

/** Page versions of one page, or (without a page) the recently deleted pages. Preview, then restore. */
function HistoryDialog({ page, onClose, onRestore }: {
  page?: Page;
  onClose: () => void;
  onRestore: (v: VersionInfo, html: string) => void;
}) {
  const [list, setList] = useState<VersionInfo[] | null>(null);
  const [pick, setPick] = useState<VersionInfo | null>(null);
  const [html, setHtml] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    (page ? listVersions(page.id) : listDeleted()).then(setList).catch((e) => setErr(String(e)));
  }, [page]);
  useEffect(() => {
    if (pick) getVersion(pick.id).then(setHtml).catch((e) => setErr(String(e)));
  }, [pick]);

  const what = page ? `Page versions – ${page.title || "Untitled page"}` : "Recently deleted pages";
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog history" onClick={(e) => e.stopPropagation()}>
        <h3>{what}</h3>
        <p className="hint">
          {page
            ? "ZorNote keeps how the page looked before your edits (at most one copy every 10 minutes). Click a version to see it."
            : "Deleted pages are kept here so you can bring them back. A restored page goes to the end of the current section."}
        </p>
        <div className="history-body">
          <div className="history-list">
            {err && <div className="hint">{err}</div>}
            {list && !list.length && <div className="hint">{page ? "No older versions yet." : "No deleted pages."}</div>}
            {list?.map((v) => (
              <button key={v.id} className={"history-item" + (pick?.id === v.id ? " on" : "")} onClick={() => setPick(v)}>
                <span>{page ? fmtTime(v.savedAt) : v.title || "Untitled page"}</span>
                <small>
                  {[
                    page ? (v.reason === "edit" ? "" : v.reason) : "deleted " + fmtTime(v.savedAt),
                    v.size > 1024 ? Math.round(v.size / 1024) + " KB" : v.size + " B",
                  ].filter(Boolean).join(" · ")}
                </small>
              </button>
            ))}
          </div>
          <div className="history-preview ProseMirror" dangerouslySetInnerHTML={{ __html: pick ? html : "" }} />
        </div>
        <div className="row">
          <button className="primary" disabled={!pick || !html} onClick={() => pick && onRestore(pick, html)}>
            {page ? "Restore this version" : "Restore page"}
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

interface TagHit { tag: string; text: string; loc: Selection; where: string }

/** OneNote's "Find Tags": every tagged line in all notebooks, grouped by tag. */
function FindTagsDialog({ data, onClose, onGo }: { data: AppData; onClose: () => void; onGo: (loc: Selection) => void }) {
  const [showDone, setShowDone] = useState(false);
  const hits = useMemo(() => {
    const out: TagHit[] = [];
    const parser = new DOMParser();
    for (const nb of data.notebooks) {
      const visit = (secs: Section[], g?: Group) => {
        for (const sec of secs) {
          for (const p of sec.pages) {
            if (!p.content.includes("data-tag")) continue;
            const doc = parser.parseFromString(p.content, "text/html");
            doc.querySelectorAll("[data-tag]").forEach((el) => {
              out.push({
                tag: el.getAttribute("data-tag") ?? "",
                text: (el.textContent ?? "").trim() || "(empty line)",
                loc: { notebookId: nb.id, groupId: g?.id, sectionId: sec.id, pageId: p.id },
                where: [nb.name, g?.name, sec.name, p.title || "Untitled page"].filter(Boolean).join(" › "),
              });
            });
          }
        }
      };
      visit(nb.sections);
      for (const g of nb.groups ?? []) visit(g.sections, g);
    }
    return out;
  }, [data]);

  const groups: [string, string][] = [["todo", "To Do"], ["important", "Important"], ["question", "Question"], ...(showDone ? [["done", "Done"] as [string, string]] : [])];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog tags-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Tags Summary</h3>
        <label className="hint"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show ticked To Do items</label>
        <div className="tags-list">
          {groups.map(([t, label]) => {
            const list = hits.filter((h) => h.tag === t);
            if (!list.length) return null;
            return (
              <div key={t} className="tags-group">
                <div className="tags-head"><span className={"tag-ico " + t} /> {label} ({list.length})</div>
                {list.map((h, i) => (
                  <button key={i} className="tags-item" onClick={() => onGo(h.loc)}>
                    <span>{h.text}</span>
                    <small>{h.where}</small>
                  </button>
                ))}
              </div>
            );
          })}
          {!hits.some((h) => groups.some(([t]) => t === h.tag)) && (
            <p className="hint">No tagged lines yet. Put the cursor on a line and press Ctrl+1 (To Do), Ctrl+2 (Important) or Ctrl+3 (Question).</p>
          )}
        </div>
        <div className="row"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (nb: Notebook) => void }) {
  const [token, setToken] = useState("");
  const [list, setList] = useState<{ id: string; displayName: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchList = async () => {
    setBusy(true); setMsg("");
    try { setList(await listRemoteNotebooks(token.trim())); setMsg("Pick a notebook to import."); }
    catch (e) { setMsg(String(e)); }
    setBusy(false);
  };

  const doImport = async (n: { id: string; displayName: string }) => {
    setBusy(true);
    try { onImported(await importRemoteNotebook(token.trim(), n, setMsg)); }
    catch (e) { setMsg(String(e)); setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Import from OneNote</h3>
        <p className="hint">
          Uses Microsoft's official Graph API (read-only, <code>Notes.Read</code>). Paste a short-lived access token
          from Graph Explorer or your own Entra app registration. The token is used only for this import and is never saved.
        </p>
        <textarea placeholder="Access token" value={token} onChange={(e) => setToken(e.target.value)} rows={3} />
        <div className="row">
          <button className="primary" disabled={!token.trim() || busy} onClick={fetchList}>List notebooks</button>
          <button onClick={onClose}>Close</button>
        </div>
        {list.map((n) => (
          <div key={n.id} className="remote-nb">
            <span>{n.displayName}</span>
            <button disabled={busy} onClick={() => doImport(n)}>Import</button>
          </div>
        ))}
        {msg && <div className="msg">{msg}</div>}
      </div>
    </div>
  );
}
