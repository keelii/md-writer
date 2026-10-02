import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer } from "../src/prosemirror/markdown"
import { EditorState, Selection } from "prosemirror-state"
import { applyTableMutation, createTableMoveRowMutation, createTableMoveColumnMutation, getTableContext } from "../src/prosemirror/table"

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

var md = "| H1 | H2 |\n| --- | --- |\n| a1 | a2 |\n| b1 | b2 |"
var doc = parser.parse(md)
var state = EditorState.create({doc: doc, schema: schema})

var tablePos = -1
doc.descendants(function (node: any, pos: number) {
  if (tablePos < 0 && node.type.name === "table") {
    tablePos = pos
  }
  return true
})
console.log("tablePos:", tablePos)

// 光标放到 head 行第一个 cell
var cursorPos = tablePos + 4
state = state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(cursorPos))))

var context = getTableContext(state)
console.log("head context:", context && {rowIndex: context!.rowIndex, colIndex: context!.colIndex, sectionType: context!.sectionType})

var dispatchedTr: any = null
var okDown = applyTableMutation(state, function (tr: any) { dispatchedTr = tr }, createTableMoveRowMutation(1))
console.log("head row move-down ok:", okDown)
if (!okDown) {
  throw new Error("BUG REPRODUCED: head row cannot move down")
}

var newState = state.apply(dispatchedTr)
var out = serializer.serialize(newState.doc)
console.log("after head move-down:", JSON.stringify(out))

// 光标放到 body 第二行，测试上移
var tablePos2 = -1
newState.doc.descendants(function (node: any, pos: number) {
  if (tablePos2 < 0 && node.type.name === "table") {
    tablePos2 = pos
  }
  return true
})
var cellPositions: number[] = []
newState.doc.descendants(function (node: any, pos: number) {
  if (node.type.name === "table_header" || node.type.name === "table_cell") {
    cellPositions.push(pos)
  }
  return true
})
console.log("cell count:", cellPositions.length)
// 最后一个 cell 是 body 第 2 行
var lastCellPos = cellPositions[cellPositions.length - 1]
var state2 = newState.apply(newState.tr.setSelection(Selection.near(newState.doc.resolve(lastCellPos + 1))))
var ctx2 = getTableContext(state2)
console.log("body row2 context:", ctx2 && {rowIndex: ctx2!.rowIndex, colIndex: ctx2!.colIndex, sectionType: ctx2!.sectionType})

var tr2: any = null
var okUp = applyTableMutation(state2, function (tr: any) { tr2 = tr }, createTableMoveRowMutation(-1))
console.log("body row2 move-up ok:", okUp)
if (!okUp) {
  throw new Error("BUG: body row cannot move up")
}
var finalState = state2.apply(tr2)
console.log("after body move-up:", JSON.stringify(serializer.serialize(finalState.doc)))

// 列移动：head 第一列右移应成功
var tr3: any = null
var okColRight = applyTableMutation(state, function (tr: any) { tr3 = tr }, createTableMoveColumnMutation(1))
console.log("head col move-right ok:", okColRight)
if (!okColRight) {
  throw new Error("BUG: head col cannot move right")
}
console.log("after col move-right:", JSON.stringify(serializer.serialize(state.apply(tr3).doc)))

// 边界：head 第一列左移应失败
var okColLeft = applyTableMutation(state, function () {}, createTableMoveColumnMutation(-1))
console.log("head col move-left boundary (expect false):", okColLeft)
if (okColLeft) {
  throw new Error("BUG: boundary col move-left should fail")
}

console.log("ALL_MOVE_TESTS_PASSED")