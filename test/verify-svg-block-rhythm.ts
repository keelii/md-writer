// 块级 SVG（raw_block kind=svg）垂直韵律验证（jsdom + 真实 EditorView + 真实 NodeView）：
// svg 块的 render() 在 NodeView 创建期同步执行，此时 DOM 尚未挂载（offsetHeight 恒 0），
// 直接 snapMinHeightToRhythm 会静默跳过（min-height 从未设置，块高不按 28px 倍数对齐）。
// 修复：未挂载时 rAF 延迟取整。验证点：
// 1. 创建期同步不做取整（minHeight 为空）
// 2. 挂载后下一帧 min-height 取整到韵律行高（28px）整数倍
// 3. update 重渲染（已挂载）同步取整
// 4. 删除整篇后 NodeView destroy 不抛错
//
// 运行：npx --yes tsx --import ./test/css-shim.mjs test/verify-svg-block-rhythm.ts
// （需 npm install --no-save jsdom；jsdom 无布局，offsetHeight 用实例级 mock 注入）
// @ts-ignore -- jsdom 为临时依赖（--no-save），无类型声明
import { JSDOM } from "jsdom"

var dom = new JSDOM("<!DOCTYPE html><html><body><div id=\"editor\"></div></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/"
})
var win = dom.window
;(globalThis as any).window = win
;(globalThis as any).document = win.document
;(globalThis as any).MutationObserver = win.MutationObserver
;(globalThis as any).DOMParser = win.DOMParser
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

// 模块导入须在全局注入之后（NodeView 工厂在模块级引用 document/Node 等）
var { EditorState } = await import("prosemirror-state")
var { EditorView } = await import("prosemirror-view")
var { buildSchema } = await import("../src/prosemirror/schema")
var { buildMarkdownParser, parseMarkdown } = await import("../src/prosemirror/markdown")
var { createSvgBlockNodeView } = await import("../src/prosemirror/nodeviews/widgets/svg-block")

var failures = 0
function check(label: string, actual: any, expected: any) {
  var ok = actual === expected
  if (!ok) {
    failures += 1
  }
  console.log((ok ? "PASS" : "FAIL") + ": " + label + (ok ? "" : "  [" + JSON.stringify(actual) + " != " + JSON.stringify(expected) + "]"))
}

// 实例级 offsetHeight mock：jsdom 无布局，注入自然高度供 snapMinHeightToRhythm 测量
function mockOffsetHeight(el: HTMLElement, height: number) {
  Object.defineProperty(el, "offsetHeight", { configurable: true, get: function () { return height } })
}

var SVG1 = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>'
var SVG2 = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="10" height="10"/></svg>'

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var doc = parseMarkdown(schema, parser, SVG1 + "\n\ntail")
var view: any = new EditorView(win.document.getElementById("editor") as HTMLElement, {
  state: EditorState.create({ schema: schema, doc: doc }),
  nodeViews: {
    raw_block: function (node: any, editorView: any, getPos: () => number) {
      return createSvgBlockNodeView(node, { opts: {} as any, view: editorView, getPos: getPos })
    }
  } as any
})

var diagram = win.document.querySelector(".md-editor-preview-diagram") as HTMLElement | null
check("svg block nodeview mounted", !!diagram, true)
if (!diagram) {
  console.log("FAILED: no svg block diagram mounted")
  process.exit(1)
}

// 1. 创建期（未挂载阶段发起的同步 render）不取整
check("no rhythm snap at creation time", diagram.style.minHeight, "")

// 2. 挂载后 mock 自然高度 100 → 下一帧取整到 112（28×4）
mockOffsetHeight(diagram, 100)
await new Promise(function (resolve) {
  setTimeout(resolve, 60)
})
check("min-height snapped to rhythm after mount", diagram.style.minHeight, "112px")

// 3. update 重渲染（已挂载）同步取整：mock 高度改为 60 → 84（28×3）
mockOffsetHeight(diagram, 60)
var blockSize = (view.state.doc.firstChild as any).nodeSize
view.dispatch(view.state.tr.replaceWith(0, blockSize, schema.nodes.raw_block.create(null, schema.text(SVG2))))
check("min-height re-snapped synchronously on update", diagram.style.minHeight, "84px")
check("svg content re-rendered on update", !!diagram.querySelector("rect"), true)

// 4. 删除整篇 → NodeView destroy 不抛错
view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, schema.nodes.paragraph.create()))
check("shell removed after deleting whole doc", !!win.document.querySelector(".md-editor-preview-shell"), false)

view.destroy()

if (failures > 0) {
  console.log("FAILED: " + failures + " case(s)")
  process.exit(1)
}
console.log("ALL SVG BLOCK RHYTHM TESTS PASSED")