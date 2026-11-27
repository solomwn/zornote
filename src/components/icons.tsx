/** Small line icons for the ribbon (24×24, drawn with the current text colour). */
const P: Record<string, string> = {
  paste: "M9 3h6v4H9z M7 5H5v16h14V5h-2",
  cut: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M20 4 8.1 15.9 M14.5 14.5 20 20 M8.1 8.1 12 12",
  copy: "M9 9h11v11H9z M15 9V4H4v11h5",
  painter: "M4 3h13v6H4z M17 6h3v6h-8v3 M11 15h2v6h-2z",
  bullets: "M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01",
  numbers: "M10 6h10 M10 12h10 M10 18h10 M4 4.5l1.2-.7V8.5 M3.8 14.2a1.2 1.2 0 1 1 2 1L3.8 18h2.6",
  outdent: "M11 6h10 M11 12h10 M3 18h18 M7 7 4 9.5 7 12",
  indent: "M11 6h10 M11 12h10 M3 18h18 M4 7l3 2.5L4 12",
  clear: "M4 7V4h12v3 M10 4v12 M7 16h6 M15 14l6 6 M21 14l-6 6",
  alignLeft: "M3 6h18 M3 10h12 M3 14h18 M3 18h12",
  alignCenter: "M3 6h18 M6 10h12 M3 14h18 M6 18h12",
  alignRight: "M3 6h18 M9 10h12 M3 14h18 M9 18h12",
  del: "M6 6l12 12 M18 6 6 18",
  todo: "M4 4h16v16H4z M8 12l3 3 5-6",
  question: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.5 9.2a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.7v.4 M12 17h.01",
  find: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-5-5",
  table: "M3 5h18v14H3z M3 10h18 M3 15h18 M9 5v14 M15 5v14",
  picture: "M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M15.5 9.5h.01",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  date: "M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5",
  template: "M4 4h16v16H4z M4 9h16 M10 9v11",
  panel: "M4 6h16v12H4z M7 10h10 M7 14h6",
  code: "M8 7l-5 5 5 5 M16 7l5 5-5 5",
  line: "M3 12h18",
  quote: "M7 7h4v4c0 3-1.5 5-4 6 M14 7h4v4c0 3-1.5 5-4 6",
  undo: "M9 14 4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6",
  save: "M5 3h11l3 3v15H5z M8 3v6h8V3 M8 21v-7h8v7",
  folder: "M3 6h6l2 2h10v11H3z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 7.5h.01",
  full: "M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5",
  unfull: "M9 4v5H4 M15 4v5h5 M9 20v-5H4 M15 20v-5h5",
  bucket: "M5 12l7-7 7 7-7 7z M5 12h14 M20 16s1.6 2.1 1.6 3.3a1.6 1.6 0 0 1-3.2 0c0-1.2 1.6-3.3 1.6-3.3",
  rowAbove: "M3 11h18v9H3z M3 15.5h18 M12 2v6 M9 5h6",
  rowBelow: "M3 4h18v9H3z M3 8.5h18 M12 16v6 M9 19h6",
  colLeft: "M11 3h9v18h-9z M15.5 3v18 M2 12h6 M5 9v6",
  colRight: "M4 3h9v18H4z M8.5 3v18 M16 12h6 M19 9v6",
  delRow: "M3 8h18v8H3z M8 10l8 4 M16 10l-8 4",
  delCol: "M8 3h8v18H8z M10 8l4 8 M14 8l-4 8",
  delTable: "M3 5h18v14H3z M3 10h18 M9 5v14 M13 13l6 6 M19 13l-6 6",
  merge: "M3 5h18v14H3z M7 12h10 M10 9l-3 3 3 3 M14 9l3 3-3 3",
  split: "M3 5h18v14H3z M12 5v14 M5 12h4 M7 10l2 2-2 2 M19 12h-4 M17 10l-2 2 2 2",
  fit: "M3 5h18v14H3z M6 12h12 M8 10l-2 2 2 2 M16 10l2 2-2 2",
  dupRow: "M3 4h18v7H3z M3 13h18v7H3z M12 14.5v4 M10 16.5h4",
  selCell: "M3 5h18v14H3z M9 10h6v4H9z",
  selRow: "M3 5h18v14H3z M3 10h18v4H3z",
  selCol: "M3 5h18v14H3z M9 5h6v14H9z",
  export: "M12 3v12 M7 8l5-5 5 5 M5 15v6h14v-6",
  import: "M12 15V3 M7 10l5 5 5-5 M5 15v6h14v-6",
  cloud: "M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z",
  chevUp: "M6 15l6-6 6 6",
  borders: "M3 5h2 M8 5h2 M14 5h2 M19 5h2 M3 19h2 M8 19h2 M14 19h2 M19 19h2 M3 9v2 M3 13v2 M21 9v2 M21 13v2 M12 9v2 M12 13v2",
  chevDown: "M6 9l6 6 6-6",
  pdf: "M6 2h9l5 5v15H6z M15 2v5h5 M8.5 16v-4h1.5a1.3 1.3 0 0 1 0 2.6H8.5 M13 12v4h1a2 2 0 0 0 0-4z M17.5 16v-4h2 M17.5 14h1.5",
  styles: "M4 19h4 M6 19 11 5h1l5 14 M8.2 13h7 M19 4l1.5 1.5-5 5L14 9z",
  pasteSource: "M8 4h8v3H8z M6 5H4v16h9 M16 5h2v5 M14 13l7 7 M18 12l3 3-1 1-3-3z M13 18l2-2",
  pasteMerge: "M8 4h8v3H8z M6 5H4v16h8 M16 5h2v6 M14 15h7 M18 12l3 3-3 3",
  pasteText: "M8 4h8v3H8z M6 5H4v16h8 M16 5h2v6 M13 21l3.5-9h1L21 21 M14.3 18h5.4",
  printer: "M7 9V3h10v6 M5 9h14a2 2 0 0 1 2 2v6h-4 M7 17H3v-6a2 2 0 0 1 2-2 M7 14h10v7H7z",
};

const FILLED: Record<string, string> = {
  star: "M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z",
};

export function Icon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  if (FILLED[name]) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="ico">
        <path d={FILLED[name]} fill={color ?? "currentColor"} />
      </svg>
    );
  }
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="ico"
      fill="none" stroke={color ?? "currentColor"} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
    >
      <path d={P[name] ?? ""} />
    </svg>
  );
}
