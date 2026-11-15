import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the selection in a colored panel, or recolor the panel you're in. */
      setCallout: (color: string) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

/** Perceived brightness check so text stays readable on any panel color. */
export function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

/** A colored container panel (like the dark blocks in OneNote runbooks). */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      color: {
        default: "#3a3a3a",
        parseHTML: (el) => el.getAttribute("data-color") || "#3a3a3a",
        renderHTML: (attrs) => {
          const c = String(attrs.color);
          return {
            "data-color": c,
            style: `background-color:${c};color:${isDark(c) ? "#ffffff" : "#201f1e"}`,
            class: isDark(c) ? "callout-dark" : "callout-light",
          };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0];
  },

  addCommands() {
    return {
      setCallout:
        (color) =>
        ({ commands, editor }) =>
          editor.isActive("callout")
            ? commands.updateAttributes("callout", { color })
            : commands.wrapIn("callout", { color }),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift("callout"),
    };
  },
});
