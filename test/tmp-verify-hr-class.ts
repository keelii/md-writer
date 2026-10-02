// 临时验证：hr 包壳 div 带 md-editor-horizontal-rule 类；NodeSelection 时
// 选中类与包壳类共存；markdown "---" 解析/序列化往返不回退
// 运行：npx --yes tsx --import ./test/css-shim.mjs test/tmp-verify-hr-class.ts
// @ts-ignore -- jsdom 为临时依赖（--no-save），无类型声明
import { JSDOM } from "jsdom"
import { EditorState, NodeSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"

var dom = new JSDOM("<!DOCTYPE html><html><body><div id=\"editor\"></div></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/"
})
var win = dom.window
;(globalThis as any).window = win
;(globalThis as any).document = win.document
;(globalThis as any).MutationObserver = win.MutationObserver
;(globalThis as any).Node = win.Node
;(globalThis as any).Element = win.Element
;(globalThis as any).HTMLElement = win.HTMLElement
;(globalThis as any).Range = win.Range
;(globalThis as any).getSelection = win.getSelection.bind(win)
Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true })
;(globalThis as any).getComputedStyle = win.getComputedStyle.bind(win)
;(win.HTMLElement.prototype as any).scrollIntoView = function () {}
;(win as any).Element.prototype.getClientRects = function () {
  return [this.getBoundingClientRect()]
}
;(win as any).Range.prototype.getClientRects = function () {
  return []
}
;(win as any).Range.prototype.getBoundingClientRect = function () {
  return {top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0}
}

var { buildSchema } = await import("../src/prosemirror/schema")
var { buildMarkdownParser, parseMarkdown, buildMarkdownSerializer } = await import("../src/prosemirror/markdown")
var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

var check = function (name: string, actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error("FAIL: " + name + " 实际=" + JSON.stringify(actual) + " 期望=" + JSON.stringify(expected))
  }
  console.log("PASS: " + name)
}

// 1. "---" 往返（解析 → 序列化）
var md = "段落一\n\n---\n\n段落二"
var roundtrip = serializer.serialize(parseMarkdown(schema, parser, md))
check("--- roundtrip", roundtrip.replace(/\n+$/, ""), md)

// 2. 编辑器 DOM：包壳 div 带 md-editor-horizontal-rule 类，内含 hr
var doc = parseMarkdown(schema, parser, md)
var hrPos = -1
doc.forEach(function (child: any, offset: number) {
  if (child.type === schema.nodes.horizontal_rule) {
    hrPos = offset
  }
})
check("hr 节点存在", hrPos >= 0, true)

var state = EditorState.create({ doc: doc, schema: schema })
var view = new EditorView(win.document.getElementById("editor"), {
  state: state,
  attributes: { class: "theme-default" }
})

var wrapper = win.document.querySelector(".md-editor-horizontal-rule")
check("包壳 div 存在且带类", wrapper !== null, true)
check("包壳是 div", wrapper!.tagName, "DIV")
check("包壳内是 hr", (wrapper!.firstElementChild as any).tagName, "HR")
check("hr 只有包壳一层父", (wrapper!.parentElement as any).classList.contains("ProseMirror"), true)

// 3. NodeSelection 选中 hr：包壳同时带两个类
var sel = NodeSelection.create(view.state.doc, hrPos)
view.dispatch(view.state.tr.setSelection(sel))
view.updateState(view.state)
var wrapperClass = wrapper!.getAttribute("class") || ""
check("选中后包壳含 selectednode", wrapperClass.indexOf("ProseMirror-selectednode") !== -1, true)
check("选中后包壳仍含 horizontal-rule 类", wrapperClass.indexOf("md-editor-horizontal-rule") !== -1, true)

// 4. 移出选中：包壳类回落为仅 md-editor-horizontal-rule
var { TextSelection } = await import("prosemirror-state")
view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 0)))
view.updateState(view.state)
var wrapperClass2 = wrapper!.getAttribute("class") || ""
check("取消选中后仅剩包壳类", wrapperClass2.trim(), "md-editor-horizontal-rule")