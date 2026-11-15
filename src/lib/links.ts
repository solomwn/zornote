/**
 * Links inside ZorNote look like  zornote://<kind>/<id>  (like OneNote's onenote: links):
 *   zornote://page/<page id>   zornote://section/<section id>
 *   zornote://group/<group id> zornote://notebook/<notebook id>
 */
export type LinkKind = "page" | "section" | "group" | "notebook";
export const LINK_PREFIX = "zornote://";
export const PAGE_LINK_PREFIX = "zornote://page/";

const KINDS: LinkKind[] = ["page", "section", "group", "notebook"];
export const KIND_LABEL: Record<LinkKind, string> = {
  page: "page", section: "section", group: "section group", notebook: "notebook",
};

export const zorLink = (kind: LinkKind, id: string) => `${LINK_PREFIX}${kind}/${id}`;
export const pageLink = (pageId: string) => zorLink("page", pageId);

/** {kind, id} of a zornote:// link, or null for anything else. */
export function parseZorLink(href: string | null | undefined): { kind: LinkKind; id: string } | null {
  if (!href || !href.startsWith(LINK_PREFIX)) return null;
  const m = /^([a-z]+)\/([^/?#]+)/.exec(href.slice(LINK_PREFIX.length));
  if (!m || !KINDS.includes(m[1] as LinkKind)) return null;
  return { kind: m[1] as LinkKind, id: m[2] };
}

/** Any link to something inside ZorNote (page, section, section group or notebook). */
export const isPageLink = (href: string | null | undefined) => !!parseZorLink(href);

/** A page, section, section group or notebook, for the link dialog and for following links. */
export interface PageRef {
  kind: LinkKind;
  id: string;
  title: string;
  /** where it is: "Notebook › Group › Section" (empty for a notebook) */
  path: string;
  /** indent in the link dialog's tree */
  depth?: number;
}

export const findRef = (refs: PageRef[], href: string) => {
  const z = parseZorLink(href);
  return z ? refs.find((r) => r.kind === z.kind && r.id === z.id) : undefined;
};

export const refTitle = (r: PageRef) => r.title || (r.kind === "page" ? "Untitled page" : "Untitled");

/** Add https:// to an address typed without a scheme ("github.com" → "https://github.com"). */
export function normalizeAddress(a: string): string {
  const v = a.trim();
  if (!v) return v;
  if (isPageLink(v) || /^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "mailto:" + v;
  return "https://" + v;
}

/** Open a web (or mail) link in the system's default browser / mail app. */
export async function openExternal(href: string) {
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_url", { url: href });
  } else {
    window.open(href, "_blank", "noopener");
  }
}
