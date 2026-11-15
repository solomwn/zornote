import { Extension } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * OneNote-style line height: a line is only as tall as its text.
 *
 * Browsers size a line by the paragraph's own font, not by smaller text inside it,
 * so a 6pt word still sits on a full-height line. This plugin gives a paragraph the
 * font size of its text whenever all of that text shares one size, and remembers the
 * size of empty lines (the classic thin "spacer" line) in a `data-empty-size` attribute.
 */
const key = new PluginKey("lineSize");

const sizeOf = (marks: readonly Mark[] | null | undefined): string | null => {
  const m = marks?.find((x) => x.type.name === "textStyle");
  return (m?.attrs.fontSize as string | null | undefined) ?? null;
};

export const LineSize = Extension.create({
  name: "lineSize",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          emptySize: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-empty-size"),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.emptySize ? { "data-empty-size": String(attrs.emptySize) } : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key,

        // counts our own size changes so the page can be saved even when nothing else was typed
        state: {
          init: () => 0,
          apply: (tr, n: number) => (tr.getMeta(key) ? n + 1 : n),
        },
        view: () => ({
          update: (view, prev) => {
            if (key.getState(view.state) !== key.getState(prev)) {
              queueMicrotask(() => editor.emit("update", { editor, transaction: view.state.tr }));
            }
          },
        }),

        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            const { selection } = state;
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "paragraph") return true;

              let size: string | null | undefined;
              let mixed = false;
              let hasText = false;
              node.forEach((child) => {
                if (!child.isText) { mixed = true; return; }
                hasText = true;
                const s = sizeOf(child.marks);
                if (size === undefined) size = s;
                else if (size !== s) mixed = true;
              });

              let apply: string | null = null;
              if (hasText) {
                if (!mixed && size) apply = size;
              } else if (node.childCount === 0) {
                apply = (node.attrs.emptySize as string | null) ?? null;
                // the line the cursor is on follows what you are about to type
                if (selection.empty && selection.$from.parent === node) {
                  const s = sizeOf(state.storedMarks ?? selection.$from.marks());
                  if (s) apply = s;
                }
              }
              if (apply) decos.push(Decoration.node(pos, pos + node.nodeSize, { style: `font-size:${apply}` }));
              return false;
            });
            return DecorationSet.create(state.doc, decos);
          },
        },

        // keep the size of empty lines, and keep typing in that size
        appendTransaction(trs, _old, state) {
          if (!trs.some((t) => t.docChanged || t.selectionSet || t.storedMarksSet)) return null;
          const { selection } = state;
          if (!selection.empty) return null;
          const $from = selection.$from;
          const node = $from.parent;
          if (node.type.name !== "paragraph" || node.content.size !== 0) return null;

          const cur = (node.attrs.emptySize as string | null) ?? null;
          const stored = state.storedMarks;
          const s = sizeOf(stored ?? $from.marks());
          const storedSet = trs.some((t) => t.storedMarksSet);

          if (s && s !== cur) {
            const tr = state.tr.setNodeMarkup($from.before(), undefined, { ...node.attrs, emptySize: s }).setMeta(key, true);
            if (stored) tr.setStoredMarks(stored);
            return tr;
          }
          if (!s && cur && storedSet) {
            // size was cleared on this empty line
            return state.tr.setNodeMarkup($from.before(), undefined, { ...node.attrs, emptySize: null }).setMeta(key, true);
          }
          if (!s && cur && !storedSet && !stored) {
            // moved into a small empty line: continue typing at its size
            const textStyle = state.schema.marks.textStyle;
            if (textStyle) return state.tr.setStoredMarks([textStyle.create({ fontSize: cur })]);
          }
          return null;
        },
      }),
    ];
  },
});
