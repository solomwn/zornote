import type { Notebook, Page } from "./types";
import { isTauri, writeTextFile } from "./storage";

/** Minimal HTML -> Markdown converter covering what the editor produces. */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const walk = (node: Node, ctx: { listDepth: number; ordered?: boolean; idx?: number } = { listDepth: 0 }): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const kids = (c = ctx) => Array.from(el.childNodes).map((n) => walk(n, c)).join("");
    const tag = el.tagName.toLowerCase();

    switch (tag) {
      case "h1": return `# ${kids()}\n\n`;
      case "h2": return `## ${kids()}\n\n`;
      case "h3": return `### ${kids()}\n\n`;
      case "p": return `${kids()}\n\n`;
      case "br": return "\n";
      case "strong": case "b": return `**${kids()}**`;
      case "em": case "i": return `*${kids()}*`;
      case "s": case "del": return `~~${kids()}~~`;
      case "u": return kids();
      case "mark": return `==${kids()}==`;
      case "code": return el.parentElement?.tagName.toLowerCase() === "pre" ? kids() : `\`${kids()}\``;
      case "pre": return `\n\`\`\`\n${el.textContent}\n\`\`\`\n\n`;
      case "blockquote": return kids().trim().split("\n").map((l) => `> ${l}`).join("\n") + "\n\n";
      case "hr": return "---\n\n";
      case "a": return `[${kids()}](${el.getAttribute("href") ?? ""})`;
      case "img": return `![${el.getAttribute("alt") ?? ""}](${el.getAttribute("src") ?? ""})`;
      case "ul": case "ol": {
        const ordered = tag === "ol";
        let i = 0;
        const items = Array.from(el.children).map((li) => {
          i++;
          return walk(li, { listDepth: ctx.listDepth + 1, ordered, idx: i });
        });
        return items.join("") + (ctx.listDepth === 0 ? "\n" : "");
      }
      case "li": {
        const indent = "  ".repeat(Math.max(0, ctx.listDepth - 1));
        const isTask = el.getAttribute("data-type") === "taskItem";
        const checked = el.getAttribute("data-checked") === "true";
        const marker = isTask ? `- [${checked ? "x" : " "}] ` : ctx.ordered ? `${ctx.idx}. ` : "- ";
        const parts: string[] = [];
        const nested: string[] = [];
        const container = isTask ? (el.querySelector(":scope > div") ?? el) : el;
        Array.from(container.childNodes).forEach((n) => {
          const e = n as HTMLElement;
          if (e.tagName && (e.tagName.toLowerCase() === "ul" || e.tagName.toLowerCase() === "ol")) {
            nested.push(walk(e, { listDepth: ctx.listDepth }));
          } else if (!(isTask && e.tagName?.toLowerCase() === "label")) {
            parts.push(walk(n, { listDepth: ctx.listDepth }).trim());
          }
        });
        return `${indent}${marker}${parts.join(" ")}\n${nested.join("")}`;
      }
      case "table": {
        const rows = Array.from(el.querySelectorAll("tr")).map((tr) =>
          Array.from(tr.children).map((c) => (c.textContent ?? "").trim().replace(/\|/g, "\\|").replace(/\n/g, " "))
        );
        if (!rows.length) return "";
        const head = `| ${rows[0].join(" | ")} |`;
        const sep = `| ${rows[0].map(() => "---").join(" | ")} |`;
        const body = rows.slice(1).map((r) => `| ${r.join(" | ")} |`).join("\n");
        return `${head}\n${sep}\n${body}\n\n`;
      }
      default: return kids();
    }
  };

  return walk(doc.body).replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function pageToMarkdown(page: Page): string {
  return `# ${page.title}\n\n${htmlToMarkdown(page.content)}`;
}

export function notebookToMarkdown(nb: Notebook): string {
  const out = [`# ${nb.name}\n`];
  for (const s of nb.sections) {
    out.push(`\n## ${s.name}\n`);
    for (const p of s.pages) {
      const body = htmlToMarkdown(p.content).replace(/^(#{1,6}) /gm, "#$1 ");
      out.push(`\n### ${p.title}\n\n${body}`);
    }
  }
  return out.join("\n");
}

export function pageToHtml(page: Page): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(page.title)}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;line-height:1.55}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style></head><body><h1>${escapeHtml(page.title)}</h1>${page.content}</body></html>`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const safeName = (s: string) => s.replace(/[^\w\- ]+/g, "_").trim() || "note";

/** Save via native dialog in Tauri, or browser download in dev. */
export async function saveFile(defaultName: string, contents: string, mime = "text/plain") {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: defaultName });
    if (path) await writeTextFile(path, contents);
    return;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
}


/* ---------------------------------------------------------------- PDF */

/** A4 printable width (10 mm margins) in CSS px: portrait 190 mm, landscape 277 mm. */
const PRINTABLE = { portrait: (190 / 25.4) * 96, landscape: (277 / 25.4) * 96 };

/**
 * Prepare the page for printing: wide pages go landscape and are scaled down to fit the paper width.
 * Returns the orientation chosen.
 */
export function preparePrint(): { landscape: boolean } {
  const pm = document.querySelector(".canvas .ProseMirror") as HTMLElement | null;
  // widest real content: tables, pictures, code — and text lines (measured as text, not as full-width blocks)
  let w = 0;
  if (pm) {
    const left = pm.getBoundingClientRect().left;
    pm.querySelectorAll("table, img, pre").forEach((el) => { w = Math.max(w, el.getBoundingClientRect().right - left); });
    const r = document.createRange();
    pm.querySelectorAll(":scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > ul, :scope > ol").forEach((el) => {
      r.selectNodeContents(el);
      w = Math.max(w, r.getBoundingClientRect().right - left);
    });
  }
  const landscape = w > PRINTABLE.portrait * 1.05;
  const avail = landscape ? PRINTABLE.landscape : PRINTABLE.portrait;
  const zoom = w > avail ? avail / w : 1;
  document.documentElement.style.setProperty("--print-zoom", String(Math.max(0.3, zoom)));
  return { landscape };
}

/** Export the open page to a PDF file (desktop app: straight to file; browser: the print dialog). */
export async function exportPdf(defaultName: string): Promise<string | null> {
  const { landscape } = preparePrint();
  if (!isTauri()) {
    window.print();
    return null;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: defaultName, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!path) return null;
  const file = path.toLowerCase().endsWith(".pdf") ? path : path + ".pdf";
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  return new Promise<string>((resolve, reject) => {
    let un: (() => void) | undefined;
    listen<string>("pdf-export", (e) => {
      un?.();
      if (e.payload === "ok") resolve(file);
      else reject(new Error(e.payload));
    }).then((u) => {
      un = u;
      invoke("export_pdf", { path: file, landscape }).catch((err) => { un?.(); reject(err); });
    });
  });
}

/** The system Print dialog (it also has "Print to File"). */
export async function printPage() {
  preparePrint();
  if (!isTauri()) return window.print();
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("print_page");
}
