import Image from "@tiptap/extension-image";
import { NodeSelection } from "@tiptap/pm/state";

/**
 * Pictures you can resize like in OneNote: click a picture → dotted frame with 8 handles.
 *   corners  – bigger / smaller, keeping the proportions
 *   sides    – stretch only the width (left/right) or only the height (top/bottom)
 * The size is stored on the picture (width / height in px); "Restore to Original Size" clears it.
 */

const DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type Dir = (typeof DIRS)[number];
const MIN = 24;

function applySize(img: HTMLImageElement, attrs: Record<string, unknown>) {
  const w = attrs.width as number | null;
  const h = attrs.height as number | null;
  img.style.width = w ? `${w}px` : "";
  // with only a width the picture keeps its proportions; a height is stored only when it was stretched
  img.style.height = h ? `${h}px` : "";
  img.style.maxWidth = h ? "none" : "";
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = parseFloat(el.style.width || el.getAttribute("width") || "");
          return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
        },
        renderHTML: () => ({}),
      },
      height: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = parseFloat(el.style.height || "");
          return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
        },
        renderHTML: () => ({}),
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const { width, height } = node.attrs as { width: number | null; height: number | null };
    const style = [width ? `width: ${width}px` : "", height ? `height: ${height}px; max-width: none` : ""].filter(Boolean).join("; ");
    return ["img", { ...HTMLAttributes, ...(style ? { style } : {}) }];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const wrap = document.createElement("span");
      wrap.className = "zimg";
      wrap.contentEditable = "false";
      const img = document.createElement("img");
      img.src = node.attrs.src;
      if (node.attrs.alt) img.alt = node.attrs.alt;
      img.draggable = false;
      applySize(img, node.attrs);
      wrap.appendChild(img);

      const select = () => {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos == null) return;
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
      };

      for (const dir of DIRS) {
        const h = document.createElement("span");
        h.className = `zimg-h zimg-${dir}`;
        h.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          select();
          const r = img.getBoundingClientRect();
          const startW = r.width;
          const startH = r.height;
          const ratio = startW / startH;
          const sx = e.clientX;
          const sy = e.clientY;
          const corner = dir.length === 2;
          let w = startW;
          let hgt = startH;
          wrap.classList.add("resizing");
          const move = (ev: MouseEvent) => {
            const dx = (dir.includes("e") ? 1 : dir.includes("w") ? -1 : 0) * (ev.clientX - sx);
            const dy = (dir.includes("s") ? 1 : dir.includes("n") ? -1 : 0) * (ev.clientY - sy);
            if (corner) {
              // proportional: follow whichever way the mouse moved more
              const byW = startW + dx;
              const byH = (startH + dy) * ratio;
              w = Math.max(MIN, Math.abs(dx) >= Math.abs(dy * ratio) ? byW : byH);
              hgt = w / ratio;
            } else if (dx !== 0 || dir === "e" || dir === "w") {
              w = Math.max(MIN, startW + dx);
              hgt = startH;
            } else {
              hgt = Math.max(MIN, startH + dy);
              w = startW;
            }
            img.style.width = `${w}px`;
            img.style.height = `${hgt}px`;
            img.style.maxWidth = "none";
          };
          const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            wrap.classList.remove("resizing");
            const pos = typeof getPos === "function" ? getPos() : null;
            if (pos == null) return;
            const keepRatio = corner || Math.abs(w / hgt - (img.naturalWidth || startW) / (img.naturalHeight || startH)) < 0.01;
            const attrs = { ...current.attrs, width: Math.round(w), height: keepRatio ? null : Math.round(hgt) };
            const tr = editor.state.tr.setNodeMarkup(pos, undefined, attrs);
            tr.setSelection(NodeSelection.create(tr.doc, pos));
            editor.view.dispatch(tr);
          };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        });
        wrap.appendChild(h);
      }

      // a click on the picture selects it (shows the frame and handles)
      img.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        select();
        editor.view.focus();
      });

      return {
        dom: wrap,
        update(n) {
          if (n.type !== current.type) return false;
          current = n;
          if (img.src !== n.attrs.src) img.src = n.attrs.src;
          applySize(img, n.attrs);
          return true;
        },
        selectNode() { wrap.classList.add("sel"); },
        deselectNode() { wrap.classList.remove("sel"); },
        stopEvent(e) { return (e.target as HTMLElement)?.classList?.contains("zimg-h") ?? false; },
        ignoreMutation() { return true; },
      };
    };
  },
});
