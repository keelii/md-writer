// 预览类 raw_block（$$ 公式 / iframe / frontmatter）删除验证：
// 光标在相邻文本块边界按 Backspace/Delete 应整块删除预览节点，
// 而不是让 joinBackward/joinForward 把段落合并进不可编辑的预览节点。
import { EditorState, TextSelection, NodeSelection } from "prosemirror-state"
import { Node as PMNode } from "prosemirror-model"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, parseMarkdown } from "../src/prosemirror/markdown"
import { deletePreviewRawBlockOnBackspace, deletePreviewRawBlockOnDelete, getRawBlockKind } from "../src/prosemirror/nodeviews/kinds"

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

function applyCmd(cmd: (state: EditorState, dispatch?: any) => boolean, state: EditorState) {
  var applied = state
  var handled = cmd(state, function (tr: any) {
    applied = applied.apply(tr)
  })
  return { handled: handled, state: applied }
}

function buildState(md: string, cursorAt: number | ((doc: PMNode) => number)) {
  var doc = parseMarkdown(schema, parser, md)
  var pos = typeof cursorAt === "function" ? cursorAt(doc) : cursorAt
  return EditorState.create({
    doc: doc,
    selection: TextSelection.create(doc, pos)
  })
}

function childSummary(doc: PMNode) {
  var parts: string[] = []
  doc.forEach(function (n: PMNode) {
    parts.push(n.type.name + "(" + n.textContent + ")")
  })
  return parts.join(" | ")
}

var MD_MATH_TAIL = "$$\nx^2 + 1\n$$\n\nafter"

// 定位：第 index 个顶层子块内、offset 偏移处
function posIn(doc: PMNode, index: number, offset: number): number {
  var start = -1
  doc.forEach(function (_n: PMNode, o: number, i: number) {
    if (i === index) {
      start = o + 1 + offset
    }
  })
  if (start < 0) {
    throw new Error("block " + index + " not found")
  }
  return start
}

// ---- 用例 1：光标在公式块后段落开头，Backspace 整块删除公式 ----
var s1 = buildState(MD_MATH_TAIL, function (doc) { return posIn(doc, 1, 0) })
var r1 = applyCmd(deletePreviewRawBlockOnBackspace, s1)
assert("backspace after math block handled", r1.handled === true)
assert("math block removed, paragraph kept", childSummary(r1.state.doc) === "paragraph(after)", childSummary(r1.state.doc))
assert("cursor lands in paragraph", r1.state.selection.$from.parent.type.name === "paragraph" && r1.state.selection.$from.parent.textContent === "after")

// ---- 用例 2：光标在公式块前段落末尾，Delete 整块删除公式 ----
var MD_MATH_HEAD = "before\n\n$$\nx^2 + 1\n$$"
var s2 = buildState(MD_MATH_HEAD, function (doc) { return posIn(doc, 0, 6) })
var r2 = applyCmd(deletePreviewRawBlockOnDelete, s2)
assert("delete before math block handled", r2.handled === true)
assert("math block removed, paragraph kept", childSummary(r2.state.doc) === "paragraph(before)", childSummary(r2.state.doc))

// ---- 用例 3：公式块是文档首节点（后段落开头 Backspace）----
var s3 = buildState("$$\nE = mc^2\n$$\n\ntext", function (doc) { return posIn(doc, 1, 0) })
var r3 = applyCmd(deletePreviewRawBlockOnBackspace, s3)
assert("backspace after doc-leading math handled", r3.handled === true)
assert("doc-leading math removed", childSummary(r3.state.doc) === "paragraph(text)", childSummary(r3.state.doc))

// ---- 用例 4：公式块是文档末节点（前段落末尾 Delete）----
var s4 = buildState("text\n\n$$\nE = mc^2\n$$", function (doc) { return posIn(doc, 0, 4) })
var r4 = applyCmd(deletePreviewRawBlockOnDelete, s4)
assert("delete before doc-trailing math handled", r4.handled === true)
assert("doc-trailing math removed", childSummary(r4.state.doc) === "paragraph(text)", childSummary(r4.state.doc))

// ---- 用例 5：光标在段落中间不触发（Backspace / Delete）----
var s5 = buildState(MD_MATH_TAIL, function (doc) { return posIn(doc, 1, 2) })
var r5b = applyCmd(deletePreviewRawBlockOnBackspace, s5)
var r5d = applyCmd(deletePreviewRawBlockOnDelete, s5)
assert("mid-paragraph backspace not handled", r5b.handled === false && r5d.handled === false)
assert("doc unchanged when not triggered", childSummary(r5b.state.doc) === "raw_block($$\nx^2 + 1\n$$) | paragraph(after)", childSummary(r5b.state.doc))

// ---- 用例 6：前/后一个兄弟块不是预览类 raw_block 时不触发 ----
var s6 = buildState("plain\n\nafter", function (doc) { return posIn(doc, 1, 0) })
var r6 = applyCmd(deletePreviewRawBlockOnBackspace, s6)
assert("paragraph sibling not handled", r6.handled === false)
var r6d = applyCmd(deletePreviewRawBlockOnDelete, s6)
assert("paragraph forward sibling not handled", r6d.handled === false)

// ---- 用例 7：非预览类 raw_block（普通 HTML 块）不拦截，保持 join 原行为 ----
var MD_HTML = "<div>\nhello\n</div>\n\nafter"
var s7 = buildState(MD_HTML, function (doc) { return posIn(doc, 1, 0) })
var r7 = applyCmd(deletePreviewRawBlockOnBackspace, s7)
assert("non-preview raw block not handled", r7.handled === false, childSummary(s7.doc))

// ---- 用例 8：iframe / frontmatter 预览同样受保护 ----
var MD_IFRAME = '<iframe src="https://example.com" width="640" height="360"></iframe>\n\nafter'
if (getRawBlockKind('<iframe src="https://example.com"></iframe>') === "iframe") {
  var s8 = buildState(MD_IFRAME, function (doc) { return posIn(doc, 1, 0) })
  var r8 = applyCmd(deletePreviewRawBlockOnBackspace, s8)
  assert("iframe preview block handled", r8.handled === true)
  assert("iframe preview removed", childSummary(r8.state.doc) === "paragraph(after)", childSummary(r8.state.doc))
} else {
  assert("iframe preview kind detected", false, "raw-preview kind unexpected")
}

var MD_FM = "---\ntitle: hi\n---\n\nafter"
var s9 = buildState(MD_FM, function (doc) { return posIn(doc, 1, 0) })
var r9 = applyCmd(deletePreviewRawBlockOnBackspace, s9)
assert("frontmatter preview block handled", r9.handled === true)
assert("frontmatter removed, paragraph kept", childSummary(r9.state.doc) === "paragraph(after)", childSummary(r9.state.doc))

// ---- 用例 10：mermaid code_block 同为预览节点，边界 Backspace/Delete 一按整删 ----
var MD_MERMAID_TAIL = "```mermaid\ngraph TB\nA-->B\n```\n\nafter"
var s10 = buildState(MD_MERMAID_TAIL, function (doc) { return posIn(doc, 1, 0) })
var r10 = applyCmd(deletePreviewRawBlockOnBackspace, s10)
assert("backspace after mermaid handled", r10.handled === true)
assert("mermaid removed, paragraph kept", childSummary(r10.state.doc) === "paragraph(after)", childSummary(r10.state.doc))

var MD_MERMAID_HEAD = "before\n\n```mermaid\ngraph TB\nA-->B\n```"
var s11 = buildState(MD_MERMAID_HEAD, function (doc) { return posIn(doc, 0, 6) })
var r11 = applyCmd(deletePreviewRawBlockOnDelete, s11)
assert("delete before mermaid handled", r11.handled === true)
assert("mermaid removed, head paragraph kept", childSummary(r11.state.doc) === "paragraph(before)", childSummary(r11.state.doc))

// ---- 用例 11：普通 code_block（非 mermaid）不受拦截，保持 join 原行为 ----
var MD_CODE = "```\nplain\n```\n\nafter"
var s12 = buildState(MD_CODE, function (doc) { return posIn(doc, 1, 0) })
var r12 = applyCmd(deletePreviewRawBlockOnBackspace, s12)
assert("plain code block not handled", r12.handled === false, childSummary(s12.doc))

// ---- 用例 9：NodeSelection 选中公式块后默认 deleteSelection 可删除（baseKeymap 行为兜底）----
var doc10 = parseMarkdown(schema, parser, MD_MATH_TAIL)
var sel10 = NodeSelection.create(doc10, 0)
assert("math raw block is node-selectable", sel10.node.type.name === "raw_block")
var st10 = EditorState.create({ doc: doc10, selection: sel10 })
var tr10 = st10.tr.deleteSelection()
assert("node selection delete removes block", tr10.doc.childCount === 1 && tr10.doc.child(0).type.name === "paragraph")

if (failures > 0) {
  console.log(failures + " failure(s)")
  process.exit(1)
} else {
  console.log("ALL PASS")
}