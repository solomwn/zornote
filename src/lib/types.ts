export interface Page {
  id: string;
  title: string;
  /** TipTap HTML */
  content: string;
  /** Nesting depth in the page list: 0 = page, 1 = subpage, 2 = sub-subpage */
  level?: number;
  collapsed?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Section {
  id: string;
  name: string;
  color: string;
  pages: Page[];
}

/** A folder of sections (e.g. one per customer). */
export interface Group {
  id: string;
  name: string;
  sections: Section[];
}

export interface Notebook {
  id: string;
  name: string;
  /** Sections directly under the notebook */
  sections: Section[];
  /** Section groups; each holds its own sections */
  groups?: Group[];
}

export interface Selection {
  notebookId: string;
  /** undefined = a section directly under the notebook */
  groupId?: string;
  sectionId: string;
  pageId: string;
}

export interface AppData {
  version: 1;
  notebooks: Notebook[];
  selection: Selection;
}

/** The standard set of sections used for every customer group. */
export const STANDARD_SECTIONS: { name: string; color: string }[] = [
  { name: "daily", color: "#8fbcf0" },
  { name: "yaml", color: "#f7c948" },
  { name: "image history", color: "#7fd69a" },
  { name: "resources", color: "#d6b48e" },
  { name: "setup", color: "#b99be8" },
  { name: "api", color: "#a8d85c" },
];

export const SECTION_COLORS = [
  "#7a5af8",
  "#0e9384",
  "#d92d20",
  "#dc6803",
  "#1570ef",
  "#c11574",
  "#4e5ba6",
  "#3b7a2a",
];
