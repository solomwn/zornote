import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Selection, SelectionRange, TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { Slice } from "@tiptap/pm/model";
import type { Mappable } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * Selecting several tables at once, like OneNote:
 *  - drag from one table into another (or past the lines between them) → all of them are selected
 *  - Shift+click in another table extends the selection to it
 * The selection covers WHOLE blocks (tables and the lines between them), so Copy / Cut take complete tables.
 * Works inside a container too (tables nested in the same cell).
 */
export class BlockRangeSelection extends Selection {
  constructor($from: ResolvedPos, $to: ResolvedPos) {
    super($from, $to, [new SelectionRange($from, $to)]);
  }
  map(doc: PMNode, mapping: Mappable): Selection {
    const from = mapping.map(this.from, 1);
    const to = mapping.map(this.to, -1);
    if (to <= from) return TextSelection.near(doc.resolve(from));
    const $from = doc.resolve(from);
    const $to = doc.resolve(to);
    if ($from.parent !== $to.parent) return TextSelection.between($from, $to);
    return new BlockRangeSelection($from, $to);
  }
  content(): Slice {
    // closed slice: whole tables, no half-open cells
    return new Slice(this.$from.doc.slice(this.from, this.to).content, 0, 0);
  }
  eq(other: Selection): boolean {
    return other instanceof BlockRangeSelection && other.from === this.from && other.to === this.to;
  }
  toJSON() {
    return { type: "blockRange", anchor: this.from, head: this.to };
  }
  static fromJSON(doc: PMNode, json: { anchor: number; head: number }) {
    return new BlockRangeSelection(doc.resolve(json.anchor), doc.resolve(json.head));
  }
}
// drawn with decorations instead of the browser's text highlight (like the table plugin's cell selection)
BlockRangeSelection.prototype.visible = false;
Selection.jsonID("blockRange", BlockRangeSelection);

/** Table / row: structure, not a place where blocks live (a cell is: it holds paragraphs and tables). */
const isTableRole = (n: PMNode) => {
  const r = n.type.spec.tableRole as string | undefined;
  return r === "row" || r === "table";
};

/**
 * The run of sibling blocks between two document positions, or null when both are in the same block.
 * Siblings = children of the deepest common ancestor that is not part of a table's structure
 * (the page itself, or the cell of a container table).
 */
export function blockRange(doc: PMNode, a: number, b: number): { from: number; to: number } | null {
  const $a = doc.resolve(Math.min(a, b));
  const $b = doc.resolve(Math.max(a, b));
  let d = $a.sharedDepth($b.pos);
  while (d > 0 && isTableRole($a.node(d))) d--;
  if (d >= $a.depth || d >= $b.depth) return null; // one end sits directly in the shared parent: nothing to span
  const i1 = $a.index(d);
  const i2 = $b.index(d);
  if (i1 === i2) return null;
  return { from: $a.posAtIndex(i1, d), to: $a.posAtIndex(i2 + 1, d) };
}

const key = new PluginKey("blockSelect");

function select(view: EditorView, r: { from: number; to: number }) {
  const sel = new BlockRangeSelection(view.state.doc.resolve(r.from), view.state.doc.resolve(r.to));
  if (!sel.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(sel));
}

export const BlockSelect = Extension.create({
  name: "blockSelect",
  priority: 1000, // Shift+click must be seen before the table plugin turns it into a cell selection

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            const sel = state.selection;
            if (!(sel instanceof BlockRangeSelection)) return null;
            const decos: Decoration[] = [];
            const parent = sel.$from.parent;
            let pos = sel.from;
            for (let i = sel.$from.index(); i < parent.childCount && pos < sel.to; i++) {
              const node = parent.child(i);
              decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "block-selected" }));
              pos += node.nodeSize;
            }
            return DecorationSet.create(state.doc, decos);
          },

          handleDOMEvents: {
            mousedown(view, event) {
              if (event.button !== 0) return false;
              const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (!hit) return false;

              // Shift+click: extend from where the cursor/selection started to the clicked block
              if (event.shiftKey) {
                const cur = view.state.selection;
                const anchor = cur instanceof BlockRangeSelection ? cur.from : cur.anchor;
                const r = blockRange(view.state.doc, anchor, hit.pos);
                if (r) {
                  event.preventDefault();
                  view.focus();
                  select(view, r);
                  return true;
                }
                return false;
              }

              // Drag: once the pointer leaves the block the press started in, select whole blocks
              const start = hit.pos;
              let active = false;
              const move = (e: MouseEvent) => {
                const h = view.posAtCoords({ left: e.clientX, top: e.clientY });
                if (!h) return;
                const r = blockRange(view.state.doc, start, h.pos);
                if (r) {
                  active = true;
                  // after the table plugin has handled this move (it keeps a cell selection otherwise)
                  requestAnimationFrame(() => select(view, r));
                } else if (active) {
                  active = false;
                  requestAnimationFrame(() => {
                    if (view.state.selection instanceof BlockRangeSelection) {
                      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(start))));
                    }
                  });
                }
              };
              const up = () => {
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", up);
              };
              window.addEventListener("mousemove", move);
              window.addEventListener("mouseup", up);
              return false;
            },
          },
        },
      }),
    ];
  },
});
