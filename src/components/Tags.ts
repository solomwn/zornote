import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * OneNote-style tags on a line (paragraph or heading):
 *   Ctrl+1  To Do      – a checkbox in front of the line; click it to tick it off
 *   Ctrl+2  Important  – a yellow star
 *   Ctrl+3  Question   – a purple question mark
 *   Ctrl+0  remove the tag
 * Stored as data-tag="todo|done|important|question" on the paragraph.
 */

export type TagName = "todo" | "important" | "question";

export const TAG_INFO: { tag: TagName; label: string; key: string }[] = [
  { tag: "todo", label: "To Do", key: "Ctrl+1" },
  { tag: "important", label: "Important", key: "Ctrl+2" },
  { tag: "question", label: "Question", key: "Ctrl+3" },
];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tags: {
      toggleTag: (tag: TagName) => ReturnType;
      removeTags: () => ReturnType;
    };
  }
}

const TAGGABLE = ["paragraph", "heading"];

export const Tags = Extension.create({
  name: "tags",

  addGlobalAttributes() {
    return [
      {
        types: TAGGABLE,
        attributes: {
          tag: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-tag"),
            renderHTML: (attrs: Record<string, unknown>) => (attrs.tag ? { "data-tag": String(attrs.tag) } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    const lines = (state: import("@tiptap/pm/state").EditorState) => {
      const { from, to } = state.selection;
      const out: { pos: number; attrs: Record<string, unknown> }[] = [];
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (TAGGABLE.includes(node.type.name)) {
          out.push({ pos, attrs: node.attrs });
          return false;
        }
        return true;
      });
      return out;
    };
    return {
      toggleTag:
        (tag) =>
        ({ state, tr, dispatch }) => {
          const ls = lines(state);
          if (!ls.length) return false;
          const has = (a: Record<string, unknown>) => (tag === "todo" ? a.tag === "todo" || a.tag === "done" : a.tag === tag);
          const all = ls.every((l) => has(l.attrs));
          if (dispatch) for (const l of ls) tr.setNodeMarkup(l.pos, undefined, { ...l.attrs, tag: all ? null : tag });
          return true;
        },
      removeTags:
        () =>
        ({ state, tr, dispatch }) => {
          const ls = lines(state);
          if (!ls.length) return false;
          if (dispatch) for (const l of ls) tr.setNodeMarkup(l.pos, undefined, { ...l.attrs, tag: null });
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-1": () => this.editor.commands.toggleTag("todo"),
      "Mod-2": () => this.editor.commands.toggleTag("important"),
      "Mod-3": () => this.editor.commands.toggleTag("question"),
      "Mod-0": () => this.editor.commands.removeTags(),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("tagClick"),
        props: {
          handleDOMEvents: {
            // clicking the To Do box ticks it (and unticks it)
            mousedown(view, ev) {
              const el = ev.target as HTMLElement;
              if (!el?.matches?.('[data-tag="todo"],[data-tag="done"]')) return false;
              if (ev.clientX - el.getBoundingClientRect().left > 20) return false;
              const pos = view.posAtDOM(el, 0) - 1;
              const node = view.state.doc.nodeAt(pos);
              if (!node || !TAGGABLE.includes(node.type.name)) return false;
              view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, tag: node.attrs.tag === "todo" ? "done" : "todo" }));
              ev.preventDefault();
              return true;
            },
          },
        },
      }),
    ];
  },
});
