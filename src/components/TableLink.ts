import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { columnResizingPluginKey } from "@tiptap/pm/tables";

/**
 * Tables that touch (no line between them) behave as one block when a column border is dragged:
 * every border in the touching tables that sits on the same line as the dragged one moves with it,
 * so a header strip stays lined up with the table under it — like OneNote.
 */

const TOL = 3; // px: borders this close count as the same line

/** Positions of the run of tables that touch the table at `tablePos` (same parent, nothing between). */
function touchingTables(view: EditorView, tablePos: number): number[] {
  const $t = view.state.doc.resolve(tablePos);
  const parent = $t.parent;
  const idx = $t.index();
  const isTable = (i: number) => i >= 0 && i < parent.childCount && parent.child(i).type.spec.tableRole === "table";
  let lo = idx;
  let hi = idx;
  while (isTable(lo - 1)) lo--;
  while (isTable(hi + 1)) hi++;
  const out: number[] = [];
  let pos = $t.start();
  for (let i = 0; i < parent.childCount; i++) {
    if (i >= lo && i <= hi && i !== idx) out.push(pos);
    pos += parent.child(i).nodeSize;
  }
  return out;
}

function cellElement(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.nodeDOM(pos);
  return dom instanceof HTMLElement ? dom : null;
}

export const TableLink = Extension.create({
  name: "tableLink",
  priority: 1000, // must see the mousedown before the column-resize plugin takes it

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("tableLink"),
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              if (event.button !== 0) return false;
              const rs = columnResizingPluginKey.getState(view.state);
              if (!rs || rs.activeHandle < 0) return false;

              const handle = rs.activeHandle;
              const $cell = view.state.doc.resolve(handle);
              const table = $cell.node(-1);
              if (!table || table.type.spec.tableRole !== "table") return false;
              const tablePos = $cell.before(-1);
              const partners = touchingTables(view, tablePos);
              if (!partners.length) return false;

              const cell = cellElement(view, handle);
              if (!cell) return false;
              const oldRight = cell.getBoundingClientRect().right;

              // the cells in the touching tables whose right border is on the same line
              const linked: { pos: number; width: number; colwidth: number[] | null; span: number }[] = [];
              for (const tp of partners) {
                const tnode = view.state.doc.nodeAt(tp);
                if (!tnode) continue;
                tnode.descendants((node, rel) => {
                  const role = node.type.spec.tableRole;
                  if (role === "table") return false; // don't touch tables nested inside
                  if (role === "cell" || role === "header_cell") {
                    const pos = tp + 1 + rel;
                    const el = cellElement(view, pos);
                    if (el) {
                      const r = el.getBoundingClientRect();
                      if (Math.abs(r.right - oldRight) <= TOL) {
                        linked.push({ pos, width: r.width, colwidth: node.attrs.colwidth ?? null, span: node.attrs.colspan ?? 1 });
                      }
                    }
                    return false;
                  }
                  return true;
                });
              }
              if (!linked.length) return false;

              const onUp = () => {
                window.removeEventListener("mouseup", onUp, true);
                // let the column-resize plugin commit its own change first
                setTimeout(() => {
                  const el = cellElement(view, handle);
                  if (!el) return;
                  const delta = el.getBoundingClientRect().right - oldRight;
                  if (Math.abs(delta) < 1) return;
                  const tr = view.state.tr;
                  for (const c of linked) {
                    const node = tr.doc.nodeAt(c.pos);
                    if (!node) continue;
                    const span = c.span;
                    const cw: number[] =
                      c.colwidth && c.colwidth.length === span && c.colwidth.every((w) => w > 0)
                        ? [...c.colwidth]
                        : Array.from({ length: span }, () => Math.round(c.width / span));
                    cw[span - 1] = Math.max(24, Math.round(cw[span - 1] + delta));
                    tr.setNodeMarkup(c.pos, null, { ...node.attrs, colwidth: cw });
                  }
                  if (tr.docChanged) view.dispatch(tr);
                }, 0);
              };
              window.addEventListener("mouseup", onUp, true);
              return false;
            },
          },
        },
      }),
    ];
  },
});
