import { useEffect, useMemo, useRef, useState } from "react";
import { isPageLink, normalizeAddress, pageIdOf, pageLink, type PageRef } from "../lib/links";

/**
 * OneNote's Link dialog (Ctrl+K): Text to display, Address, and every page of every notebook to link to.
 */
export default function LinkDialog({
  initialText, initialHref, pages, editing, onOk, onRemove, onCancel,
}: {
  initialText: string;
  initialHref: string;
  pages: PageRef[];
  /** an existing link is being edited (shows Remove Link) */
  editing: boolean;
  onOk: (text: string, href: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [addr, setAddr] = useState(initialHref);
  const [q, setQ] = useState("");
  const addrRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // with words already selected, the address is what's missing; otherwise start at the text
    setTimeout(() => (initialText ? addrRef.current : textRef.current)?.focus(), 0);
  }, [initialText]);

  const linked = isPageLink(addr) ? pages.find((p) => p.id === pageIdOf(addr)) : undefined;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? pages.filter((p) => (p.title + " " + p.path).toLowerCase().includes(s)) : pages;
    return list.slice(0, 400);
  }, [pages, q]);

  // group the list by notebook › section, like OneNote's location picker
  const groups = useMemo(() => {
    const m = new Map<string, PageRef[]>();
    for (const p of shown) {
      if (!m.has(p.path)) m.set(p.path, []);
      m.get(p.path)!.push(p);
    }
    return [...m.entries()];
  }, [shown]);

  const ok = () => {
    const href = normalizeAddress(addr);
    if (!href) return;
    onOk(text.trim() ? text : linked?.title ?? href, href);
  };

  return (
    <div className="overlay ask-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div
        className="dialog link-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
          if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLElement).dataset.role !== "search") {
            e.preventDefault(); e.stopPropagation(); ok();
          }
        }}
      >
        <h3>Link</h3>
        <label className="link-row">
          <span>Text to display:</span>
          <input ref={textRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="the words that show in the page" />
        </label>
        <label className="link-row">
          <span>Address:</span>
          <input ref={addrRef} value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="https://… or pick a page below" />
        </label>
        {linked && <div className="link-to">Links to page: <b>{linked.title || "Untitled page"}</b> <small>{linked.path}</small></div>}
        {isPageLink(addr) && !linked && <div className="link-to warn">This page no longer exists.</div>}

        <div className="link-pick-head">Or pick a page in ZorNote:</div>
        <input className="link-search" data-role="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages…" />
        <div className="link-pages">
          {groups.map(([path, ps]) => (
            <div key={path}>
              <div className="link-path">{path}</div>
              {ps.map((p) => (
                <button
                  key={p.id}
                  className={"link-page" + (linked?.id === p.id ? " on" : "")}
                  onClick={() => { setAddr(pageLink(p.id)); if (!text.trim()) setText(p.title); }}
                  onDoubleClick={() => onOk(text.trim() ? text : p.title, pageLink(p.id))}
                >
                  {p.title || "Untitled page"}
                </button>
              ))}
            </div>
          ))}
          {!groups.length && <div className="hint">No page matches.</div>}
        </div>

        <div className="row link-buttons">
          {editing && <button className="danger-text" onClick={onRemove}>Remove Link</button>}
          <span style={{ flex: 1 }} />
          <button className="primary" disabled={!addr.trim()} onClick={ok}>OK</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
