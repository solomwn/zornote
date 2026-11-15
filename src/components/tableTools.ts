import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { ResolvedPos } from "@tiptap/pm/model";
import { CellSelection, TableMap, selectionCell } from "@tiptap/pm/tables";

/** The cell the cursor (or the end of a cell selection) is in, or null when not in a table. */
export function safeCell(state: EditorState): ResolvedPos | null {
  try {
    return selectionCell(state);
  } catch {
    return null;
  }
}

export function isInCell(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const role = $from.node(d).type.spec.tableRole;
    if (role === "cell" || role === "header_cell") return true;
  }
  return false;
}

/** True when a cell selection covers every cell of its table. */
export function isWholeTable(sel: CellSelection): boolean {
  const table = sel.$anchorCell.node(-1);
  const map = TableMap.get(table);
  let n = 0;
  sel.forEachCell(() => n++);
  return n === new Set(map.map).size;
}

type Dispatch = ((tr: Transaction) => void) | undefined;

export function selectTable(state: EditorState, dispatch?: Dispatch): boolean {
  const $cell = safeCell(state);
  if (!$cell) return false;
  const table = $cell.node(-1);
  const start = $cell.start(-1);
  const map = TableMap.get(table);
  const sel = CellSelection.create(state.doc, start + map.map[0], start + map.map[map.map.length - 1]);
  dispatch?.(state.tr.setSelection(sel));
  return true;
}

export function selectRow(state: EditorState, dispatch?: Dispatch): boolean {
  const $cell = safeCell(state);
  if (!$cell) return false;
  dispatch?.(state.tr.setSelection(CellSelection.rowSelection($cell)));
  return true;
}

export function selectColumn(state: EditorState, dispatch?: Dispatch): boolean {
  const $cell = safeCell(state);
  if (!$cell) return false;
  dispatch?.(state.tr.setSelection(CellSelection.colSelection($cell)));
  return true;
}

/** Insert a copy of the current row right below it (content, shading and fonts included). */
export function duplicateRow(state: EditorState, dispatch?: Dispatch): boolean {
  const $cell = safeCell(state);
  if (!$cell) return false;
  const table = $cell.node(-1);
  const start = $cell.start(-1);
  const map = TableMap.get(table);
  const row = map.findCell($cell.pos - start).top;
  let pos = start;
  for (let i = 0; i <= row; i++) pos += table.child(i).nodeSize;
  dispatch?.(state.tr.insert(pos, table.child(row)));
  return true;
}

/** Stretch the table's columns, keeping their proportions, so the table spans the width it sits in. */
export function fitTableWidth(view: EditorView): boolean {
  const { state } = view;
  const $cell = safeCell(state);
  if (!$cell) return false;
  const table = $cell.node(-1);
  const start = $cell.start(-1);
  const map = TableMap.get(table);
  const cols = map.width;

  const wrapper = view.nodeDOM(start - 1) as HTMLElement | null;
  const host = wrapper?.parentElement;
  if (!host) return false;
  const cs = getComputedStyle(host);
  const avail = host.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) - 3;
  if (avail < 120) return false;

  // current width of every column, measured from a cell that spans only that column
  const cur: number[] = new Array(cols).fill(0);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < map.height; r++) {
      const off = map.map[r * cols + c];
      const cell = table.nodeAt(off);
      if (!cell || (cell.attrs.colspan ?? 1) !== 1) continue;
      const dom = view.nodeDOM(start + off) as HTMLElement | null;
      if (dom) { cur[c] = dom.getBoundingClientRect().width; break; }
    }
  }
  const known = cur.filter((w) => w > 0);
  const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : avail / cols;
  const widths = cur.map((w) => w || fallback);
  const total = widths.reduce((a, b) => a + b, 0);
  const next = widths.map((w) => Math.max(24, Math.floor((w * avail) / total)));
  next[cols - 1] = Math.max(24, next[cols - 1] + Math.floor(avail) - next.reduce((a, b) => a + b, 0));

  const tr = state.tr;
  const seen = new Set<number>();
  for (let i = 0; i < map.map.length; i++) {
    const off = map.map[i];
    if (seen.has(off)) continue;
    seen.add(off);
    const cell = table.nodeAt(off);
    if (!cell) continue;
    const col = i % cols;
    const span = (cell.attrs.colspan as number) ?? 1;
    const colwidth = Array.from({ length: span }, (_, k) => next[Math.min(col + k, cols - 1)]);
    tr.setNodeMarkup(start + off, null, { ...cell.attrs, colwidth });
  }
  view.dispatch(tr);
  return true;
}

/**
 * Set (or clear) the shading of every cell of the table the cursor is in.
 * Tables nested inside its cells are left alone, so shading a dark container does not repaint what is inside it.
 */
export function setTableShading(state: EditorState, dispatch: Dispatch, color: string | null): boolean {
  const $cell = safeCell(state);
  if (!$cell) return false;
  const table = $cell.node(-1);
  const start = $cell.start(-1);
  const map = TableMap.get(table);
  const tr = state.tr;
  const seen = new Set<number>();
  for (const off of map.map) {
    if (seen.has(off)) continue;
    seen.add(off);
    const cell = table.nodeAt(off);
    if (cell) tr.setNodeMarkup(start + off, null, { ...cell.attrs, backgroundColor: color });
  }
  dispatch?.(tr);
  return true;
}

/** Select just the cell the cursor is in (the mouse can only select two or more cells). */
export function selectCell(state: EditorState, dispatch?: Dispatch): boolean {
  const $cell = safeCell(state);
  if (!$cell) return false;
  dispatch?.(state.tr.setSelection(new CellSelection($cell)));
  return true;
}
