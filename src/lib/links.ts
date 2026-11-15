/** Links to a page inside ZorNote look like  zornote://page/<page id>  (like OneNote's onenote: links). */
export const PAGE_LINK_PREFIX = "zornote://page/";

export const pageLink = (pageId: string) => PAGE_LINK_PREFIX + pageId;
export const isPageLink = (href: string | null | undefined) => !!href && href.startsWith(PAGE_LINK_PREFIX);
export const pageIdOf = (href: string) => href.slice(PAGE_LINK_PREFIX.length).replace(/[/?#].*$/, "");

/** A page anywhere in the notebooks, for the link dialog and for following links. */
export interface PageRef {
  id: string;
  title: string;
  /** "Notebook › Group › Section" */
  path: string;
}

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
