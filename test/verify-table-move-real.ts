import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer } from "../src/prosemirror/markdown"
import { EditorState, Selection } from "prosemirror-state"
import { applyTableMutation, createTableMoveRowMutation, getTableContext } from "../src/prosemirror/table"

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

// index.html 中的真实表格
var md = "| **关系** | **说明** |\n| --- | --- |\n| `main函数`→ 进程 | 同一可执行文件，靠 `APP_WORKER_MODE` 环境变量区分 master/worker |\n| `spawnWorker` → IPC | 通过 `ExtraFiles` 传递继承 fd |"
var doc = parser.parse(md)
var state = EditorState.create({doc: doc, schema: schema})

var headCellPos = -1
doc.descendants(function (node: any, pos: number) {
  if (headCellPos < 0 && node.type.name === "table_header") {
    headCellPos = pos
  }
  return true
})
console.log("headCellPos:", headCellPos)

state = state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(headCellPos + 1))))
var ctx = getTableContext(state)
console.log("head context:", ctx && {rowIndex: ctx!.rowIndex, sectionType: ctx!.sectionType})

var tr1: any = null
var okHeadDown = applyTableMutation(state, function (tr: any) { tr1 = tr }, createTableMoveRowMutation(1))
console.log("real-table head move-down ok:", okHeadDown)
if (!okHeadDown) {
  throw new Error("BUG: real table head row cannot move down")
}
var afterHeadDown = state.apply(tr1)
console.log("after head move-down:", JSON.stringify(serializer.serialize(afterHeadDown.doc)))

// 光标 head，上移（应失败：顶部边界）
var okHeadUp = applyTableMutation(state, function () {}, createTableMoveRowMutation(-1))
console.log("real-table head move-up (expect false):", okHeadUp)
if (okHeadUp) {
  throw new Error("BUG: head move-up should fail at boundary")
}

// 光标 body 首行，上移（跨区：body 首行升 head）
var bodyFirstCellPos = -1
doc.descendants(function (node: any, pos: number) {
  if (bodyFirstCellPos < 0 && node.type.name === "table_cell") {
    bodyFirstCellPos = pos
  }
  return true
})
var state3 = EditorState.create({doc: doc, schema: schema})
state3 = state3.apply(state3.tr.setSelection(Selection.near(state3.doc.resolve(bodyFirstCellPos + 1))))
var ctx3 = getTableContext(state3)
console.log("body-first context:", ctx3 && {rowIndex: ctx3!.rowIndex, sectionType: ctx3!.sectionType})

var tr3: any = null
var okBodyUp = applyTableMutation(state3, function (tr: any) { tr3 = tr }, createTableMoveRowMutation(-1))
console.log("body-first move-up ok:", okBodyUp)
if (!okBodyUp) {
  throw new Error("BUG: body first row cannot move up")
}
console.log("after body-first move-up:", JSON.stringify(serializer.serialize(state3.apply(tr3).doc)))

console.log("REAL_TABLE_MOVE_TESTS_PASSED")