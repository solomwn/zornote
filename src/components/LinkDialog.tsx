import { useEffect, useMemo, useRef, useState } from "react";
import { findRef, KIND_LABEL, normalizeAddress, parseZorLink, refTitle, zorLink, type LinkKind, type PageRef } from "../lib/links";

const ICON: Record<LinkKind, string> = { notebook: "📓", group: "🗂", section: "▤", page: "📄" };

/**
 * OneNote's Link dialog (Ctrl+K): Text to display, Address, and every notebook, section group, section and page to link to.
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

  const linked = findRef(pages, addr);
  const zl = parseZorLink(addr);

  // OneNote's location picker: notebooks › section groups › sections › pages; a search shows matches with where they are
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? pages.filter((p) => (p.title + " " + p.path).toLowerCase().includes(s)) : pages;
    return list.slice(0, 600);
  }, [pages, q]);
  const searching = !!q.trim();

  const ok = () => {
    const href = normalizeAddress(addr);
    if (!href) return;
    onOk(text.trim() ? text : linked ? refTitle(linked) : href, href);
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
        {linked && (
          <div className="link-to">
            Links to {KIND_LABEL[linked.kind]}: <b>{refTitle(linked)}</b> {linked.path && <small>{linked.path}</small>}
          </div>
        )}
        {zl && !linked && <div className="link-to warn">This {KIND_LABEL[zl.kind]} no longer exists.</div>}

        <div className="link-pick-head">Or pick a notebook, section group, section or page in ZorNote:</div>
        <input className="link-search" data-role="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
        <div className="link-pages">
          {shown.map((p) => (
            <button
              key={p.kind + p.id}
              className={`link-page k-${p.kind}` + (linked && linked.kind === p.kind && linked.id === p.id ? " on" : "")}
              style={searching ? undefined : { paddingLeft: 10 + (p.depth ?? 0) * 16 }}
              title={p.path ? `${KIND_LABEL[p.kind]} in ${p.path}` : KIND_LABEL[p.kind]}
              onClick={() => { setAddr(zorLink(p.kind, p.id)); if (!text.trim()) setText(refTitle(p)); }}
              onDoubleClick={() => onOk(text.trim() ? text : refTitle(p), zorLink(p.kind, p.id))}
            >
              <span className="lk-ico">{ICON[p.kind]}</span>
              {refTitle(p)}
              {searching && p.path && <small className="lk-path">{p.path}</small>}
            </button>
          ))}
          {!shown.length && <div className="hint">Nothing matches.</div>}
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
