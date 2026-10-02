// 表格最后一个单元格末尾连输两个空格退出功能验证：
// 输入第二个空格时触发 input rule，删除已插入的第一个空格（纯手势不留文档），
// 在表后新建空段落并把光标放进去。
import { EditorState, TextSelection } from "prosemirror-state"
import { Node as PMNode } from "prosemirror-model"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer } from "../src/prosemirror/markdown"
import { buildPlugins } from "../src/prosemirror/plugins"

var failures = 0

function assert(label: string, ok: boolean, extra?: string) {
  if (ok) {
    console.log("PASS: " + label)
  } else {
    failures += 1
    console.log("FAIL: " + label + (extra ? "  [" + extra + "]" : ""))
  }
}

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)
var plugins = buildPlugins(schema)
var handleTextInput: any = null
for (var i = 0; i < plugins.length; i += 1) {
  var props = (plugins[i] as any).props
  if (props && typeof props.handleTextInput === "function") {
    handleTextInput = props.handleTextInput
  }
}
if (!handleTextInput) {
  throw new Error("no inputRules plugin found")
}

// 模拟输入：对给定 state 调用插件 handleTextInput。
function typeText(state: EditorState, text: string) {
  var applied = state
  var handled = handleTextInput(
    {
      composing: false,
      state: state,
      dispatch: function (tr: any) {
        applied = applied.apply(tr)
      }
    },
    state.selection.from,
    state.selection.to,
    text
  )
  return { handled: handled, state: applied }
}

var MD_TABLE = "| H1 | H2 |\n| --- | --- |\n| a1 | a2 |\n| b1 | b2 |"

// 遍历 doc 的 thead/tbody 结构，找第 rowIndex 行第 colIndex 列单元格的文本末尾位置。
function findCellEnd(doc: PMNode, rowIndex: number, colIndex: number): number {
  var flatCells: Array<{ pos: number; size: number }> = []
  doc.descendants(function (node: any, pos: number) {
    if (node.type.name === "table_cell" || node.type.name === "table_header") {
      flatCells.push({ pos: pos, size: node.content.size })
    }
    return true
  })
  var width = 2
  var index = rowIndex * width + colIndex
  var cell = flatCells[index]
  if (!cell) {
    throw new Error("cell not found: " + rowIndex + "," + colIndex)
  }
  return cell.pos + cell.size + 1
}

function buildStateAtCell(md: string, rowIndex: number, colIndex: number) {
  var doc = parser.parse(md)
  var pos = findCellEnd(doc, rowIndex, colIndex)
  return EditorState.create({
    doc: doc,
    selection: TextSelection.create(doc, pos)
  })
}

// 先插入第一个空格（模拟真实输入的第一步），再输入第二个空格
function typeDoubleSpace(state: EditorState) {
  var afterFirst = state.apply(state.tr.insertText(" "))
  return typeText(afterFirst, " ")
}

// ---- 用例 1：最后一格（body 末行末列）双空格跳出表格 ----
var lastCellState = buildStateAtCell(MD_TABLE, 2, 1)
var result = typeDoubleSpace(lastCellState)
assert("last cell double space handled", result.handled === true)

var out = serializer.serialize(result.state.doc)
assert(
  "space removed from cell, table intact",
  out === MD_TABLE,
  JSON.stringify(out)
)

var doc1 = result.state.doc
assert("paragraph created after table", doc1.childCount === 2 && doc1.child(1).type.name === "paragraph", "childCount=" + doc1.childCount)
assert("new paragraph is empty", doc1.child(1).content.size === 0)
assert(
  "cursor inside new paragraph",
  result.state.selection.empty &&
    result.state.selection.$from.parent.type.name === "paragraph" &&
    result.state.selection.$from.parentOffset === 0 &&
    result.state.selection.$from.parent.content.size === 0
)

// 跳出后继续输入落在表后段落
var typedAfter = result.state.apply(result.state.tr.insertText("x"))
var outAfter = serializer.serialize(typedAfter.doc)
assert("typing after exit lands after table", outAfter === MD_TABLE + "\n\nx", JSON.stringify(outAfter))

// ---- 用例 2：末行非末列不触发 ----
var midColState = buildStateAtCell(MD_TABLE, 2, 0)
var midColResult = typeDoubleSpace(midColState)
assert("non-last column not handled", midColResult.handled === false)
// 序列化会 trim 单元格尾空格，改查文档：第一空格保留（b1 后跟 1 个空格），第二个空格未进文档
var midColText = ""
midColResult.state.doc.descendants(function (node: any, pos: number) {
  if (node.type.name === "table_cell" && node.textContent.indexOf("b1") === 0) {
    midColText = node.textContent
    return false
  }
  return true
})
assert("non-last column first space kept, second not inserted", midColText === "b1 ", JSON.stringify(midColText))

// ---- 用例 3：中间行末列不触发 ----
var midRowState = buildStateAtCell(MD_TABLE, 1, 1)
var midRowResult = typeDoubleSpace(midRowState)
assert("middle row not handled", midRowResult.handled === false)

// ---- 用例 4：head 行末列不触发（body 存在时 head 不是最后一行）----
var headState = buildStateAtCell(MD_TABLE, 0, 1)
var headResult = typeDoubleSpace(headState)
assert("head row not handled", headResult.handled === false)

// ---- 用例 5：光标在最后一格中间时不触发 ----
var midCellDoc = parser.parse(MD_TABLE)
var midCellEnd = findCellEnd(midCellDoc, 2, 1)
// b2 中间（b 和 2 之间）
var midCellState = EditorState.create({
  doc: midCellDoc,
  selection: TextSelection.create(midCellDoc, midCellEnd - 2)
})
var midCellResult = typeDoubleSpace(midCellState)
assert("cursor mid-cell not handled", midCellResult.handled === false)

// ---- 用例 6：仅 head 的表（无 body），最后一格是 head 末列 ----
var headOnlyState = buildStateAtCell("| H1 | H2 |\n| --- | --- |", 0, 1)
var headOnlyResult = typeDoubleSpace(headOnlyState)
assert("head-only table exits", headOnlyResult.handled === true)
assert(
  "head-only table doc shape",
  headOnlyResult.state.doc.childCount === 2 && headOnlyResult.state.doc.child(1).type.name === "paragraph"
)

// ---- 用例 7：表后已有段落时，插在其前面，不改写后续内容 ----
var mdWithTail = MD_TABLE + "\n\ntail"
var tailState = buildStateAtCell(mdWithTail, 2, 1)
var tailResult = typeDoubleSpace(tailState)
assert("exit before existing tail handled", tailResult.handled === true)
var tailOut = serializer.serialize(tailResult.state.doc)
assert("existing tail preserved", tailOut === MD_TABLE + "\n\ntail" || tailOut === MD_TABLE + "\n\n\ntail", JSON.stringify(tailOut))

// ---- 用例 8：末格带 mark 的文本：先跳 mark，再跳表（分层触发）----
var markedState = buildStateAtCell(MD_TABLE, 2, 1)
markedState = markedState.apply(markedState.tr.addMark(markedState.selection.from - 2, markedState.selection.from, schema.marks.strong.create()))
var markFirst = typeDoubleSpace(markedState)
// 第一次双空格：先退出 mark（手势被 mark 规则消费），表结构未变
assert("mark exit consumed the first gesture, table kept", markFirst.state.doc.childCount === 1)
// 再来一次双空格：现在光标前是普通空格，应退出表格
var exitSecond = typeDoubleSpace(markFirst.state)
assert("second double space exits table after mark exit", exitSecond.handled === true && exitSecond.state.doc.childCount === 2)

// ---- 用例 9：nbsp 变体（Chrome 行尾空格写成 nbsp）----
var nbspState = buildStateAtCell(MD_TABLE, 2, 1)
var nbspAfterFirst = nbspState.apply(nbspState.tr.insertText("\u00a0"))
var nbspResult = typeText(nbspAfterFirst, "\u00a0")
assert("nbsp double space handled", nbspResult.handled === true)

if (failures > 0) {
  console.log(failures + " failure(s)")
  process.exit(1)
} else {
  console.log("ALL PASS")
}