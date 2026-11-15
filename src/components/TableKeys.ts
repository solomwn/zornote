import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Slice } from "@tiptap/pm/model";
import { CellSelection } from "@tiptap/pm/tables";
import { isInCell, isWholeTable, safeCell } from "./tableTools";

/**
 * OneNote-style table behaviour:
 *  - type some text and press Tab  → the line becomes a two-cell table, cursor in the new cell
 *  - Tab in the last cell of a one-row table adds another column; in a bigger table it adds a row
 *  - pasting a whole copied table while the cursor is inside a cell nests it in that cell
 *  - pasting a table on an empty line keeps that line as the gap above it and puts the caret on a new line below
 *    (instead of overwriting the cells, which is what the stock table plugin does)
 *  - cutting a whole selected table removes the table (not just its text)
 *  - Tab in a code block inserts two spaces (handy for YAML)
 */
export const TableKeys = Extension.create({
  name: "tableKeys",
  priority: 200,

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const $from = selection.$from;

        if (editor.isActive("listItem") || editor.isActive("taskItem")) return false;

        if (editor.isActive("codeBlock")) {
          editor.commands.insertContent("  ");
          return true;
        }

        if (isInCell(state)) {
          if (editor.commands.goToNextCell()) return true;
          const $cell = safeCell(state);
          if ($cell && $cell.node(-1).childCount === 1) {
            return editor.chain().addColumnAfter().goToNextCell().run();
          }
          return false; // the stock Table shortcut adds a row
        }

        const para = $from.parent;
        if (selection.empty && para.type.name === "paragraph" && para.content.size > 0 && $from.parentOffset === para.content.size) {
          const { table, tableRow, tableCell, paragraph } = state.schema.nodes;
          if (!table || !tableRow || !tableCell) return true;
          const cell1 = tableCell.create(null, para);
          const cell2 = tableCell.createAndFill();
          if (!cell2) return true;
          const tbl = table.create(null, tableRow.create(null, [cell1, cell2]));
          const before = $from.before();
          const after = $from.after();
          const nodes = [tbl];
          if (!state.doc.resolve(after).nodeAfter) nodes.push(paragraph.create()); // keep a line to type on after the table
          const tr = state.tr.replaceWith(before, after, nodes);
          tr.setSelection(TextSelection.create(tr.doc, before + 2 + cell1.nodeSize + 2)); // inside the new second cell
          editor.view.dispatch(tr.scrollIntoView());
          return true;
        }
        return true; // keep Tab from throwing the focus out of the page
      },

      // Backspace on the empty line between two tables (or after a table) removes that line, like OneNote
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const $from = selection.$from;
        const para = $from.parent;
        if (para.type.name !== "paragraph" || para.content.size > 0 || $from.depth !== 1) return false;
        const before = $from.before();
        const prev = state.doc.resolve(before).nodeBefore;
        const next = state.doc.resolve($from.after()).nodeAfter;
        if (!prev || prev.type.spec.tableRole !== "table" || !next) return false;
        const tr = state.tr.delete(before, $from.after());
        tr.setSelection(TextSelection.near(tr.doc.resolve(before), -1));
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },

      "Shift-Tab": ({ editor }) => {
        if (editor.isActive("listItem") || editor.isActive("taskItem") || isInCell(editor.state)) return false;
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("tableKeys"),
        props: {
          handlePaste(view, _event, slice) {
            const { state } = view;
            const sel = state.selection;

            // Text copied from inside ONE cell arrives wrapped in its table/row/cell (an "open" slice).
            // Unwrap it so only the text is pasted — like OneNote — instead of a new little table.
            if (!(sel instanceof CellSelection)) {
              let content = slice.content;
              let { openStart, openEnd } = slice;
              let unwrapped = false;
              while (
                content.childCount === 1 &&
                openStart > 0 &&
                openEnd > 0 &&
                ["table", "row", "cell", "header_cell"].includes(content.firstChild!.type.spec.tableRole)
              ) {
                content = content.firstChild!.content;
                openStart--;
                openEnd--;
                unwrapped = true;
              }
              if (unwrapped && !content.firstChild?.type.spec.tableRole) {
                view.dispatch(state.tr.replaceSelection(new Slice(content, openStart, openEnd)).scrollIntoView().setMeta("uiEvent", "paste"));
                return true;
              }
            }

            if (sel instanceof CellSelection || !sel.empty || sel.$from.parent.type.name !== "paragraph") return false;
            // whole tables: one table (copied with Select ▸ Table, open by one level), or several blocks
            // with at least one table (copied by dragging across tables — a closed slice)
            let blocks = slice.content;
            if (blocks.childCount === 1) {
              const only = blocks.firstChild!;
              // a whole table has the table as its single node; a copied block of cells arrives as rows
              if (only.type.spec.tableRole !== "table") return false;
              if (slice.openStart > 1 || slice.openEnd > 1) return false; // part of a table, not a whole one
            } else {
              if (slice.openStart !== 0 || slice.openEnd !== 0) return false;
              let hasTable = false;
              let allBlocks = true;
              blocks.forEach((n) => { if (n.type.spec.tableRole === "table") hasTable = true; if (!n.isBlock) allBlocks = false; });
              if (!hasTable || !allBlocks) return false;
            }
            const tableNode = blocks;

            const { paragraph } = state.schema.nodes;
            const $from = sel.$from;
            const tr = state.tr;
            let at: number;
            let alwaysLineAfter = false;
            if ($from.parent.content.size === 0) {
              // OneNote: the empty line stays above the pasted table (it is the gap), and a fresh line below
              // takes the caret, so the next paste lands the same distance further down
              at = $from.after();
              alwaysLineAfter = true;
            } else if ($from.parentOffset === 0) {
              at = $from.before();
            } else {
              at = $from.after();
            }
            tr.insert(at, tableNode);
            const end = at + tableNode.size;
            if (alwaysLineAfter) tr.insert(end, paragraph.create($from.parent.attrs));
            else if (!tr.doc.resolve(end).nodeAfter) tr.insert(end, paragraph.create());
            tr.setSelection(TextSelection.near(tr.doc.resolve(end + 1), 1));
            view.dispatch(tr.scrollIntoView().setMeta("uiEvent", "paste"));
            return true;
          },

          handleDOMEvents: {
            cut(view) {
              const sel = view.state.selection;
              if (sel instanceof CellSelection && isWholeTable(sel)) {
                const tablePos = sel.$anchorCell.start(-1) - 1;
                // the stock handler copies and empties the cells first; afterwards drop the table itself
                queueMicrotask(() => {
                  const node = view.state.doc.nodeAt(tablePos);
                  if (node && node.type.spec.tableRole === "table") {
                    view.dispatch(view.state.tr.delete(tablePos, tablePos + node.nodeSize));
                  }
                });
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
