/**
 * Microsoft OneNote import via the official Microsoft Graph API.
 *
 * This is the supported, documented way to read OneNote notebooks from any
 * platform (OneNote has no Linux client). It uses a token you provide, so no
 * credentials are stored by ZorNote.
 *
 * To get a token: register an app at https://entra.microsoft.com (Public client,
 * Notes.Read delegated permission) and use the device-code flow, or paste a
 * short-lived token from Graph Explorer (https://developer.microsoft.com/graph/graph-explorer)
 * with the Notes.Read scope.
 */
import type { Notebook, Page, Section } from "./types";
import { SECTION_COLORS } from "./types";
import { uid } from "./storage";

const GRAPH = "https://graph.microsoft.com/v1.0/me/onenote";

async function gget<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function gtext(token: string, url: string): Promise<string> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
  return res.text();
}

interface GList<T> { value: T[] }
interface GNotebook { id: string; displayName: string }
interface GSection { id: string; displayName: string }
interface GPage { id: string; title: string; level?: number; createdDateTime: string; lastModifiedDateTime: string }

export async function listRemoteNotebooks(token: string) {
  return (await gget<GList<GNotebook>>(token, `${GRAPH}/notebooks`)).value;
}

/** Convert OneNote page HTML to editor-friendly HTML (keeps body content only). */
function cleanOneNoteHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("[style]").forEach((n) => n.removeAttribute("style"));
  doc.querySelectorAll("[data-id], [id]").forEach((n) => {
    n.removeAttribute("data-id");
    n.removeAttribute("id");
  });
  // Images and attachments need authenticated fetches; leave a placeholder.
  doc.querySelectorAll("img").forEach((img) => {
    const p = doc.createElement("p");
    p.textContent = `[image: ${img.getAttribute("alt") || "not imported"}]`;
    img.replaceWith(p);
  });
  doc.querySelectorAll("object").forEach((o) => o.remove());
  return doc.body.innerHTML;
}

export async function importRemoteNotebook(
  token: string,
  remote: GNotebook,
  onProgress?: (msg: string) => void
): Promise<Notebook> {
  const sections = (await gget<GList<GSection>>(token, `${GRAPH}/notebooks/${remote.id}/sections`)).value;
  const out: Section[] = [];
  let ci = 0;
  for (const s of sections) {
    onProgress?.(`Section: ${s.displayName}`);
    const pagesMeta = (await gget<GList<GPage>>(token, `${GRAPH}/sections/${s.id}/pages?$top=100&$orderby=order`)).value;
    const pages: Page[] = [];
    for (const p of pagesMeta) {
      onProgress?.(`Page: ${p.title}`);
      const html = await gtext(token, `${GRAPH}/pages/${p.id}/content`);
      pages.push({
        id: uid(),
        title: p.title || "Untitled page",
        content: cleanOneNoteHtml(html),
        level: Math.max(0, Math.min(2, p.level ?? 0)),
        createdAt: Date.parse(p.createdDateTime) || Date.now(),
        updatedAt: Date.parse(p.lastModifiedDateTime) || Date.now(),
      });
    }
    out.push({
      id: uid(),
      name: s.displayName,
      color: SECTION_COLORS[ci++ % SECTION_COLORS.length],
      pages: pages.length ? pages : [{ id: uid(), title: "Untitled page", content: "", createdAt: Date.now(), updatedAt: Date.now() }],
    });
  }
  return { id: uid(), name: remote.displayName, sections: out };
}
