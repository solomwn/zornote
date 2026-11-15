import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { safeCell } from "./tableTools";
import { BlockRangeSelection } from "./BlockSelect";

/**
 * OneNote's Table ▸ Hide Borders: the table keeps its cells and shading, the lines are not drawn.
 * Stored on the table as data-hide-borders="true". While editing, the table is drawn by a node view that
 * ignores table attributes, so a decoration puts the class "hide-borders" on its wrapper.
 */

/** Positions of the tables the command works on: every whole table selected by dragging, or the table the cursor is in. */
function targetTables(state: EditorState): number[] {
  const sel = state.selection;
  if (sel instanceof BlockRangeSelection) {
    const out: number[] = [];
    state.doc.nodesBetween(sel.from, sel.to, (node, pos) => {
      if (node.type.spec.tableRole === "table") {
        out.push(pos);
        return false; // tables nested inside follow their parent's choice only if picked themselves
      }
      return true;
    });
    return out;
  }
  const $cell = safeCell(state);
  return $cell ? [$cell.start(-1) - 1] : [];
}

/** Are the borders of the table(s) in question hidden? */
export function bordersHidden(state: EditorState): boolean {
  const ts = targetTables(state);
  return ts.length > 0 && ts.every((p) => state.doc.nodeAt(p)?.attrs.hideBorders);
}

/** Hide (or show) the borders; with no `hide`, toggle. */
export function setTableBorders(state: EditorState, dispatch?: (tr: Transaction) => void, hide?: boolean): boolean {
  const ts = targetTables(state);
  if (!ts.length) return false;
  const value = hide ?? !bordersHidden(state);
  if (dispatch) {
    const tr = state.tr;
    for (const p of ts) {
      const node = tr.doc.nodeAt(p) as PMNode | null;
      if (node) tr.setNodeMarkup(p, undefined, { ...node.attrs, hideBorders: value });
    }
    dispatch(tr);
  }
  return true;
}

export const TableBorders = Extension.create({
  name: "tableBorders",

  addGlobalAttributes() {
    return [
      {
        types: ["table"],
        attributes: {
          hideBorders: {
            default: false,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-hide-borders") === "true",
            renderHTML: (attrs: Record<string, unknown>) => (attrs.hideBorders ? { "data-hide-borders": "true" } : {}),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("tableBorders"),
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.spec.tableRole === "table" && node.attrs.hideBorders) {
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "hide-borders" }));
              }
              return true;
            });
            return decos.length ? DecorationSet.create(state.doc, decos) : null;
          },
        },
      }),
    ];
  },
});
