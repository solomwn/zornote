import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";
import Blockquote from "@tiptap/extension-blockquote";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { ResizableImage } from "./ResizableImage";
import { getMarkRange } from "@tiptap/core";
import LinkDialog from "./LinkDialog";
import { findRef, KIND_LABEL, openExternal, parseZorLink, refTitle, type LinkKind, type PageRef } from "../lib/links";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import FontFamily from "@tiptap/extension-font-family";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Callout, isDark } from "./Callout";
import { FontSize } from "./FontSize";
import { LineSize } from "./LineSize";
import { DEFAULT_SYMBOLS, SymbolDialog, loadRecent, saveRecent } from "./Symbols";
import { TableKeys } from "./TableKeys";
import { ask } from "./Ask";
import { TableLink } from "./TableLink";
import { BlockRangeSelection, BlockSelect } from "./BlockSelect";
import { TableBorders, bordersHidden, setTableBorders } from "./TableBorders";
import { CellSelection, cellAround } from "@tiptap/pm/tables";
import { NodeSelection, TextSelection, type Selection, type Transaction, type EditorState } from "@tiptap/pm/state";
import type { Mark } from "@tiptap/pm/model";
import { Icon } from "./icons";
import { TAG_INFO, Tags } from "./Tags";
import { duplicateRow, fitTableWidth, isInCell, safeCell, selectCell, selectColumn, selectRow, selectTable, setTableShading } from "./tableTools";
import { TEMPLATES, dateStamp } from "./templates";

const lowlight = createLowlight(common);

/** Table cells that can be shaded, like OneNote's "Shading" command. */
const shadeAttr = {
  backgroundColor: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-bg") || el.style.backgroundColor || null,
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.backgroundColor
        ? {
            "data-bg": String(attrs.backgroundColor),
            ...(isDark(String(attrs.backgroundColor)) ? { "data-dark": "1" } : {}),
            // default text color stays readable on the shade; an explicit text color still overrides it
            style: `background-color:${attrs.backgroundColor};color:${isDark(String(attrs.backgroundColor)) ? "#ffffff" : "#201f1e"}`,
          }
        : {},
  },
};
const ShadedCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...shadeAttr };
  },
});
const ShadedHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...shadeAttr };
  },
});

const TEXT_COLORS = ["#000000", "#ffffff", "#ff0000", "#d92d20", "#dc6803", "#f5c400", "#3b7a2a", "#0b5cad", "#7a5af8", "#c11574", "#6b6a69"];
const FILL_COLORS = ["#fff3a3", "#ffd6a5", "#ffc9c9", "#c8f7c5", "#cfe8ff", "#e5d4ff", "#ff0000", "#92d050", "#404040", "#d9d9d9"];
/**
 * Font choices. Each has fallbacks, so a font that isn't installed still renders sensibly.
 * Carlito/Caladea are the metric-compatible stand-ins for Calibri/Cambria on Linux.
 */
const FONTS: { label: string; stack: string }[] = [
  { label: "Inter", stack: "Inter, 'Noto Sans', sans-serif" },
  { label: "Ubuntu", stack: "Ubuntu, 'Noto Sans', sans-serif" },
  { label: "Noto Sans", stack: "'Noto Sans', 'DejaVu Sans', sans-serif" },
  { label: "Calibri (Carlito)", stack: "Calibri, Carlito, 'Noto Sans', sans-serif" },
  { label: "Arial", stack: "Arial, 'Liberation Sans', Helvetica, sans-serif" },
  { label: "Segoe UI", stack: "'Segoe UI', 'Noto Sans', Inter, sans-serif" },
  { label: "Verdana", stack: "Verdana, 'DejaVu Sans', sans-serif" },
  { label: "Times New Roman", stack: "'Times New Roman', 'Liberation Serif', Times, serif" },
  { label: "Cambria (Caladea)", stack: "Cambria, Caladea, 'Noto Serif', serif" },
  { label: "Georgia", stack: "Georgia, 'Noto Serif', serif" },
  { label: "Noto Serif", stack: "'Noto Serif', 'DejaVu Serif', serif" },
  { label: "Courier New", stack: "'Courier New', 'Liberation Mono', monospace" },
  { label: "Consolas", stack: "Consolas, 'DejaVu Sans Mono', 'Ubuntu Mono', monospace" },
  { label: "Ubuntu Mono", stack: "'Ubuntu Mono', 'DejaVu Sans Mono', monospace" },
  { label: "DejaVu Sans Mono", stack: "'DejaVu Sans Mono', monospace" },
];
/**
 * Is a font really installed? (Linux silently swaps a missing font for another one.)
 * Measured: text in "<font>, <generic>" is a different width from the generic font alone.
 */
const fontCache = new Map<string, boolean>();
/** In the desktop app: the real list from fontconfig (fc-list). Aliases can't fool it. */
let systemFonts: Set<string> | null = null;
export async function loadSystemFonts() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const list = await invoke<string[]>("installed_fonts");
    if (list.length) systemFonts = new Set(list.map((f) => f.toLowerCase()));
  } catch { /* browser preview: fall back to measuring */ }
}
export function fontInstalled(family: string): boolean {
  const key = family.toLowerCase();
  if (systemFonts) return systemFonts.has(key);
  const hit = fontCache.get(key);
  if (hit !== undefined) return hit;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return true;
  const sample = "mmmmmmmmmmlliiWWW@#0123456789 OneNote";
  const ok = ["monospace", "serif", "sans-serif"].some((generic) => {
    ctx.font = `40px ${generic}`;
    const base = ctx.measureText(sample).width;
    ctx.font = `40px "${family}", ${generic}`;
    return Math.abs(ctx.measureText(sample).width - base) > 0.5;
  });
  fontCache.set(key, ok);
  return ok;
}

/** For a font stack: is the named font there, and if not, which one is shown instead. */
function fontStatus(stack: string): { ok: boolean; using?: string } {
  const fams = stack.split(",").map((f) => f.replace(/["']/g, "").trim()).filter((f) => !/^(sans-serif|serif|monospace|system-ui)$/.test(f));
  if (fontInstalled(fams[0])) return { ok: true };
  return { ok: false, using: fams.slice(1).find(fontInstalled) };
}

const SIZES = ["3", "4", "5", "6", "7", "8", "9", "10", "10.5", "11", "12", "14", "16", "18", "20", "24", "28", "36", "48", "72"];

/** First family name of a CSS font stack, normalised, so saved pages match whichever quoting the browser used. */
const firstFamily = (s?: string | null) =>
  (s ?? "").split(",")[0].replace(/["']/g, "").trim().toLowerCase();
const fontLabelFor = (family?: string | null) =>
  FONTS.find((f) => firstFamily(f.stack) === firstFamily(family))?.label ?? "";

const SHADE_COLORS = ["#000000", "#3a3838", "#3a3a3a", "#7f7f7f", "#808080", "#d9d9d9", "#ffffff", "#ff0000", "#fff3a3", "#ffd6a5", "#ffc9c9", "#c8f7c5", "#cfe8ff", "#e5d4ff", "#92d050", "#44546a"];
const PANEL_COLORS = ["#3a3a3a", "#44546a", "#1f3864", "#7b1e1e", "#2e6b34", "#fff2cc", "#e8f0fe", "#f0f0f0"];
const LANGS = ["yaml", "bash", "json", "xml", "sql", "javascript", "typescript", "python", "powershell", "plaintext"];

/** What the ribbon can ask the app to do (things that are not about the text). */
export interface RibbonActions {
  desktop: boolean;
  fullPage: boolean;
  toggleFullPage: () => void;
  findTags: () => void;
  pageVersions: () => void;
  deletedPages: () => void;
  backupNow: () => void;
  openBackups: () => void;
  whereIsData: () => void;
  oneNoteColors: () => void;
  /** every page of every notebook (for the Link dialog) */
  pages: () => PageRef[];
  /** go to a page (a page link was clicked) */
  openRef: (kind: LinkKind, id: string) => void;
  exportPagePdf: () => void;
  printPage: () => void;
  exportPageMd: () => void;
  exportPageHtml: () => void;
  exportNotebookMd: () => void;
  exportAll: () => void;
  importAll: () => void;
  importOneNote: () => void;
}

interface Props {
  pageId: string;
  content: string;
  onChange: (html: string) => void;
  actions: RibbonActions;
}

type RibbonTab = "file" | "home" | "insert" | "table" | "history" | "view";
/** Remembered across pages (the editor is re-created for every page). */
const ribbonState: { tab: RibbonTab; collapsed: boolean } = (() => {
  try {
    const v = JSON.parse(localStorage.getItem("zornote:ribbon") ?? "{}");
    return { tab: v.tab ?? "home", collapsed: !!v.collapsed };
  } catch {
    return { tab: "home", collapsed: false };
  }
})();
/** View settings: crisp text, and the font/size used for text that has no font of its own. */
const viewPrefs: { crisp: boolean; font: string; size: string; bright: number } = (() => {
  try {
    const v = JSON.parse(localStorage.getItem("zornote:view") ?? "{}");
    return { crisp: v.crisp ?? true, font: v.font ?? "", size: v.size ?? "", bright: v.bright ?? 1 };
  } catch {
    return { crisp: true, font: "", size: "", bright: 1 };
  }
})();
/** "White text" levels: extra weight given to light text on dark shading (Linux draws thin strokes greyer than Windows). */
const BRIGHT_LEVELS = [
  { label: "Normal", stroke: "0.4px" },
  { label: "Bright", stroke: "0.55px" },
  { label: "Brightest", stroke: "0.7px" },
];
export function applyViewPrefs() {
  const root = document.documentElement;
  root.classList.toggle("crisp-text", viewPrefs.crisp);
  const f = FONTS.find((x) => x.label === viewPrefs.font);
  if (f) root.style.setProperty("--page-font", f.stack); else root.style.removeProperty("--page-font");
  if (viewPrefs.size) root.style.setProperty("--page-size", `${viewPrefs.size}pt`); else root.style.removeProperty("--page-size");
  root.style.setProperty("--dark-stroke", (BRIGHT_LEVELS[viewPrefs.bright] ?? BRIGHT_LEVELS[1]).stroke);
  try { localStorage.setItem("zornote:view", JSON.stringify(viewPrefs)); } catch { /* ignore */ }
}

const saveRibbon = () => { try { localStorage.setItem("zornote:ribbon", JSON.stringify(ribbonState)); } catch { /* ignore */ } };

function RGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rgroup">
      <div className="rg-body">{children}</div>
      <div className="rg-label">{label}</div>
    </div>
  );
}

function RBig({ icon, label, title, onClick, active }: { icon: ReactNode; label: string; title?: string; onClick: () => void; active?: boolean }) {
  return (
    <button className={"rbig" + (active ? " on" : "")} title={title ?? label} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function RSmall({ icon, label, title, onClick, active, disabled }: {
  icon: ReactNode; label: string; title?: string; onClick: () => void; active?: boolean; disabled?: boolean;
}) {
  return (
    <button className={"rsmall" + (active ? " on" : "")} title={title ?? label} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** OneNote's "Insert Table" grid: hover to choose the size, click to insert. */
function TableGrid({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [h, setH] = useState<[number, number]>([1, 2]);
  return (
    <div className="tgrid-wrap">
      <div className="tgrid-label">{h[1]} × {h[0]} Table</div>
      <div className="tgrid">
        {Array.from({ length: 8 }, (_, r) =>
          Array.from({ length: 10 }, (_, cl) => (
            <button
              key={r + "-" + cl}
              className={"tg-cell" + (r < h[0] && cl < h[1] ? " on" : "")}
              onMouseEnter={() => setH([r + 1, cl + 1])}
              onClick={() => onPick(r + 1, cl + 1)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Pop({ label, title, children, big }: { label: ReactNode; title: string; children: (close: () => void) => ReactNode; big?: boolean }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    if (at) return setAt(null);
    const r = btn.current!.getBoundingClientRect();
    setAt({ left: Math.max(4, Math.min(r.left, window.innerWidth - 320)), top: r.bottom + 4 });
  };
  return (
    <span className="pop-wrap">
      <button ref={btn} className={big ? "rbig" : "tb"} title={title} onMouseDown={(e) => e.preventDefault()} onClick={toggle}>
        {label}
      </button>
      {at && (
        <>
          <div className="pop-shield" onMouseDown={(e) => { e.preventDefault(); setAt(null); }} />
          <div className="pop" style={{ position: "fixed", left: at.left, top: at.top }} onMouseDown={(e) => e.preventDefault()}>
            {children(() => setAt(null))}
          </div>
        </>
      )}
    </span>
  );
}

/* ---------------------------------------------------------------------------------------------
 * OneNote's colour palette: Theme Colors (10 colours, each with 5 lighter/darker shades),
 * Standard Colors, Recent Colors and More Colors…  (values taken from OneNote)
 * ------------------------------------------------------------------------------------------- */
const THEME_BASE: [string, string][] = [
  ["#FFFFFF", "White, Background 1"], ["#000000", "Black, Text 1"], ["#E7E6E6", "Gray, Background 2"],
  ["#44546A", "Blue-Gray, Text 2"], ["#5B9BD5", "Blue, Accent 1"], ["#ED7D31", "Orange, Accent 2"],
  ["#E84C22", "Red, Accent 3"], ["#FFC000", "Gold, Accent 4"], ["#8064A2", "Purple, Accent 5"], ["#70AD47", "Green, Accent 6"],
];
const THEME_SHADES: string[][] = [
  ["#F2F2F2", "#D8D8D8", "#BFBFBF", "#A5A5A5", "#7F7F7F"],
  ["#7F7F7F", "#595959", "#3F3F3F", "#262626", "#0C0C0C"],
  ["#D0CECE", "#AEABAB", "#757070", "#3A3838", "#171616"],
  ["#D6DCE4", "#ADB9CA", "#8496B0", "#323F4F", "#222A35"],
  ["#DEEBF6", "#BDD7EE", "#9CC3E5", "#2E75B5", "#1E4E79"],
  ["#FBE5D5", "#F7CBAC", "#F4B183", "#C55A11", "#833C0B"],
  ["#FADBD2", "#F5B7A6", "#F1937A", "#B43512", "#78230C"],
  ["#FFF2CC", "#FEE599", "#FFD965", "#BF9000", "#7F6000"],
  ["#E5E0EC", "#CCC1D9", "#B2A1C7", "#5F497A", "#3F3151"],
  ["#E2EFD9", "#C5E0B3", "#A8D08D", "#538135", "#375623"],
];
const SHADE_NAMES = (col: number) =>
  col === 0 ? ["Darker 5%", "Darker 15%", "Darker 25%", "Darker 35%", "Darker 50%"]
  : col === 1 ? ["Lighter 50%", "Lighter 35%", "Lighter 25%", "Lighter 15%", "Lighter 5%"]
  : col === 2 ? ["Darker 10%", "Darker 25%", "Darker 50%", "Darker 75%", "Darker 90%"]
  : ["Lighter 80%", "Lighter 60%", "Lighter 40%", "Darker 25%", "Darker 50%"];
const STANDARD: [string, string][] = [
  ["#C00000", "Dark Red"], ["#FF0000", "Red"], ["#FFC000", "Orange"], ["#FFFF00", "Yellow"], ["#92D050", "Light Green"],
  ["#00B050", "Green"], ["#00B0F0", "Light Blue"], ["#0070C0", "Blue"], ["#002060", "Dark Blue"], ["#7030A0", "Purple"],
];

const RECENT_KEY = "zornote:recentColors";
const loadRecentColors = (): string[] => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
};
const pushRecentColor = (c: string) => {
  const v = c.toLowerCase();
  const next = [v, ...loadRecentColors().filter((x) => x !== v)].slice(0, 10);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
};

/** "rgb(58, 56, 56)" / "#3A3838" / "#abc" → "#3a3838" (so the current colour can be found in the palette). */
export function toHex(c?: string | null): string | null {
  if (!c) return null;
  const v = c.trim().toLowerCase();
  const m = v.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  if (/^#[0-9a-f]{3}$/.test(v)) return "#" + v.slice(1).split("").map((x) => x + x).join("");
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

function Swatches({
  onPick, onClear, close, clearLabel, current,
}: {
  colors?: string[]; onPick: (c: string) => void; onClear?: () => void; close: () => void; clearLabel?: string;
  /** the colour already applied — framed in the palette, like OneNote */
  current?: string | null;
}) {
  const cur = toHex(current);
  // a colour that is not in the palette (e.g. an older #3a3a3a) is shown first under Recent Colors, framed
  const recentAll = loadRecentColors();
  const inPalette = !!cur && [...THEME_BASE.map(([h]) => h), ...THEME_SHADES.flat(), ...STANDARD.map(([h]) => h), ...recentAll]
    .some((h) => h.toLowerCase() === cur);
  const recent = cur && !inPalette ? [cur, ...recentAll].slice(0, 10) : recentAll;
  const noColor = clearLabel === "No Color";
  // frame only ONE swatch: the first place the colour appears (theme row by row, then standard, then recent)
  const order: [string, string][] = [
    ...THEME_BASE.map(([h], i): [string, string] => ["b" + i, h]),
    ...[0, 1, 2, 3, 4].flatMap((r) => THEME_SHADES.map((col, ci): [string, string] => [`s${r}-${ci}`, col[r]])),
    ...STANDARD.map(([h], i): [string, string] => ["t" + i, h]),
    ...recent.map((h, i): [string, string] => ["r" + i, h]),
  ];
  const framed = cur ? order.find(([, h]) => h.toLowerCase() === cur)?.[0] : undefined;
  const pick = (c: string) => { const v = c.toLowerCase(); pushRecentColor(v); onPick(v); close(); };
  const sw = (hex: string, name: string, extra: string, id: string) => (
    <button key={id} className={"sw" + extra + (framed === id ? " cur" : "")} data-c={hex.toLowerCase()} style={{ background: hex }}
      title={`${name} (${hex.toUpperCase()})`} onClick={() => pick(hex)} />
  );
  return (
    <div className="opal" onMouseDown={(e) => e.preventDefault()}>
      {onClear && !noColor && (
        <button className={"opal-row" + (!cur ? " cur" : "")} onClick={() => { onClear(); close(); }}>
          <span className={"opal-auto" + (noColor ? " none" : "")} />
          <span><u>{(clearLabel ?? "Automatic")[0]}</u>{(clearLabel ?? "Automatic").slice(1)}</span>
        </button>
      )}
      <div className="opal-head">Theme Colors</div>
      <div className="opal-grid">{THEME_BASE.map(([h, n], i) => sw(h, n, "", "b" + i))}</div>
      <div className="opal-grid shades">
        {[0, 1, 2, 3, 4].map((r) => THEME_BASE.map(([, n], col) => sw(THEME_SHADES[col][r], `${n.split(",")[0]}, ${SHADE_NAMES(col)[r]}`, " sh", `s${r}-${col}`)))}
      </div>
      <div className="opal-head">Standard Colors</div>
      <div className="opal-grid">{STANDARD.map(([h, n], i) => sw(h, n, "", "t" + i))}</div>
      {recent.length > 0 && (
        <>
          <div className="opal-head">Recent Colors</div>
          <div className="opal-grid">{recent.map((h, i) => sw(h, "Recent", "", "r" + i))}</div>
        </>
      )}
      <div className="opal-sep" />
      {onClear && noColor && (
        <button className={"opal-row" + (!cur ? " cur" : "")} onClick={() => { onClear(); close(); }}>
          <span className={"opal-auto" + (noColor ? " none" : "")} />
          <span><u>{(clearLabel ?? "Automatic")[0]}</u>{(clearLabel ?? "Automatic").slice(1)}</span>
        </button>
      )}
      <label className="opal-row" title="Pick any colour">
        <span className="opal-more" /> More Colors…
        <input type="color" className="vh" onChange={(e) => pick(e.target.value)} />
      </label>
      <button
        className="opal-row"
        onClick={async () => {
          const v = ((await ask.prompt("Hex color, e.g. #3a3838", "#")) ?? "").trim();
          if (/^#?[0-9a-f]{6}$/i.test(v)) pick(v.startsWith("#") ? v : "#" + v);
        }}
      >
        <span className="opal-hex">#</span> Hex Color…
      </button>
    </div>
  );
}

type ShadeScope = "cell" | "table";

/**
 * Shading colours with a scope switch, like OneNote: with only the cursor in a table the colour goes on the whole
 * table; with cells selected it goes on those cells. The switch lets you pick the other one.
 */
function ShadePicker({
  colors, hasCellSel, onApply, close, current,
}: { colors: string[]; hasCellSel: boolean; onApply: (color: string | null, scope: ShadeScope) => void; close: () => void; current?: string | null }) {
  const [scope, setScope] = useState<ShadeScope>(hasCellSel ? "cell" : "table");
  return (
    <>
      <div className="scope" onMouseDown={(e) => e.preventDefault()}>
        <button className={scope === "cell" ? "on" : ""} onClick={() => setScope("cell")}>
          {hasCellSel ? "Selected cells" : "This cell"}
        </button>
        <button className={scope === "table" ? "on" : ""} onClick={() => setScope("table")}>Whole table</button>
      </div>
      <Swatches colors={colors} close={close} current={current} clearLabel="No Color" onPick={(c) => onApply(c, scope)} onClear={() => onApply(null, scope)} />
    </>
  );
}

/** What the menu's Copy / Cut took, so its Paste can bring back whole tables (the system clipboard may only allow text). */
let menuClip: { html: string; text: string } | null = null;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export default function Editor({ pageId, content, onChange, actions }: Props) {
  const actionsRef = useRef(actions);
  const linkDown = useRef<{ x: number; y: number } | null>(null);
  actionsRef.current = actions;
  /** Follow a link: a ZorNote page opens here, anything else in the browser. */
  const followLink = (href: string) => {
    if (!href) return;
    const z = parseZorLink(href);
    if (z) actionsRef.current.openRef(z.kind, z.id);
    else void openExternal(href).catch((err) => ask.alert("Could not open the link: " + err));
  };
  const [symOpen, setSymOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [view, setViewState] = useState({ ...viewPrefs });
  const setView = (v: typeof viewPrefs) => { Object.assign(viewPrefs, v); applyViewPrefs(); setViewState({ ...v }); };
  const [tab, setTabState] = useState<RibbonTab>(ribbonState.tab);
  const [collapsed, setCollapsed] = useState(ribbonState.collapsed);
  const setTab = (t: RibbonTab) => { ribbonState.tab = t; ribbonState.collapsed = false; saveRibbon(); setTabState(t); setCollapsed(false); };
  const toggleCollapsed = () => { ribbonState.collapsed = !collapsed; saveRibbon(); setCollapsed(!collapsed); };
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.getElementById("ribbon-host")), []);
  // keep the ribbon's height while the editor is re-created for another page (no jump)
  useEffect(() => { document.documentElement.style.setProperty("--ribbon-h", collapsed ? "34px" : "128px"); }, [collapsed]);
  // Format Painter: the marks to paint, set by the button, used on the next selection
  const painter = useRef<readonly Mark[] | null>(null);
  const [painting, setPainting] = useState(false);
  const [linkDlg, setLinkDlg] = useState<{ text: string; href: string; editing: boolean; from: number; to: number } | null>(null);
  const [shadeFly, setShadeFly] = useState<{ left: number; top: number } | null>(null);
  const [tmenu, setTmenu] = useState<{ x: number; y: number; inTable: boolean; hasCellSel: boolean; hasSel: boolean; onImage?: boolean; onLink?: string } | null>(null);
  const rightDown = useRef<Selection | null>(null); // the selection at the moment of the right mouse button press
  const menuSel = useRef<Selection | null>(null); // the selection the open menu works on
  const editor = useEditor({
    extensions: [
      // OneNote doesn't turn "# ", "> " or "---" into headings, quotes or lines while you type
      // (you start lines with "# az …"); the toolbar still makes headings and quotes.
      StarterKit.configure({ codeBlock: false, heading: false, blockquote: false, horizontalRule: false }),
      Heading.extend({ addInputRules: () => [] }).configure({ levels: [1, 2, 3] }),
      Blockquote.extend({ addInputRules: () => [] }),
      HorizontalRule.extend({ addInputRules: () => [] }),
      Underline,
      TextStyle,
      FontFamily,
      FontSize,
      LineSize,
      TableKeys,
      TableLink,
      BlockSelect,
      TableBorders,
      Tags,
      Color,
      Subscript,
      Superscript,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false, autolink: true, protocols: ["zornote"] }), // zornote://page/<id> = a link to a ZorNote page
      TaskList,
      TaskItem.configure({ nested: true }),
      ResizableImage.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true, handleWidth: 3 }), // thin grab zone: a selection drag near a border should not resize
      TableRow,
      ShadedHeader,
      ShadedCell,
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: "yaml" }),
      Callout,
      Placeholder.configure({ placeholder: "Start typing, or paste an image…" }),
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      handlePaste: (view, event) => {
        const plain = (event.clipboardData?.getData("text/plain") ?? "").trim();
        if (parseZorLink(plain) && !/\s/.test(plain)) {
          // a link copied with "Copy Link to Page/Section/Section Group": paste it as a link named after it (OneNote does this)
          const ref = findRef(actionsRef.current.pages(), plain);
          const { from, to, empty } = view.state.selection;
          const mark = view.state.schema.marks.link.create({ href: plain });
          const tr = view.state.tr;
          if (empty) {
            const label = ref ? refTitle(ref) : "Link";
            tr.insertText(label, from, to).addMark(from, from + label.length, mark);
          } else {
            tr.addMark(from, to, mark); // selected words become the link
          }
          view.dispatch(tr.scrollIntoView());
          return true;
        }
        const items = Array.from(event.clipboardData?.items ?? []);
        const img = items.find((i) => i.type.startsWith("image/"));
        const file = img?.getAsFile();
        if (!file) return false;
        insertImageFile(file);
        return true;
      },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
          event.preventDefault();
          openLinkDialogRef.current();
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        // a click on a link follows it, like OneNote (Alt+click just puts the cursor there)
        click: (view, event) => {
          const me = event as MouseEvent;
          if (me.button !== 0 || me.altKey || me.shiftKey) return false;
          const a = (me.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
          if (!a || !view.dom.contains(a)) return false;
          // a drag that selects text across a link is not a click on it
          const d = linkDown.current;
          if (d && Math.hypot(me.clientX - d.x, me.clientY - d.y) > 4) return false;
          me.preventDefault();
          followLink(a.getAttribute("href") ?? "");
          return true;
        },
        mouseover: (_view, event) => {
          const a = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
          if (!a) return false;
          const href = a.getAttribute("href") ?? "";
          const z = parseZorLink(href);
          if (z) {
            const ref = findRef(actionsRef.current.pages(), href);
            a.title = ref
              ? `Go to ${KIND_LABEL[ref.kind]}: ${refTitle(ref)}${ref.path ? ` (${ref.path})` : ""}`
              : `This ${KIND_LABEL[z.kind]} no longer exists`;
          } else {
            a.title = `${href}\nClick to open · Alt+click to edit the text`;
          }
          return false;
        },
        mouseup: (view) => {
          if (!painter.current) return false;
          setTimeout(() => {
            const marks = painter.current;
            const { from, to, empty } = view.state.selection;
            if (!marks || empty) return;
            const tr = view.state.tr;
            for (const m of Object.values(view.state.schema.marks)) {
              if (m.name !== "link") tr.removeMark(from, to, m);
            }
            for (const m of marks) if (m.type.name !== "link") tr.addMark(from, to, m);
            view.dispatch(tr);
            painter.current = null;
            setPainting(false);
          }, 0);
          return false;
        },
        keydown: (_view, event) => {
          if ((event as KeyboardEvent).key === "Escape" && painter.current) { painter.current = null; setPainting(false); }
          return false;
        },
        // A right press collapses a cell selection before the menu opens, so remember what was selected.
        mousedown: (view, event) => {
          const me = event as MouseEvent;
          linkDown.current = { x: me.clientX, y: me.clientY }; // to tell a click on a link from a drag
          if (me.button === 2) rightDown.current = view.state.selection;
          return false;
        },
        contextmenu: (view, event) => {
          event.preventDefault();
          const me = event as MouseEvent;
          const down = rightDown.current;
          rightDown.current = null;
          let sel: Selection = view.state.selection;
          // right-click on a picture: select the picture (menu shows picture options)
          const imgEl = (me.target as HTMLElement | null)?.closest?.(".zimg") as HTMLElement | null;
          if (imgEl && view.dom.contains(imgEl)) {
            const pos = view.posAtDOM(imgEl, 0);
            const at = [pos, pos - 1].find((p) => view.state.doc.nodeAt(p)?.type.name === "image");
            if (at != null) {
              const ns = NodeSelection.create(view.state.doc, at);
              view.dispatch(view.state.tr.setSelection(ns));
              menuSel.current = ns;
              setTmenu({ x: me.clientX, y: me.clientY, inTable: false, hasCellSel: false, hasSel: true, onImage: true });
              return true;
            }
          }
          let hit = view.posAtCoords({ left: me.clientX, top: me.clientY });
          // empty area of a tall cell (below its text): the hit can land outside the cell, so aim at the cell's end
          const cellEl = (me.target as HTMLElement | null)?.closest?.("td,th") as HTMLElement | null;
          if (cellEl && view.dom.contains(cellEl)) {
            const inside = hit && cellAround(view.state.doc.resolve(hit.pos))?.pos === view.posAtDOM(cellEl, 0) - 1;
            if (!inside) {
              const end = view.posAtDOM(cellEl, cellEl.childNodes.length);
              hit = { pos: end, inside: -1 };
            }
          }
          if (hit) {
            const $hit = view.state.doc.resolve(hit.pos);
            let keep = false;
            if (down instanceof CellSelection) {
              const cell = cellAround($hit);
              if (cell) down.forEachCell((_n, pos) => { if (pos === cell.pos) keep = true; });
            } else if (down && !down.empty) {
              keep = hit.pos >= down.from && hit.pos <= down.to; // right-click inside a text selection keeps it
            }
            sel = keep && down ? down : TextSelection.near($hit, -1);
          }
          if (!sel.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(sel));
          menuSel.current = sel;
          const linkEl = (me.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
          setTmenu({
            onLink: linkEl && view.dom.contains(linkEl) ? linkEl.getAttribute("href") ?? undefined : undefined,
            x: me.clientX,
            y: me.clientY,
            inTable: isInCell(view.state),
            hasCellSel: sel instanceof CellSelection,
            hasSel: !sel.empty || sel instanceof CellSelection,
          });
          return true;
        },
      },
      handleDrop: (_view, event) => {
        const file = event.dataTransfer?.files?.[0];
        if (file && file.type.startsWith("image/")) {
          event.preventDefault();
          insertImageFile(file);
          return true;
        }
        return false;
      },
    },
  });

  function insertImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      editor?.chain().focus().setImage({ src: String(reader.result) }).run();
    };
    reader.readAsDataURL(file);
  }

  // Swap content when the user selects a different page.
  useEffect(() => {
    if (editor && editor.getHTML() !== content) {
      editor.commands.setContent(content, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, editor]);

  if (!editor) return null;

  const B = ({
    label, title, active, onClick,
  }: { label: ReactNode; title: string; active?: boolean; onClick: () => void }) => (
    <button
      className={"tb" + (active ? " on" : "")}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );

  const c = () => editor.chain().focus();

  /** Run a table-menu action: close the menu first, then act on the selection the user right-clicked. */
  const restoreMenuSel = () => {
    const s = menuSel.current;
    if (s && !s.eq(editor.state.selection)) {
      try { editor.view.dispatch(editor.state.tr.setSelection(s)); } catch { /* the page changed under the menu */ }
    }
  };
  const tm = (fn: () => void) => () => { setTmenu(null); restoreMenuSel(); fn(); };

  /** Shade the cells the menu / toolbar was opened on, or the whole table. */
  const applyShade = (color: string | null, scope: ShadeScope) => {
    if (scope === "table") setTableShading(editor.state, (t) => editor.view.dispatch(t), color);
    else c().setCellAttribute("backgroundColor", color).run();
  };

  const copyOrCut = (cut: boolean) => {
    const view = editor.view;
    const { dom, text } = view.serializeForClipboard(view.state.selection.content());
    menuClip = { html: dom.innerHTML, text };
    view.focus();
    document.execCommand(cut ? "cut" : "copy");
  };

  const pasteFromMenu = async () => {
    let sys = "";
    try { sys = await navigator.clipboard.readText(); } catch { /* clipboard reading not allowed here */ }
    const view = editor.view;
    view.focus();
    // our own copy still matches the clipboard (or the clipboard cannot be read): paste it with all its structure
    if (menuClip && (!sys || norm(sys) === norm(menuClip.text))) view.pasteHTML(menuClip.html);
    else if (sys) view.pasteText(sys);
  };

  useEffect(() => { if (!tmenu) setShadeFly(null); }, [tmenu]);

  /** Shading of the cell the cursor is in (to frame it in the palette). */
  const cellShade = (): string | null => {
    const $cell = safeCell(editor.state);
    return ($cell?.nodeAfter?.attrs.backgroundColor as string | undefined) ?? null;
  };

  /** Open the Shading palette beside the right-click menu (like OneNote's Shading ▸ submenu). */
  const openShadeFly = (btn: HTMLElement) => {
    const menu = btn.closest(".tmenu")!.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    const W = 290, H = 470;
    const left = menu.right + W + 4 <= window.innerWidth ? menu.right + 2 : Math.max(4, menu.left - W - 2);
    setShadeFly({ left, top: Math.max(4, Math.min(r.top - 6, window.innerHeight - H - 4)) });
  };

  /** Ctrl+K / Link…: the Link dialog for the selected words, the link under the cursor, or a new link. */
  const openLinkDialog = () => {
    const { state } = editor;
    const { from, to, empty } = state.selection;
    if (editor.isActive("link")) {
      // the whole link the cursor is in
      const href = editor.getAttributes("link").href as string;
      const range = getMarkRange(state.doc.resolve(from), state.schema.marks.link, { href });
      const a = range?.from ?? from, b = range?.to ?? to;
      setLinkDlg({ text: state.doc.textBetween(a, b), href, editing: true, from: a, to: b });
      return;
    }
    setLinkDlg({ text: empty ? "" : state.doc.textBetween(from, to, " "), href: "", editing: false, from, to });
  };
  const openLinkDialogRef = useRef(openLinkDialog);
  openLinkDialogRef.current = openLinkDialog;

  const applyLink = (text: string, href: string) => {
    const d = linkDlg;
    setLinkDlg(null);
    if (!d) return;
    const { state } = editor;
    const mark = state.schema.marks.link.create({ href });
    const tr = state.tr;
    const original = d.from < d.to ? state.doc.textBetween(d.from, d.to, " ") : "";
    if (d.from < d.to && text === original) {
      tr.removeMark(d.from, d.to, state.schema.marks.link).addMark(d.from, d.to, mark);
    } else {
      // new text: keep the formatting of where it goes, add the link
      const marks = state.doc.resolve(d.from).marks().filter((m) => m.type !== state.schema.marks.link);
      tr.replaceWith(d.from, d.to, state.schema.text(text, [...marks, mark]));
    }
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
  };

  const removeLink = () => {
    const d = linkDlg;
    setLinkDlg(null);
    if (!d) return;
    editor.view.dispatch(editor.state.tr.removeMark(d.from, d.to, editor.state.schema.marks.link));
    editor.view.focus();
  };

  const togglePainter = () => {
    if (painter.current) { painter.current = null; setPainting(false); return; }
    const { selection, storedMarks } = editor.state;
    const $p = selection.empty ? selection.$from : editor.state.doc.resolve(Math.min(selection.from + 1, selection.to));
    painter.current = storedMarks ?? $p.marks();
    setPainting(true);
    editor.view.focus();
  };

  const insertSymbol = (ch: string) => {
    c().insertContent(ch).run();
    setRecent((r) => {
      const next = [ch, ...r.filter((x) => x !== ch)].slice(0, 20);
      saveRecent(next);
      return next;
    });
  };
  const quickSymbols = [...recent, ...DEFAULT_SYMBOLS.filter((x) => !recent.includes(x))].slice(0, 20);

  const codeLang = (editor.getAttributes("codeBlock").language as string | undefined) ?? "yaml";

  const ts = editor.getAttributes("textStyle");
  const curFont = fontLabelFor(ts.fontFamily as string | undefined);
  const curFontStatus = curFont ? fontStatus(FONTS.find((f) => f.label === curFont)!.stack) : null;
  const curFontMissing = !!curFontStatus && !curFontStatus.ok;
  const curSize = ((ts.fontSize as string | undefined) ?? "").replace("pt", "");
  const curStyle = editor.isActive("heading", { level: 1 }) ? "h1"
    : editor.isActive("heading", { level: 2 }) ? "h2"
    : editor.isActive("heading", { level: 3 }) ? "h3"
    : editor.isActive("codeBlock") ? "code"
    : editor.isActive("blockquote") ? "quote" : "p";

  const setStyle = (v: string) => {
    const ch = c();
    if (v === "p") ch.setParagraph().run();
    else if (v === "code") ch.toggleCodeBlock().run();
    else if (v === "quote") ch.toggleBlockquote().run();
    else ch.setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
  };

  const inTable = editor.isActive("table");
  const inList = editor.isActive("bulletList") || editor.isActive("orderedList") || editor.isActive("taskList");
  const itemType = editor.isActive("taskList") ? "taskItem" : "listItem";

  const sel = editor.state.selection;
  const hasSel = !sel.empty || sel instanceof CellSelection;
  const inCode = editor.isActive("codeBlock");
  const shownTab: RibbonTab = tab === "table" && !inTable ? "home" : tab;
  const tagOf = (editor.getAttributes("paragraph").tag ?? editor.getAttributes("heading").tag) as string | undefined;
  const tbl = (fn: (s: EditorState, d: (t: Transaction) => void) => boolean) => () => {
    fn(editor.state, (t) => editor.view.dispatch(t));
    editor.view.focus();
  };

  const ribbon = (
    <div className={"ribbon" + (collapsed ? " collapsed" : "")}>
      <div className="ribbon-tabs">
        <button className="qa" title="Undo (Ctrl+Z)" onMouseDown={(e) => e.preventDefault()} onClick={() => c().undo().run()}><Icon name="undo" /></button>
        <button className="qa" title="Redo (Ctrl+Y)" onMouseDown={(e) => e.preventDefault()} onClick={() => c().redo().run()}><Icon name="redo" /></button>
        <span className="qa-sep" />
        {([
          ["file", "File"], ["home", "Home"], ["insert", "Insert"], ["history", "History"], ["view", "View"],
        ] as [RibbonTab, string][]).map(([t, label]) => (
          <button key={t} className={"rtab" + (shownTab === t ? " on" : "")} onMouseDown={(e) => e.preventDefault()} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
        {inTable && (
          <button className={"rtab ctx-tab" + (shownTab === "table" ? " on" : "")} onMouseDown={(e) => e.preventDefault()} onClick={() => setTab("table")}>
            Table
          </button>
        )}
        <span className="rtab-fill" />
        <button className="qa" title={collapsed ? "Show the ribbon" : "Collapse the ribbon"} onMouseDown={(e) => e.preventDefault()} onClick={toggleCollapsed}>
          <Icon name={collapsed ? "chevDown" : "chevUp"} />
        </button>
      </div>

      {!collapsed && (
        <div className="ribbon-body">
          {shownTab === "home" && (
            <>
              <RGroup label="Clipboard">
                <RBig icon={<Icon name="paste" size={28} />} label="Paste" title="Paste (Ctrl+V)" onClick={() => { void pasteFromMenu(); }} />
                <div className="rcol">
                  <RSmall icon={<Icon name="cut" />} label="Cut" title="Cut (Ctrl+X)" disabled={!hasSel} onClick={() => copyOrCut(true)} />
                  <RSmall icon={<Icon name="copy" />} label="Copy" title="Copy (Ctrl+C)" disabled={!hasSel} onClick={() => copyOrCut(false)} />
                  <RSmall
                    icon={<Icon name="painter" />} label="Format Painter" active={painting}
                    title="Format Painter: copy the formatting where the cursor is, then select the text to paint it on (Esc to cancel)"
                    onClick={togglePainter}
                  />
                </div>
              </RGroup>

              <RGroup label="Basic Text">
                <div className="rcol">
                  <div className="rrow">
                    <select
                      className={"tsel font" + (curFontMissing ? " missing" : "")}
                      title={curFontMissing ? `${curFont} is not installed on this computer, so another font is shown${curFontStatus?.using ? ` (${curFontStatus.using})` : ""}. See README → Fonts.` : "Font"}
                      value={curFont}
                      onChange={(e) => {
                        const f = FONTS.find((x) => x.label === e.target.value);
                        if (f) c().setFontFamily(f.stack).run();
                        else c().unsetFontFamily().run();
                      }}
                    >
                      <option value="">Default font</option>
                      {FONTS.map((f) => {
                        const st = fontStatus(f.stack);
                        return (
                          <option key={f.label} value={f.label} style={{ fontFamily: f.stack, color: st.ok ? undefined : "#8a8886" }}>
                            {f.label}{st.ok ? "" : st.using ? ` — not installed (shows ${st.using})` : " — not installed"}
                          </option>
                        );
                      })}
                    </select>
                    <select
                      className="tsel size" title="Font size (pt)" value={SIZES.includes(curSize) ? curSize : ""}
                      onChange={(e) => (e.target.value ? c().setFontSize(`${e.target.value}pt`).run() : c().unsetFontSize().run())}
                    >
                      <option value="">Size</option>
                      {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <B label={<Icon name="bullets" />} title="Bullets" active={editor.isActive("bulletList")} onClick={() => c().toggleBulletList().run()} />
                    <B label={<Icon name="numbers" />} title="Numbering" active={editor.isActive("orderedList")} onClick={() => c().toggleOrderedList().run()} />
                    <B label={<Icon name="outdent" />} title="Decrease indent (Shift+Tab)" onClick={() => inList && c().liftListItem(itemType).run()} />
                    <B label={<Icon name="indent" />} title="Increase indent (Tab)" onClick={() => inList && c().sinkListItem(itemType).run()} />
                    <B label={<Icon name="clear" />} title="Clear all formatting" onClick={() => c().unsetAllMarks().clearNodes().run()} />
                  </div>
                  <div className="rrow">
                    <B label={<b>B</b>} title="Bold (Ctrl+B)" active={editor.isActive("bold")} onClick={() => c().toggleBold().run()} />
                    <B label={<i>I</i>} title="Italic (Ctrl+I)" active={editor.isActive("italic")} onClick={() => c().toggleItalic().run()} />
                    <B label={<u>U</u>} title="Underline (Ctrl+U)" active={editor.isActive("underline")} onClick={() => c().toggleUnderline().run()} />
                    <B label={<s>ab</s>} title="Strikethrough" active={editor.isActive("strike")} onClick={() => c().toggleStrike().run()} />
                    <B label={<span>x<sub>2</sub></span>} title="Subscript" active={editor.isActive("subscript")} onClick={() => c().toggleSubscript().run()} />
                    <B label={<span>x<sup>2</sup></span>} title="Superscript" active={editor.isActive("superscript")} onClick={() => c().toggleSuperscript().run()} />
                    <span className="sep" />
                    <Pop label={<span className="hl-ico">ab</span>} title="Text highlight color">
                      {(close) => (
                        <Swatches colors={FILL_COLORS} close={close} clearLabel="No Color" current={editor.getAttributes("highlight").color as string | undefined}
                          onPick={(col) => c().setHighlight({ color: col }).run()} onClear={() => c().unsetHighlight().run()} />
                      )}
                    </Pop>
                    <Pop label={<span className="fc-ico">A</span>} title="Font color">
                      {(close) => (
                        <Swatches colors={TEXT_COLORS} close={close} current={editor.getAttributes("textStyle").color as string | undefined}
                          onPick={(col) => c().setColor(col).run()} onClear={() => c().unsetColor().run()} />
                      )}
                    </Pop>
                    <Pop label={<Icon name="alignLeft" />} title="Paragraph alignment">
                      {(close) => (
                        <div className="pop-list">
                          <button className="pop-item" onClick={() => { c().setTextAlign("left").run(); close(); }}><Icon name="alignLeft" /> Align Left</button>
                          <button className="pop-item" onClick={() => { c().setTextAlign("center").run(); close(); }}><Icon name="alignCenter" /> Center</button>
                          <button className="pop-item" onClick={() => { c().setTextAlign("right").run(); close(); }}><Icon name="alignRight" /> Align Right</button>
                        </div>
                      )}
                    </Pop>
                    <B label={<Icon name="link" />} title="Link (Ctrl+K)" active={editor.isActive("link")} onClick={openLinkDialog} />
                    <B label={<Icon name="del" color="#d13438" />} title="Delete" onClick={() => c().deleteSelection().run()} />
                  </div>
                </div>
              </RGroup>

              <RGroup label="Styles">
                <div className="gallery styles">
                  <button className={"st h1" + (curStyle === "h1" ? " on" : "")} onMouseDown={(e) => e.preventDefault()} onClick={() => setStyle(curStyle === "h1" ? "p" : "h1")}>Heading 1</button>
                  <button className={"st h2" + (curStyle === "h2" ? " on" : "")} onMouseDown={(e) => e.preventDefault()} onClick={() => setStyle(curStyle === "h2" ? "p" : "h2")}>Heading 2</button>
                </div>
                <Pop label={<Icon name="chevDown" />} title="All styles">
                  {(close) => (
                    <div className="pop-list styles-list">
                      {([["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["p", "Normal"], ["quote", "Quote"], ["code", "Code"]] as const).map(([v, l]) => (
                        <button key={v} className={"pop-item st-" + v + (curStyle === v ? " on" : "")} onClick={() => { setStyle(v); close(); }}>{l}</button>
                      ))}
                    </div>
                  )}
                </Pop>
              </RGroup>

              <RGroup label="Tags">
                <div className="gallery tags">
                  <button className={"tg" + (tagOf === "todo" || tagOf === "done" ? " on" : "")} onMouseDown={(e) => e.preventDefault()} onClick={() => c().toggleTag("todo").run()}>
                    <span className="tag-ico todo" /> To Do (Ctrl+1)
                  </button>
                  <button className={"tg" + (tagOf === "important" ? " on" : "")} onMouseDown={(e) => e.preventDefault()} onClick={() => c().toggleTag("important").run()}>
                    <Icon name="star" color="#f7a400" /> Important (Ctrl+2)
                  </button>
                </div>
                <Pop label={<Icon name="chevDown" />} title="All tags">
                  {(close) => (
                    <div className="pop-list">
                      {TAG_INFO.map((t) => (
                        <button key={t.tag} className="pop-item" onClick={() => { c().toggleTag(t.tag).run(); close(); }}>
                          <span className={"tag-ico " + t.tag} /> {t.label} ({t.key})
                        </button>
                      ))}
                      <button className="pop-item" onClick={() => { c().removeTags().run(); close(); }}>Remove tag (Ctrl+0)</button>
                    </div>
                  )}
                </Pop>
                <RBig icon={<span className="todo-big">✓</span>} label="To Do Tag" title="To Do tag (Ctrl+1)" onClick={() => c().toggleTag("todo").run()} />
                <RBig icon={<Icon name="find" size={26} />} label="Find Tags" title="List every tagged line in all notebooks" onClick={actions.findTags} />
              </RGroup>

              {inCode && (
                <RGroup label="Code">
                  <select className="tsel" value={codeLang} onChange={(e) => c().updateAttributes("codeBlock", { language: e.target.value }).run()}>
                    {LANGS.map((l) => <option key={l}>{l}</option>)}
                  </select>
                </RGroup>
              )}
            </>
          )}

          {shownTab === "insert" && (
            <>
              <RGroup label="Tables">
                <Pop big label={<><Icon name="table" size={28} /><span>Table</span></>} title="Insert a table">
                  {(close) => <TableGrid onPick={(r, cl) => { c().insertTable({ rows: r, cols: cl, withHeaderRow: false }).run(); close(); }} />}
                </Pop>
              </RGroup>
              <RGroup label="Images">
                <label className="rbig" title="Insert a picture from a file (or paste one with Ctrl+V)">
                  <Icon name="picture" size={28} />
                  <span>Picture</span>
                  <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) insertImageFile(f); e.target.value = ""; }} />
                </label>
              </RGroup>
              <RGroup label="Links">
                <RBig icon={<Icon name="link" size={28} />} label="Link" title="Link (Ctrl+K)" onClick={openLinkDialog} />
              </RGroup>
              <RGroup label="Time Stamp">
                <RBig icon={<Icon name="date" size={28} />} label="Date" title="Insert today's date (dd-mm-yyyy)" onClick={() => c().insertContent(dateStamp()).run()} />
              </RGroup>
              <RGroup label="Pages">
                <Pop big label={<><Icon name="template" size={28} /><span>Templates</span></>} title="Insert a template">
                  {(close) => (
                    <div className="pop-list">
                      {TEMPLATES.map((t) => (
                        <button key={t.name} className="pop-item" onClick={() => { c().insertContent(t.html()).run(); close(); }}>{t.name}</button>
                      ))}
                    </div>
                  )}
                </Pop>
              </RGroup>
              <RGroup label="Blocks">
                <div className="rcol">
                  <Pop label={<><Icon name="panel" /> <span>Panel</span></>} title="Colored panel (container)">
                    {(close) => (
                      <>
                        <Swatches colors={PANEL_COLORS} close={close} current={editor.isActive("callout") ? (editor.getAttributes("callout").color as string) : null} onPick={(col) => c().setCallout(col).run()} />
                        {editor.isActive("callout") && <button className="pop-item" onClick={() => { c().unsetCallout().run(); close(); }}>Remove panel</button>}
                      </>
                    )}
                  </Pop>
                  <RSmall icon={<Icon name="code" />} label="Code Block" title="Code block (syntax highlighted)" active={inCode} onClick={() => c().toggleCodeBlock().run()} />
                  <RSmall icon={<Icon name="quote" />} label="Quote" title="Quote" active={editor.isActive("blockquote")} onClick={() => c().toggleBlockquote().run()} />
                </div>
                <div className="rcol">
                  <RSmall icon={<Icon name="line" />} label="Line" title="Horizontal line" onClick={() => c().setHorizontalRule().run()} />
                  <RSmall icon={<Icon name="todo" />} label="Checklist" title="To-do checklist" active={editor.isActive("taskList")} onClick={() => c().toggleTaskList().run()} />
                </div>
              </RGroup>
              <RGroup label="Symbols">
                <Pop big label={<><span className="omega">Ω</span><span>Symbol</span></>} title="Insert symbol">
                  {(close) => (
                    <div className="sym-pop">
                      <div className="sym-quick">
                        {quickSymbols.map((ch) => (
                          <button key={ch} className="sym" title={ch} onClick={() => { insertSymbol(ch); close(); }}>{ch}</button>
                        ))}
                      </div>
                      <button className="pop-item" onClick={() => { close(); setSymOpen(true); }}>Ω More Symbols…</button>
                    </div>
                  )}
                </Pop>
              </RGroup>
            </>
          )}

          {shownTab === "table" && (
            <>
              <RGroup label="Select">
                <div className="rcol">
                  <RSmall icon={<Icon name="table" />} label="Select Table" onClick={tbl(selectTable)} />
                  <RSmall icon={<Icon name="selCol" />} label="Select Columns" onClick={tbl(selectColumn)} />
                </div>
                <div className="rcol">
                  <RSmall icon={<Icon name="selRow" />} label="Select Rows" onClick={tbl(selectRow)} />
                  <RSmall icon={<Icon name="selCell" />} label="Select Cell" onClick={tbl(selectCell)} />
                </div>
              </RGroup>
              <RGroup label="Delete">
                <RBig icon={<Icon name="delTable" size={28} />} label="Delete Table" onClick={() => c().deleteTable().run()} />
                <div className="rcol">
                  <RSmall icon={<Icon name="delCol" />} label="Delete Columns" onClick={() => c().deleteColumn().run()} />
                  <RSmall icon={<Icon name="delRow" />} label="Delete Rows" onClick={() => c().deleteRow().run()} />
                </div>
              </RGroup>
              <RGroup label="Insert">
                <div className="rcol">
                  <RSmall icon={<Icon name="rowAbove" />} label="Insert Above" onClick={() => c().addRowBefore().run()} />
                  <RSmall icon={<Icon name="rowBelow" />} label="Insert Below" onClick={() => c().addRowAfter().run()} />
                </div>
                <div className="rcol">
                  <RSmall icon={<Icon name="colLeft" />} label="Insert Left" onClick={() => c().addColumnBefore().run()} />
                  <RSmall icon={<Icon name="colRight" />} label="Insert Right" onClick={() => c().addColumnAfter().run()} />
                </div>
              </RGroup>
              <RGroup label="Merge">
                <div className="rcol">
                  <RSmall icon={<Icon name="merge" />} label="Merge Cells" disabled={!(sel instanceof CellSelection)} onClick={() => c().mergeCells().run()} />
                  <RSmall icon={<Icon name="split" />} label="Split Cells" onClick={() => c().splitCell().run()} />
                </div>
              </RGroup>
              <RGroup label="Format">
                <Pop big label={<><Icon name="bucket" size={28} /><span>Shading</span></>} title="Shading (whole table, or the selected cells)">
                  {(close) => (
                    <ShadePicker colors={SHADE_COLORS} close={close} hasCellSel={sel instanceof CellSelection} current={cellShade()} onApply={applyShade} />
                  )}
                </Pop>
                <div className="rcol">
                  <RSmall icon={<Icon name="dupRow" />} label="Duplicate Row" onClick={tbl(duplicateRow)} />
                  <RSmall icon={<Icon name="fit" />} label="Fit to Page Width" onClick={() => { fitTableWidth(editor.view); editor.view.focus(); }} />
                  <RSmall icon={<Icon name="borders" />} label="Hide Borders" active={bordersHidden(editor.state)} title="Hide / show the lines of this table (or of all selected tables)" onClick={tbl((st, d) => setTableBorders(st, d))} />
                </div>
              </RGroup>
            </>
          )}

          {shownTab === "history" && (
            actions.desktop ? (
              <>
                <RGroup label="Versions">
                  <RBig icon={<Icon name="clock" size={28} />} label="Page Versions" title="Older versions of this page" onClick={actions.pageVersions} />
                  <RBig icon={<Icon name="trash" size={28} />} label="Recently Deleted" title="Deleted pages, sections and groups" onClick={actions.deletedPages} />
                </RGroup>
                <RGroup label="Backups">
                  <RBig icon={<Icon name="save" size={28} />} label="Back Up Now" title="Write a backup copy now" onClick={actions.backupNow} />
                  <div className="rcol">
                    <RSmall icon={<Icon name="folder" />} label="Open Backups Folder" onClick={actions.openBackups} />
                    <RSmall icon={<Icon name="info" />} label="Where Is My Data?" onClick={actions.whereIsData} />
                  </div>
                </RGroup>
              </>
            ) : (
              <div className="rnote">Page versions and backups are available in the installed app.</div>
            )
          )}

          {shownTab === "view" && (
            <>
            <RGroup label="Text">
              <RBig
                icon={<span className="crisp-ico">Aa</span>} label="Crisp Text" active={view.crisp}
                title="Draw small text a little heavier and sharper, like ClearType on Windows"
                onClick={() => setView({ ...view, crisp: !view.crisp })}
              />
              <div className="rcol">
                <label className="rlabel">Default font
                  <select className="tsel font" value={view.font} title="Font for text that has no font of its own"
                    onChange={(e) => setView({ ...view, font: e.target.value })}>
                    <option value="">ZorNote default</option>
                    {FONTS.map((f) => {
                      const st = fontStatus(f.stack);
                      return <option key={f.label} value={f.label}>{f.label}{st.ok ? "" : " — not installed"}</option>;
                    })}
                  </select>
                </label>
                <label className="rlabel">White text
                  <select className="tsel" value={view.bright} title="How bright light text looks on dark shading"
                    onChange={(e) => setView({ ...view, bright: Number(e.target.value), crisp: true })}>
                    {BRIGHT_LEVELS.map((b, i) => <option key={b.label} value={i}>{b.label}</option>)}
                  </select>
                </label>
                <label className="rlabel">Default size
                  <select className="tsel size" value={view.size} onChange={(e) => setView({ ...view, size: e.target.value })}>
                    <option value="">10.5</option>
                    {SIZES.filter((x) => Number(x) >= 6).map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
              </div>
            </RGroup>
            <RGroup label="Views">
              <RBig icon={<Icon name={actions.fullPage ? "unfull" : "full"} size={28} />} label={actions.fullPage ? "Normal View" : "Full Page View"} title="Full page view (Esc to leave)" active={actions.fullPage} onClick={actions.toggleFullPage} />
              <RBig icon={<Icon name="chevUp" size={28} />} label="Collapse Ribbon" title="Show only the tab names (click a tab to open it again)" onClick={toggleCollapsed} />
            </RGroup>
            </>
          )}

          {shownTab === "file" && (
            <>
              <RGroup label="Page">
                <RBig icon={<Icon name="pdf" size={28} />} label="Export to PDF" title="Save this page as a PDF file (A4; wide pages go landscape and are scaled to fit)" onClick={actions.exportPagePdf} />
                <RBig icon={<Icon name="printer" size={28} />} label="Print…" title="Print this page" onClick={actions.printPage} />
              </RGroup>
              <RGroup label="Export">
                <div className="rcol">
                  <RSmall icon={<Icon name="export" />} label="Page → Markdown" onClick={actions.exportPageMd} />
                  <RSmall icon={<Icon name="export" />} label="Page → HTML" onClick={actions.exportPageHtml} />
                </div>
                <div className="rcol">
                  <RSmall icon={<Icon name="export" />} label="Notebook → Markdown" onClick={actions.exportNotebookMd} />
                  <RSmall icon={<Icon name="export" />} label="Everything → .json" onClick={actions.exportAll} />
                </div>
              </RGroup>
              <RGroup label="Colours">
                <RBig icon={<Icon name="bucket" size={28} />} label="Use OneNote Colours" title="Switch older ZorNote shading colours on all pages to the exact OneNote ones" onClick={actions.oneNoteColors} />
              </RGroup>
              <RGroup label="Import">
                <div className="rcol">
                  <RSmall icon={<Icon name="import" />} label="From .json…" onClick={actions.importAll} />
                  <RSmall icon={<Icon name="cloud" />} label="From OneNote (Graph)…" onClick={actions.importOneNote} />
                </div>
              </RGroup>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className={"editor-wrap" + (painting ? " painting" : "")}>
      {host ? createPortal(ribbon, host) : ribbon}
      <EditorContent editor={editor} className="editor" />
      {linkDlg && (
        <LinkDialog
          initialText={linkDlg.text}
          initialHref={linkDlg.href}
          editing={linkDlg.editing}
          pages={actions.pages()}
          onOk={applyLink}
          onRemove={removeLink}
          onCancel={() => { setLinkDlg(null); editor.view.focus(); }}
        />
      )}
      {tmenu && (
        <>
          <div className="ctx-overlay" onClick={() => { setTmenu(null); setShadeFly(null); }} onContextMenu={(e) => { e.preventDefault(); setTmenu(null); setShadeFly(null); }} />
          <div
            className="ctx tmenu"
            style={{ left: Math.max(8, Math.min(tmenu.x, window.innerWidth - 250)), top: Math.max(8, Math.min(tmenu.y, window.innerHeight - (tmenu.inTable ? 520 : 170))) }}
            onMouseDown={(e) => e.preventDefault()}
            onMouseOver={(e) => { if (!(e.target as HTMLElement).closest(".shade-open")) setShadeFly(null); }}
          >
            <button disabled={!tmenu.hasSel} onClick={tm(() => copyOrCut(true))}>Cut</button>
            <button disabled={!tmenu.hasSel} onClick={tm(() => copyOrCut(false))}>Copy</button>
            <button onClick={tm(() => { void pasteFromMenu(); })}>Paste</button>
            {tmenu.onLink ? (
              <>
                <div className="ctx-sep" />
                <button onClick={tm(() => openLinkDialog())}>Edit Link…</button>
                <button onClick={tm(() => followLink(tmenu.onLink!))}>Open Link</button>
                <button onClick={tm(() => { void navigator.clipboard.writeText(tmenu.onLink!).catch(() => {}); })}>Copy Link</button>
                <button onClick={tm(() => { c().extendMarkRange("link").unsetLink().run(); })}>Remove Link</button>
              </>
            ) : !tmenu.onImage && (
              <button onClick={tm(() => openLinkDialog())}>Link…<span className="ctx-key">Ctrl+K</span></button>
            )}
            {tmenu.onImage && (
              <>
                <div className="ctx-sep" />
                <div className="ctx-label">Picture</div>
                <button onClick={tm(() => c().updateAttributes("image", { width: null, height: null }).run())}>Restore to Original Size</button>
                {[25, 50, 75].map((pct) => (
                  <button key={pct} onClick={tm(() => {
                    const sel = editor.state.selection as NodeSelection;
                    const dom = editor.view.nodeDOM(sel.from) as HTMLElement | null;
                    const im = dom?.querySelector("img");
                    if (im?.naturalWidth) c().updateAttributes("image", { width: Math.round(im.naturalWidth * pct / 100), height: null }).run();
                  })}>Size {pct}%</button>
                ))}
                <button onClick={tm(() => {
                  const sel = editor.state.selection as NodeSelection;
                  const dom = editor.view.nodeDOM(sel.from) as HTMLElement | null;
                  const host = dom?.parentElement;
                  if (host) c().updateAttributes("image", { width: Math.round(host.clientWidth - 4), height: null }).run();
                })}>Fit to Page Width</button>
              </>
            )}
            {!tmenu.inTable && !tmenu.onImage && <button onClick={tm(() => { editor.chain().focus().selectAll().run(); })}>Select all</button>}
            {editor.state.selection instanceof BlockRangeSelection && (
              <>
                <div className="ctx-sep" />
                <button onClick={tm(() => setTableBorders(editor.state, (t) => editor.view.dispatch(t)))}>
                  {bordersHidden(editor.state) ? "Show borders (selected tables)" : "Hide borders (selected tables)"}
                </button>
              </>
            )}
            {tmenu.inTable && (
              <>
                <div className="ctx-sep" />
                <button
                  className={"shade-open" + (shadeFly ? " on" : "")}
                  onMouseEnter={(e) => openShadeFly(e.currentTarget)}
                  onClick={(e) => openShadeFly(e.currentTarget)}
                >
                  <Icon name="bucket" /> Shading <span className="ctx-arrow">▸</span>
                </button>
                <div className="ctx-sep" />
                <button onClick={tm(() => c().addRowBefore().run())}>Insert row above</button>
                <button onClick={tm(() => c().addRowAfter().run())}>Insert row below</button>
                <button onClick={tm(() => c().addColumnBefore().run())}>Insert column left</button>
                <button onClick={tm(() => c().addColumnAfter().run())}>Insert column right</button>
                <button onClick={tm(() => duplicateRow(editor.state, (t) => editor.view.dispatch(t)))}>Duplicate row</button>
                <div className="ctx-sep" />
                <button onClick={tm(() => c().deleteRow().run())}>Delete row</button>
                <button onClick={tm(() => c().deleteColumn().run())}>Delete column</button>
                <button className="danger" onClick={tm(() => c().deleteTable().run())}>Delete table</button>
                <div className="ctx-sep" />
                {editor.can().mergeCells() && <button onClick={tm(() => c().mergeCells().run())}>Merge cells</button>}
                {editor.can().splitCell() && <button onClick={tm(() => c().splitCell().run())}>Split cell</button>}
                <button onClick={tm(() => fitTableWidth(editor.view))}>Fit table to page width</button>
                <button onClick={tm(() => setTableBorders(editor.state, (t) => editor.view.dispatch(t)))}>
                  {bordersHidden(editor.state) ? "Show borders" : "Hide borders"}
                </button>
                <div className="ctx-sep" />
                <div className="ctx-label">Select</div>
                <button onClick={tm(() => { selectCell(editor.state, (t) => editor.view.dispatch(t)); editor.view.focus(); })}>Cell</button>
                <button onClick={tm(() => { selectRow(editor.state, (t) => editor.view.dispatch(t)); editor.view.focus(); })}>Row</button>
                <button onClick={tm(() => { selectColumn(editor.state, (t) => editor.view.dispatch(t)); editor.view.focus(); })}>Column</button>
                <button onClick={tm(() => { selectTable(editor.state, (t) => editor.view.dispatch(t)); editor.view.focus(); })}>Table</button>
              </>
            )}
          </div>
          {shadeFly && (
            <div className="ctx tfly" style={{ left: shadeFly.left, top: shadeFly.top }} onMouseDown={(e) => e.preventDefault()}>
              <ShadePicker
                current={cellShade()}
                colors={SHADE_COLORS}
                hasCellSel={tmenu.hasCellSel}
                close={() => { setShadeFly(null); setTmenu(null); }}
                onApply={(col, scope) => { restoreMenuSel(); applyShade(col, scope); }}
              />
            </div>
          )}
        </>
      )}
      {symOpen && <SymbolDialog onInsert={insertSymbol} onClose={() => setSymOpen(false)} />}
    </div>
  );
}
