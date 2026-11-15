# Changelog

## 0.4.6 – logo
- New ZorNote logo: a note page with a bold Z and three section tabs (red, teal, blue) on an indigo tile.
  Files in `branding/` (SVG + PNG; wordmark for light and dark backgrounds).
- The .deb now installs the app icon (32–512 px), so ZorNote shows its icon in the app menu, dock and window list.
- Small logo next to "ZorNote" in the sidebar.

## 0.4.5 – PDF and printing
- **File ▸ Export to PDF**: saves the open page as a PDF (A4) – title, date and content, with shading and colours,
  real (selectable, sharp) text. Wide pages switch to landscape and are scaled to fit the paper width.
- **File ▸ Print…**: the system print dialog (your printers, or Print to File).

## 0.4.4
- Section tabs can be dragged left / right to reorder them (a black bar shows where the tab will land).
  Right-click a tab (or a section in the sidebar) ▸ Move left / Move right does the same.

## 0.4.3 – resize pictures like OneNote
- Click a picture → dotted frame with 8 handles. Corners: bigger/smaller keeping proportions. Sides: stretch width or height only.
- Right-click a picture: Restore to Original Size, Size 25% / 50% / 75%, Fit to Page Width, Cut / Copy.
- The size is saved with the page (works for pictures inside table cells too).

## 0.4.2
- **Hide Borders** (OneNote's Table ▸ Hide Borders): the table keeps its cells and shading, the lines are not drawn.
  Table tab ▸ Hide Borders, or right-click in a table ▸ Hide borders / Show borders.
  Select several tables by dragging, then right-click ▸ Hide borders (selected tables) to do them all at once.
  Tables nested inside keep their own setting.

## 0.4.1
- Selected tables turn grey, like OneNote (was a purple frame).
- Thinner column-resize grab zone (3 px): a selection drag that starts near a border no longer resizes the column by accident.

## 0.4.0 – select several tables at once
- **Drag** from one table into another (or past the lines between them): all of them are selected as whole tables (purple frame).
  Works inside a container too (tables nested in the same cell). Dragging inside one table still selects cells.
- **Shift+click**: click in the first table, Shift+click in the last.
- **Ctrl+C / Ctrl+X / right-click Copy/Cut** take the complete tables with the lines between them.
- **Paste** them on an empty line (they go below it, the line stays as the gap) or in a cell (they nest inside it).

## 0.3.9
- View ▸ **White text**: Normal / Bright (default) / Brightest — how bright light text looks on dark shading.
  Measured in the app (average brightness of white text on #3a3838, 0–255): Crisp off 183, Normal 200, Bright 205, Brightest 210; OneNote on Windows ≈ 204.

## 0.3.8
- Crisp Text is stronger on dark shading (light text there now reaches the same brightness as OneNote's ClearType text).
- File ▸ **Use OneNote Colours**: switches older ZorNote shading colours on all pages to OneNote's exact ones
  (#CFE8FF→#D6DCE4, #D9D9D9→#D0CECE, #3A3A3A/#3F3F3F/#404040→#3A3838, #808080→#7F7F7F). Text colours are not touched;
  each changed page gets a version first (History ▸ Page Versions).

## 0.3.7 – View ▸ Text
- **Crisp Text** (on by default): small text gets a hair of extra weight, like ClearType on Windows. Toggle it in View.
- **Default font / Default size**: the font used for text that has no font of its own (e.g. Verdana 8 like your OneNote pages).
- If you changed the font settings from 0.3.6's README, undo them – they make WebKit text thinner:
  `gsettings set org.gnome.desktop.interface font-hinting 'slight'`
  `gsettings set org.gnome.desktop.interface font-antialiasing 'grayscale'`

## 0.3.6 – Fonts
The Font list now says when a font is **not installed** and which font is shown instead (Linux silently swaps
missing fonts, e.g. Verdana → DejaVu Sans). The desktop app asks fontconfig (`fc-list`) for the real list.

### Make text look like OneNote on Windows
1. Install the real Microsoft fonts (Verdana, Arial, Times New Roman, Courier New, Georgia, …):
   `sudo apt install ttf-mscorefonts-installer` (accept the licence with Tab + Enter), then `fc-cache -f`.
   Calibri/Cambria look-alikes: `sudo apt install fonts-crosextra-carlito fonts-crosextra-caladea`.
   Check: `fc-match Verdana` should print `Verdana.ttf`.
2. Sharper text: use View ▸ Crisp Text (0.3.7). Don't change the system hinting settings – they made it worse.

## 0.3.5
- Table borders are drawn per cell (separate borders) instead of shared "collapsed" borders: with collapsed borders WebKitGTK sometimes didn't repaint the line between two shaded cells while typing.

## 0.3.4
- Tables whose column widths are set keep them exactly: typing longer text wraps inside the cell instead of nudging the borders, so stacked tables stay lined up (like OneNote).

## 0.3.3
- Shading palette: a cell colour that is not one of OneNote's palette colours (e.g. `#3a3a3a` from older templates) is shown first under Recent Colors and framed, so the current colour is always visible.
- Templates now use OneNote's own colours (#3a3838 dark gray, #d8d8d8, #7f7f7f).

## 0.3.2
- The colour palette frames the colour that is already applied (cell shading, font colour, highlight, panel), like OneNote; with none applied, "No Color" / "Automatic" is framed.
- In the shading and highlight palettes "No Color" sits at the bottom, as in OneNote.

## 0.3.1
- OneNote's colour palette everywhere a colour is picked (font colour, highlight, shading, panels): Automatic / No Color, Theme Colors with their 5 lighter/darker shades, Standard Colors, Recent Colors, More Colors…, Hex Color…. Hover a colour to see its name.
- Right-click in a table → **Shading ▸** opens the palette beside the menu, like OneNote.

## 0.3.0 – OneNote look
- **Ribbon** across the top like OneNote, with tabs **File · Home · Insert · History · View** (+ a purple **Table** tab when the cursor is in a table). Collapse it with the ˄ button on the right; it remembers the tab you used last.
  - Home: Clipboard (Paste, Cut, Copy, **Format Painter**), Basic Text, Styles (Heading 1/2 gallery), **Tags**.
  - Insert: Table (size grid), Picture, Link, Date, Templates, Panel / Code Block / Quote / Line / Checklist, Symbol.
  - Table: Select, Delete, Insert, Merge, Shading, Duplicate Row, Fit to Page Width.
  - History: Page Versions, Recently Deleted, Back Up Now, backups folder.
  - File: export / import (moved here from the sidebar).
- **Tags** like OneNote: Ctrl+1 To Do (click the box to tick it), Ctrl+2 Important ★, Ctrl+3 Question, Ctrl+0 remove. **Find Tags** lists every tagged line in all notebooks.
- Section tabs drawn like OneNote (all in their colour, current one bold). Section colour: right-click a section → *Section color…*.

## 0.2.1
- Copying text from inside a table cell and pasting it pastes just the text (it used to arrive as a small nested table).
- Typing "# ", "> " or "---" no longer turns the line into a heading / quote / line (OneNote doesn't); use the toolbar for headings.

## 0.2.0 – SQLite edition
Storage moved from one big `notebooks.json` to a SQLite database:

| File | What it is |
|---|---|
| `~/.local/share/dev.zornote.app/zornote.db` | all notebooks, sections, pages and images |
| `~/.local/share/dev.zornote.app/backups/zornote-YYYY-MM-DD.db` | automatic daily copy, newest 30 kept |
| `~/.local/share/dev.zornote.app/notebooks.json` | old store – imported once on first start of 0.2.0, then left untouched |

- A save only writes the pages that changed (and the notebook tree), in one transaction: a crash or power cut can't leave a half-written file.
- Pasted images are stored once (by content hash) instead of inside every page's text.
- **Page versions**: before a page is changed, its previous content is kept (at most one copy per 10 minutes). Right-click a page → *Page versions…* to preview and restore. Restoring keeps the current content as a version too.
- **Recently deleted pages** (Import / Export menu): deleted pages, sections and groups are kept and can be restored.
- *Back up now*, *Open backups folder*, *Where is my data?* in the Import / Export menu.
- To copy the database by hand, close ZorNote first – or copy a file from `backups/`, which is always safe.
- To restore a backup: close ZorNote, copy `backups/zornote-<date>.db` over `zornote.db` (delete `zornote.db-wal` and `zornote.db-shm` if present), start ZorNote.
- Fixed: Delete / rename questions now use ZorNote's own dialogs. The system ones didn't wait for the answer in the desktop app, so *Cancel* did not stop a delete.

## 0.1.13
- Tables that touch (no line between them) resize as one block: dragging a column border also moves the borders on the same line in the touching tables, so a header strip stays lined up with the table under it. Tables with a line between them stay independent.

## 0.1.12
- Pasting a copied table on an empty line works like OneNote: the empty line stays above as the gap, the table goes below it, and the caret moves to a new line under the table, so repeated pastes stack with the same gap (shrink a gap by setting that line's font size).

## 0.1.11
- Tighter table cells like OneNote: no paragraph margin in cells, 2px/5px padding, line height 1.22 (Calibri). Font sizes 3, 4 and 5 added for thin spacer lines between tables.
- "Variables table (key vault)" template rebuilt as separate one-row tables with 3 pt spacer lines.

## 0.1.10
- Table borders use OneNote's grey (#8a8886). New shading colours #3a3838 (OneNote dark) and #7f7f7f; pure red (#ff0000) added to the text colours.
- New template "Variables table (key vault)": header strip + name | value table, dark, names in red.

## 0.1.9
- No fixed margin around tables: the space between two tables is exactly the line between them, so it follows that line's font size (set it to 6 to make it tiny). Backspace on the empty line removes it and the tables touch.

## 0.1.8
- Tables are content-sized like OneNote (compact columns); Tab adds a narrow column; dragging a border changes only that column and the table grows.

## 0.1.7 – table workflow (as in OneNote)
- Type text, press **Tab** → the line becomes a 2-cell table (Tab in the last cell adds a column in 1-row tables, a row otherwise).
- Drag a column border to resize; Enter in a cell makes it taller.
- **Right-click in a table**: Cut / Copy / Paste, **Shading** (whole table by default, switch to "This cell"), insert/delete rows & columns, duplicate row, merge/split, fit to page width, Select cell/row/column/table.
- Copy a whole table (Select → Table → Copy) and paste with the caret in a cell: it is **nested** inside that cell.
