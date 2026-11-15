import { useMemo, useState } from "react";

/** The 20 symbols shown in the quick popup (same set as Office's Symbol menu). */
export const DEFAULT_SYMBOLS = [
  "☐", "⌨", "▤", "◇", "⁝",
  "√", "☒", "×", "€", "£",
  "¥", "©", "®", "™", "±",
  "≠", "≤", "≥", "÷", "∞",
];

const range = (from: number, to: number, skip: number[] = []) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)
    .filter((n) => !skip.includes(n))
    .map((n) => String.fromCodePoint(n));
const chars = (s: string) => Array.from(s.replace(/\s+/g, ""));

export const SYMBOL_CATEGORIES: { name: string; symbols: string[] }[] = [
  { name: "Common", symbols: [...DEFAULT_SYMBOLS, ...chars("° µ ¶ § • … – — ‘ ’ “ ” « » † ‡ ‰ № ¡ ¿ ¢ ¤ ℠ ✓ ✔ ✗ ✘ ★ ☆ ♥ ☺ ☎ ✉ ⚠ ⚡")] },
  { name: "Math", symbols: chars("± × ÷ = ≠ ≈ ≡ ≢ ≤ ≥ < > ≪ ≫ ∞ √ ∛ ∜ ∑ ∏ ∫ ∬ ∮ ∂ ∆ ∇ ∈ ∉ ∋ ⊂ ⊃ ⊆ ⊇ ∪ ∩ ∧ ∨ ¬ ⊕ ⊗ ⊥ ∥ ∠ ∀ ∃ ∄ ∅ ∝ ∴ ∵ ′ ″ ‴ ° ¼ ½ ¾ ⅓ ⅔ ⅛ ⅜ ⅝ ⅞ % ‰ ‱ ℃ ℉ π µ Ω") },
  { name: "Arrows", symbols: chars("← → ↑ ↓ ↔ ↕ ↖ ↗ ↘ ↙ ⇐ ⇒ ⇑ ⇓ ⇔ ⇕ ↩ ↪ ↺ ↻ ⟵ ⟶ ⟷ ➔ ➜ ➞ ➤ ➡ ⬅ ⬆ ⬇ ⬈ ⬉ ⬊ ⬋ ▶ ◀ ▲ ▼ ► ◄ ▴ ▾ ◂ ▸") },
  { name: "Currency", symbols: chars("$ € £ ¥ ¢ ₹ ₽ ₩ ₺ ₪ ₫ ฿ ₿ ₴ ₦ ₱ ₡ ₲ ₵ ¤ ₠ ₢ ₣ ₤ ₥ ₧ ₨ ₭ ₮ ₯ ₰ ₳ ₷ ₸ ₼ ₾") },
  { name: "Greek", symbols: [...range(0x391, 0x3a9, [0x3a2]), ...range(0x3b1, 0x3c9)] },
  { name: "Latin", symbols: [...range(0xc0, 0xff, [0xd7, 0xf7]), ...chars("Ā ā Ă ă Ą ą Ć ć Č č Ď ď Đ đ Ē ē Ė ė Ę ę Ě ě Ğ ğ Ī ī İ ı Ł ł Ń ń Ň ň Ō ō Ő ő Œ œ Ř ř Ś ś Ş ş Š š Ţ ţ Ť ť Ū ū Ů ů Ű ű Ź ź Ż ż Ž ž")] },
  { name: "Punctuation", symbols: chars("– — ― ‐ ‑ … • · ‣ ‘ ’ ‚ “ ” „ « » ‹ › † ‡ § ¶ ‰ № ¡ ¿ ※ ‼ ⁇ ⁈ ⁉ ′ ″ ‴ ¦ ¨ ´ ` ^ ~ ¯ ˘ ˙ ¸ ˛ ˝ ©  ® ™ ℠ ℗") },
  { name: "Symbols", symbols: chars("✓ ✔ ✗ ✘ ☐ ☑ ☒ ✚ ✖ ✱ ✲ ✳ ❖ ★ ☆ ✪ ● ○ ◉ ◎ ◆ ◇ ■ □ ▪ ▫ ▲ △ ▼ ▽ ♠ ♣ ♥ ♦ ♤ ♧ ♡ ♢ ☀ ☁ ☂ ☃ ☎ ✆ ✉ ✂ ✎ ✏ ⚙ ⚠ ⚡ ⚑ ⚐ ☢ ☣ ☮ ☯ ☺ ☹ ♀ ♂ ♪ ♫ ⌨ ⌘ ⌥ ⎋ ⏎ ⌫ ⌦ ⇧ ⇥") },
  { name: "Box drawing", symbols: chars("─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼ ═ ║ ╔ ╗ ╚ ╝ ╠ ╣ ╦ ╩ ╬ ╭ ╮ ╯ ╰ ░ ▒ ▓ █ ▀ ▄ ▌ ▐ ▤ ▥ ▦ ▧ ▨ ▩ ⁝ ⋮ ⋯ ⋱") },
  { name: "Super/subscript", symbols: chars("⁰ ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹ ⁺ ⁻ ⁼ ⁽ ⁾ ⁿ ⁱ ₀ ₁ ₂ ₃ ₄ ₅ ₆ ₇ ₈ ₉ ₊ ₋ ₌ ₍ ₎") },
];

const hex = (ch: string) => "U+" + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");

export function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem("zornote:recent-symbols") ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 20) : [];
  } catch { return []; }
}
export function saveRecent(list: string[]) {
  try { localStorage.setItem("zornote:recent-symbols", JSON.stringify(list)); } catch { /* storage unavailable */ }
}

/** "More Symbols…": category tabs, a grid, and insert-by-Unicode-code. */
export function SymbolDialog({ onInsert, onClose }: { onInsert: (ch: string) => void; onClose: () => void }) {
  const [cat, setCat] = useState(0);
  const [picked, setPicked] = useState<string>("");
  const [code, setCode] = useState("");
  const list = SYMBOL_CATEGORIES[cat].symbols;

  const fromCode = useMemo(() => {
    const m = /^(?:u\+|0x)?([0-9a-f]{2,6})$/i.exec(code.trim());
    if (!m) return "";
    const n = parseInt(m[1], 16);
    if (n < 0x20 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return "";
    return String.fromCodePoint(n);
  }, [code]);

  const shown = code.trim() ? fromCode : picked; // a typed code takes over; an invalid one inserts nothing

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog sym-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Symbols</h3>
        <div className="sym-cats">
          {SYMBOL_CATEGORIES.map((c, i) => (
            <button key={c.name} className={i === cat ? "on" : ""} onClick={() => { setCat(i); setPicked(""); }}>{c.name}</button>
          ))}
        </div>
        <div className="sym-grid">
          {list.map((ch, i) => (
            <button
              key={ch + i}
              className={"sym" + (ch === picked && !code.trim() ? " on" : "")}
              title={hex(ch)}
              onClick={() => { setPicked(ch); setCode(""); }}
              onDoubleClick={() => onInsert(ch)}
            >
              {ch}
            </button>
          ))}
        </div>
        <div className="sym-foot">
          <div className="sym-preview">{shown || "·"}</div>
          <div className="sym-info">{shown ? hex(shown) : "Pick a symbol"}</div>
          <label className="sym-code">
            Unicode
            <input value={code} placeholder="e.g. 20AC" onChange={(e) => setCode(e.target.value)} />
          </label>
          <button className="primary" disabled={!shown} onClick={() => onInsert(shown)}>Insert</button>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="hint">Double-click a symbol to insert it. The dialog stays open so you can insert several.</div>
      </div>
    </div>
  );
}
