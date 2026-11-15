import { invoke } from "@tauri-apps/api/core";
import type { AppData, Group, Notebook, Page, Section } from "./types";
import { SECTION_COLORS, STANDARD_SECTIONS } from "./types";

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const LS_KEY = "zornote:data";

export function newPage(title = "Untitled page"): Page {
  const now = Date.now();
  return { id: uid(), title, content: "", level: 0, createdAt: now, updatedAt: now };
}

export function newSection(name: string, colorIndex = 0): Section {
  return {
    id: uid(),
    name,
    color: SECTION_COLORS[colorIndex % SECTION_COLORS.length],
    pages: [newPage()],
  };
}

/** New group; with `standard` it starts with the six standard sections. */
export function newGroup(name: string, standard = true): Group {
  const sections: Section[] = standard
    ? STANDARD_SECTIONS.map((s) => ({ id: uid(), name: s.name, color: s.color, pages: [newPage()] }))
    : [newSection("Section")];
  return { id: uid(), name, sections };
}

/** Copy a group's structure (sections + colors); each section gets one fresh empty page. */
export function duplicateGroupStructure(g: Group, name: string): Group {
  return {
    id: uid(),
    name,
    sections: g.sections.map((s) => ({ id: uid(), name: s.name, color: s.color, pages: [newPage()] })),
  };
}

export function newNotebook(name: string): Notebook {
  return { id: uid(), name, sections: [newSection("Quick Notes")] };
}

export function defaultData(): AppData {
  const nb = newNotebook("My Notebook");
  const sec = nb.sections[0];
  sec.pages[0].title = "Welcome to ZorNote";
  sec.pages[0].content =
    "<h2>Welcome to ZorNote</h2><p>Notebooks contain <strong>sections</strong>, sections contain <strong>pages</strong>. Everything saves automatically.</p><ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"true\"><label><input type=\"checkbox\" checked=\"checked\"><span></span></label><div><p>Open ZorNote</p></div></li><li data-type=\"taskItem\" data-checked=\"false\"><label><input type=\"checkbox\"><span></span></label><div><p>Create your first page</p></div></li></ul>";
  return {
    version: 1,
    notebooks: [nb],
    selection: { notebookId: nb.id, sectionId: sec.id, pageId: sec.pages[0].id },
  };
}

/** HTML of every page as last written to the database, so a save only sends the pages that changed. */
const lastSaved = new Map<string, string>();

function forEachPage(d: AppData, fn: (p: Page) => void) {
  for (const nb of d.notebooks) {
    for (const s of nb.sections) s.pages.forEach(fn);
    for (const g of nb.groups ?? []) for (const s of g.sections) s.pages.forEach(fn);
  }
}

/** The tree without page contents (the contents travel separately, and only when changed). */
function treeOnly(d: AppData): AppData {
  const sec = (s: Section): Section => ({ ...s, pages: s.pages.map((p) => ({ ...p, content: "" })) });
  return {
    ...d,
    notebooks: d.notebooks.map((nb) => ({
      ...nb,
      sections: nb.sections.map(sec),
      groups: nb.groups?.map((g) => ({ ...g, sections: g.sections.map(sec) })),
    })),
  };
}

export async function loadData(): Promise<AppData> {
  try {
    const raw = isTauri()
      ? await invoke<string | null>("load_data")
      : localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppData;
      if (parsed.notebooks?.length) {
        parsed.version = 1;
        lastSaved.clear();
        forEachPage(parsed, (p) => lastSaved.set(p.id, p.content));
        return parsed;
      }
    }
  } catch (e) {
    console.error("Failed to load data", e);
  }
  return defaultData();
}

export async function saveData(data: AppData): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    return;
  }
  const changed: { id: string; content: string }[] = [];
  forEachPage(data, (p) => {
    if (lastSaved.get(p.id) !== p.content) changed.push({ id: p.id, content: p.content });
  });
  await invoke("save_changes", { tree: JSON.stringify(treeOnly(data)), changed });
  for (const c of changed) lastSaved.set(c.id, c.content);
}

/* ---- page versions, deleted pages, backups (desktop app only) ---- */

export interface VersionInfo {
  id: number;
  pageId: string;
  savedAt: number;
  title: string;
  reason: string; // "edit" | "deleted" | "before restore"
  size: number;
}
export interface BackupInfo { name: string; path: string; size: number }

export const listVersions = (pageId: string) => invoke<VersionInfo[]>("list_versions", { pageId });
export const listDeleted = () => invoke<VersionInfo[]>("list_deleted");
export const getVersion = (id: number) => invoke<string>("get_version", { id });
export const snapshotPage = (pageId: string) => invoke<void>("snapshot_page", { pageId });
export const backupNow = () => invoke<string>("backup_now");
export const listBackups = () => invoke<BackupInfo[]>("list_backups");
export const openDataFolder = (backups: boolean) => invoke<void>("open_data_folder", { backups });
export const dataLocation = () => invoke<string>("data_location");

export async function writeTextFile(path: string, contents: string) {
  if (isTauri()) await invoke("write_text_file", { path, contents });
}

export async function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

export { isTauri };
