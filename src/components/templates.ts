const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
};

export const dateStamp = today;

export interface Template {
  name: string;
  html: () => string;
}

/* ------------------------------------------------------------------
 * Everything below is plain tables: a table nested inside a table cell,
 * with cells shaded and text typed by hand — exactly how it is built in
 * OneNote. Re-shade any cell afterwards with the "Shade" button.
 * ------------------------------------------------------------------ */

const DARK = "#3a3838"; // OneNote's dark gray
const BLACK = "#000000";
const GREY = "#efefef";

/** One table cell. `inner` is raw HTML (a <p>…</p> or a nested <table>). */
const td = (inner: string, bg?: string, width?: number) =>
  `<td${bg ? ` data-bg="${bg}"` : ""}${width ? ` colwidth="${width}"` : ""}>${inner}</td>`;
const p = (text = "") => `<p>${text}</p>`;
const tr = (...cells: string[]) => `<tr>${cells.join("")}</tr>`;
const table = (...rows: string[]) => `<table><tbody>${rows.join("")}</tbody></table>`;

const W_MAIN = 880; // wide column
const W_SIDE = 50; // narrow right-hand column that holds the ::..:: handle

/** 06:00 … 23:00, 00:00  — 19 hour cells. */
const HOURS = [...Array.from({ length: 18 }, (_, i) => `${String(i + 6).padStart(2, "0")}:00`), "00:00"];

/** The inner strip: "• ucm", "::..::", then the hours. 21 cells, like the original. */
const hourStrip = (bg?: string) =>
  table(
    tr(
      td(p("• ucm"), bg, 90),
      td(p("::..::"), bg, 44),
      ...HOURS.map((h, i) => td(p(i === 0 ? "06:00" : h), bg, i === 0 ? 44 : undefined))
    )
  );

/** Date bar: a title row, then a row holding the nested hour strip. */
const dateBar = (dark: boolean) => {
  const top = dark ? DARK : undefined;
  const bottom = dark ? BLACK : undefined;
  return (
    table(
      tr(td(p(`# ${today()}`), top, W_MAIN), td(p("::..::"), top, W_SIDE)),
      tr(td(hourStrip(dark ? DARK : undefined), bottom, W_MAIN), td(p(), bottom, W_SIDE))
    ) + "<p></p>"
  );
};

const redBar = () => table(tr(td(p(), "#ff0000", W_MAIN + W_SIDE))) + "<p></p>";

/** Container for a pasted email screenshot. */
const emailBox = () =>
  table(
    tr(td(p("–"), GREY, W_MAIN), td(p("::..::"), GREY, W_SIDE)),
    tr(td(p("Paste the email screenshot here (Ctrl+V)"), undefined, W_MAIN), td(p(), undefined, W_SIDE))
  ) + "<p></p>";

const tagTable = () =>
  table(
    tr(td(p("Site 1"), GREY, 130), td(p("Deployment tag : my-app:"), undefined, W_MAIN + W_SIDE - 130)),
    tr(td(p("Site 2"), GREY, 130), td(p("Deployment tag : my-app:"), undefined, W_MAIN + W_SIDE - 130)),
    tr(td(p("Site 3"), GREY, 130), td(p("Deployment tag : my-app:"), undefined, W_MAIN + W_SIDE - 130))
  ) + "<p></p>";

const hourGridOnly = () => hourStrip(undefined) + "<p></p>";

/** The empty container: a wide cell for content and a narrow handle cell, like the one built by hand in OneNote. */
const container = (dark: boolean) =>
  table(
    tr(
      td(p("Text") + p() + p() + p(), dark ? DARK : undefined, W_MAIN),
      td(p("::..::"), dark ? DARK : undefined, W_SIDE)
    )
  ) + "<p></p>";

const grid = (header: string[], ...rows: string[][]) =>
  table(
    tr(...header.map((h) => `<th>${p(h)}</th>`)),
    ...rows.map((r) => tr(...r.map((c) => td(p(c)))))
  ) + "<p></p>";

const RED = '<span style="color: #ff0000; font-size: 9pt">';
const NIGHT = "#3a3838"; // OneNote's dark table shading
const MID = "#7f7f7f";

/** A thin empty line between tables (a 3 pt line, about 5 px). */
const SPACER = '<p data-empty-size="3pt"></p>';
const small = (t: string) => `<span style="font-size: 9pt">${t}</span>`;

/** Header strip, then one single-row table per variable, each separated by a thin line — as built by hand in OneNote. */
const variablesTable = (title: string, rows: [string, string][]) =>
  table(tr(td(p(small("::..::")), NIGHT, 59), td(p(small(title)), MID, 205))) +
  rows
    .map(([k, v]) => SPACER + table(tr(td(p(`${RED}${k}</span>`), NIGHT, 189), td(p(small(v)), NIGHT, 205))))
    .join("") +
  "<p></p>";

export const TEMPLATES: Template[] = [
  {
    name: "Variables table (key vault)",
    html: () =>
      variablesTable("key vault variables", [
        ["$keyvault_name", "my-keyvault"],
        ["$resource_group", "my-rg"],
        ["$location", "westeurope"],
      ]),
  },
  {
    name: "Daily deployment block (full)",
    html: () => redBar() + dateBar(true) + emailBox() + tagTable(),
  },
  { name: "Date bar – dark", html: () => dateBar(true) },
  { name: "Date bar – light (shade it yourself)", html: () => dateBar(false) },
  { name: "Container – dark (wide + handle)", html: () => container(true) },
  { name: "Container – light (wide + handle)", html: () => container(false) },
  { name: "Red bar", html: redBar },
  { name: "Email box", html: emailBox },
  { name: "Hour strip only (06:00 – 00:00)", html: hourGridOnly },
  {
    name: "Tag table (site | tag)",
    html: tagTable,
  },
  {
    name: "WAF rule exclusion",
    html: () =>
      table(
        tr(
          td(
            table(
              tr(td(p("Rule set"), BLACK, 130), td(p("Microsoft_DefaultSet_2.1"), BLACK)),
              tr(td(p("Rule group"), BLACK, 130), td(p("XSS"), BLACK)),
              tr(td(p("Rule"), BLACK, 130), td(p(""), BLACK))
            ) +
              table(
                tr(...["Match variable", "Operator", "Selector", "DATE"].map((h) => `<th data-bg="${BLACK}">${p(h)}</th>`)),
                tr(td(p("QueryStringArgNames"), BLACK), td(p("Equals"), BLACK), td(p(""), BLACK), td(p(today()), BLACK))
              ),
            DARK
          )
        )
      ) + "<p></p>",
  },
  {
    name: "Image history table",
    html: () => grid(["2024", "2025", "2026"], ["", "", ""], ["", "", ""], ["", "", ""]),
  },
  {
    name: "YAML manifest with variables",
    html: () =>
      table(tr(`<th data-bg="#d8d8d8">${p("variables")}</th>`), tr(td(p("$name_space"), "#7f7f7f"))) +
      `<pre><code class="language-yaml">apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: example\n  namespace: $name_space\ndata:\n  key: value</code></pre><p></p>`,
  },
];
