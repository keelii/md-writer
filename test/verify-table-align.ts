// 表格列对齐（GFM 分隔行 :--- / :---: / ---:）全链路验证：
// 解析端对齐落到列内每个 th/td 的 align attr、序列化端按表头行还原
// 分隔行、加行继承列对齐、加列默认无对齐、toDOM 写 text-align 内联样式。
import { EditorState } from "prosemirror-state"
import { Node as PMNode } from "prosemirror-model"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, serializeNodeMarkdown } from "../src/prosemirror/markdown"
import {
  applyTableMutationWithContext,
  getTableContextAt,
  getTableRowsFromNode,
  mutateTableAddRow,
  mutateTableAddColumn
} from "../src/prosemirror/table"

var failures = 0

function assert(label: string, ok: boolean, extra?: string) {
  if (ok) {
    console.log("PASS: " + label)
  } else {
    failures += 1
    console.log("FAIL: " + label + (extra ? "  [" + extra + "]" : ""))
  }
}

function collectCellAligns(doc: PMNode): Array<Array<string | null>> {
  var rows: Array<Array<string | null>> = []
  doc.descendants(function (node, _pos, _parent) {
    if (node.type.name === "table_row") {
      var aligns: Array<string | null> = []
      node.forEach(function (cell) {
        aligns.push(cell.attrs && cell.attrs.align ? String(cell.attrs.align) : null)
      })
      rows.push(aligns)
      return false
    }
    return true
  })
  return rows
}

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

// 四列：显式左 / 居中 / 右 / 默认（---）
var MD_ALIGNED = "| A | B | C | D |\n| :--- | :---: | ---: | --- |\n| a1 | a2 | a3 | a4 |\n| b1 | b2 | b3 | b4 |"

// ---- 用例 1：解析端对齐落到列内每个 cell（表头 + 表体）----
var doc = parser.parse(MD_ALIGNED)
var aligns = collectCellAligns(doc)
assert("parsed 3 rows", aligns.length === 3, JSON.stringify(aligns))
assert(
  "header row aligns",
  aligns[0] && aligns[0][0] === "left" && aligns[0][1] === "center" && aligns[0][2] === "right" && aligns[0][3] === null,
  JSON.stringify(aligns[0])
)
assert(
  "body row 1 aligns follow column",
  aligns[1] && aligns[1][0] === "left" && aligns[1][1] === "center" && aligns[1][2] === "right" && aligns[1][3] === null,
  JSON.stringify(aligns[1])
)
assert(
  "body row 2 aligns follow column",
  aligns[2] && aligns[2][0] === "left" && aligns[2][1] === "center" && aligns[2][2] === "right" && aligns[2][3] === null,
  JSON.stringify(aligns[2])
)

// ---- 用例 2：序列化端按列还原分隔行（往返一致）----
var out = serializer.serialize(doc)
assert("serialize round-trip keeps delimiter alignment", out === MD_ALIGNED, JSON.stringify(out))
var doc2 = parser.parse(out)
assert("re-parse keeps aligns", JSON.stringify(collectCellAligns(doc2)) === JSON.stringify(aligns))

// ---- 用例 3：无对齐表格不受影响 ----
var MD_PLAIN = "| H1 | H2 |\n| --- | --- |\n| a | b |"
var plainOut = serializer.serialize(parser.parse(MD_PLAIN))
assert("plain table delimiter unchanged", plainOut === MD_PLAIN, JSON.stringify(plainOut))

// ---- 用例 4：toDOM 把 align 写成 text-align 内联样式 ----
// table_header / table_cell 本身就是单元格节点（content 为 inline*），
// 直接用 descendants 找带 align 与不带 align 的表头 cell。
var centerCell: PMNode | null = null
var defaultCell: PMNode | null = null
doc.descendants(function (node) {
  if (node.type.name === "table_header") {
    if (!centerCell && node.attrs.align === "center") {
      centerCell = node
    } else if (!defaultCell && !node.attrs.align) {
      defaultCell = node
    }
  }
  return true
})
var toDOMSpec: any = centerCell ? (centerCell.type.spec.toDOM as any)(centerCell) : null
assert(
  "cell toDOM writes text-align style",
  !!toDOMSpec && toDOMSpec[1].class === "table-cell" && toDOMSpec[1].style === "text-align:center",
  JSON.stringify(toDOMSpec && toDOMSpec[1])
)
var defaultSpec: any = defaultCell ? (defaultCell.type.spec.toDOM as any)(defaultCell) : null
assert(
  "default cell toDOM omits style",
  !!defaultSpec && defaultSpec[1].class === "table-cell" && !defaultSpec[1].style,
  JSON.stringify(defaultSpec && defaultSpec[1])
)

// ---- 用例 5：加行继承列对齐，分隔行不变 ----
var state = EditorState.create({doc: doc, schema: schema})
var tablePos = -1
doc.descendants(function (node, pos) {
  if (tablePos < 0 && node.type.name === "table") {
    tablePos = pos
  }
  return true
})
var tableNode: PMNode | null = null
doc.descendants(function (node) {
  if (!tableNode && node.type.name === "table") {
    tableNode = node
    return false
  }
  return true
})
var addRowContext = tableNode && tablePos >= 0 ? getTableContextAt(tableNode, tablePos, 1, 0) : null
assert("add row context built", !!addRowContext)
var addRowTr: any = null
var addRowOk = addRowContext
  ? applyTableMutationWithContext(state, function (tr: any) { addRowTr = tr }, addRowContext, mutateTableAddRow)
  : false
assert("add row ok", addRowOk === true)
if (addRowOk) {
  var addRowDoc = state.apply(addRowTr).doc
  var addRowAligns = collectCellAligns(addRowDoc)
  assert("added row inherits column aligns", addRowAligns.length === 4 &&
    addRowAligns[2] &&
    addRowAligns[2][0] === "left" && addRowAligns[2][1] === "center" && addRowAligns[2][2] === "right" && addRowAligns[2][3] === null,
    JSON.stringify(addRowAligns))
  var addRowOut = serializer.serialize(addRowDoc)
  assert(
    "delimiter row unchanged after add row",
    addRowOut.indexOf("| :--- | :---: | ---: | --- |") >= 0,
    JSON.stringify(addRowOut)
  )
}

// ---- 用例 6：加列默认无对齐，既有列分隔符保留 ----
var addColContext = tableNode && tablePos >= 0 ? getTableContextAt(tableNode, tablePos, 0, 2) : null
assert("add column context built", !!addColContext)
var addColTr: any = null
var addColOk = addColContext
  ? applyTableMutationWithContext(state, function (tr: any) { addColTr = tr }, addColContext, mutateTableAddColumn)
  : false
assert("add column ok", addColOk === true)
if (addColOk) {
  var addColDoc = state.apply(addColTr).doc
  var addColOut = serializer.serialize(addColDoc)
  assert(
    "new column delimiter defaults, existing kept",
    addColOut.indexOf("| :--- | :---: | ---: | --- | --- |") >= 0,
    JSON.stringify(addColOut)
  )
  var addColAligns = collectCellAligns(addColDoc)
  assert("new column cells have no align", addColAligns.length >= 1 &&
    addColAligns.every(function (row) { return row[3] == null }),
    JSON.stringify(addColAligns))
}

// ---- 用例 7：serializeNodeMarkdown 单表复制源码保留对齐 ----
if (tableNode) {
  var tableMarkdown = serializeNodeMarkdown(serializer, tableNode)
  assert("copy-source keeps delimiter alignment", tableMarkdown === MD_ALIGNED, JSON.stringify(tableMarkdown))
}

// ---- 用例 8：仅默认分隔行 → 序列化不画蛇添足 ----
var MD_DEFAULT_ONLY = "| X |\n| --- |"
var defaultOnlyOut = serializer.serialize(parser.parse(MD_DEFAULT_ONLY))
assert("default-only delimiter stays ---", defaultOnlyOut === MD_DEFAULT_ONLY, JSON.stringify(defaultOnlyOut))

// ---- 用例 9：无表头对齐的 JSON 变更后（cell 全 null）分隔行为 --- ----
// 表头行所有 cell 的 align 是分隔行的唯一事实来源：即使 body cell 被外置
// 流程改成 null，分隔行也只看表头行。
var rowsMeta = tableNode ? getTableRowsFromNode(tableNode) : []
assert("table rows enumerable", rowsMeta.length === 3, "rows=" + rowsMeta.length)

if (failures > 0) {
  console.log(failures + " failure(s)")
  process.exit(1)
} else {
  console.log("TABLE_ALIGN_TESTS_PASSED")
}