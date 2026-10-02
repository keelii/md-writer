// mermaid 渲染失败临时元素泄漏验证（jsdom + 真实 EditorView + 真实 mermaid v11）：
// 复刻用户场景——mermaid 语法错误渲染失败后删除整篇文档，document.body 中不应
// 残留 mermaid.render 的临时元素（<div id="d<previewID>"> 内含 error SVG）。
//
// 背景（static/mermaid/mermaid.tiny.js v11.15.0）：render() 失败路径是
// `if (error) throw error`，先于成功路径才执行的 removeTempElements() 清理——
// 解析失败时挂在 document.body 的临时 div 必然残留。修复：失败 catch 与
// NodeView destroy 主动清扫（assets.ts removeMermaidRenderArtifacts）。
//
// 验证点：
// 1. 单元：removeMermaidRenderArtifacts 按 id 约定移除 #<id> / #d<id> / #i<id>
// 2. 端到端：语法错误渲染失败 → diagram 进入 error 态，body 无残留临时元素
// 3. 删除整篇（替换 doc 为空段落）→ NodeView destroy 后仍无残留、shell 移除
//
// 运行：npx --yes tsx --import ./test/css-shim.mjs test/verify-mermaid-artifacts.ts
// （需 npm install --no-save jsdom；真实 mermaid 从 static/mermaid/mermaid.tiny.js
//   以 win.eval 注入，同时预插 <script src> 占位标签令 loadScript 去重即时 resolve）
import * as fs from "node:fs"
import * as path from "node:path"

// @ts-ignore -- jsdom 为临时依赖（--no-save），无类型声明
import { JSDOM } from "jsdom"

var dom = new JSDOM("<!DOCTYPE html><html><body><div id=\"editor\"></div></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
  runScripts: "dangerously"
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

// 真实 mermaid / svg-pan-zoom 注入 jsdom window（外部资源默认不加载）。
// 注意不能用 win.eval：bundle 顶层是 "use strict" + var __esbuild_esm_mermaid_nm，
// strict eval 里 var 不落到 globalThis，而 bundle 尾部读 globalThis.__esbuild_esm_mermaid_nm
// 会得 undefined；改用 <script> 元素注入，jsdom 按 classic script 语义执行，
// var 挂到 window 全局，与浏览器 <script src> 行为一致。
// 同时预插 script[src] 占位——utils.loadScript 按 document.querySelectorAll("script[src]")
// 去重即时 resolve，无需真实网络。
var projectRoot = path.resolve(path.dirname(process.argv[1] || "."), "..")
function injectInlineScript(source: string) {
  var el = win.document.createElement("script")
  el.textContent = source
  win.document.head.appendChild(el)
}
injectInlineScript(fs.readFileSync(path.join(projectRoot, "static/mermaid/mermaid.tiny.js"), "utf8"))
injectInlineScript(fs.readFileSync(path.join(projectRoot, "static/svg-pan-zoom/svg-pan-zoom.min.js"), "utf8"))
;["./static/mermaid/mermaid.tiny.js", "./static/svg-pan-zoom/svg-pan-zoom.min.js"].forEach(function (src) {
  var placeholder = win.document.createElement("script")
  placeholder.setAttribute("src", src)
  win.document.head.appendChild(placeholder)
})

// 模块导入须在全局注入之后（NodeView 工厂在模块级引用 document/Node 等）
var { EditorState } = await import("prosemirror-state")
var { EditorView } = await import("prosemirror-view")
var { buildSchema } = await import("../src/prosemirror/schema")
var { buildMarkdownParser, parseMarkdown } = await import("../src/prosemirror/markdown")
var { createMermaidNodeView } = await import("../src/prosemirror/nodeviews/widgets/mermaid")
var { removeMermaidRenderArtifacts } = await import("../src/prosemirror/nodeviews/assets")

var failures = 0

function check(label: string, actual: any, expected: any) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures += 1
  }
  console.log((ok ? "PASS" : "FAIL") + " " + label + (ok ? "" : " -> expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)))
}

function waitUntil(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  return new Promise(function (resolve, reject) {
    var startedAt = Date.now()
    function tick() {
      if (condition()) {
        resolve()
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("timeout waiting for: " + label))
        return
      }
      setTimeout(tick, 20)
    }
    tick()
  })
}

// body 中 mermaid 临时元素（三种 id 形态）与编辑器内残留计数
function bodyArtifactCount(): number {
  return win.document.querySelectorAll(
    '[id^="md-editor-mermaid-preview-"], [id^="dmd-editor-mermaid-preview-"], [id^="imd-editor-mermaid-preview-"]'
  ).length
}

// ---------- 1. 单元：removeMermaidRenderArtifacts ----------
// rid 需与 bodyArtifactCount 的 id 前缀约定匹配（md-editor-mermaid-preview- 前缀）
var rid = "md-editor-mermaid-preview-unit-test"
var leakedDiv = win.document.createElement("div")
leakedDiv.id = "d" + rid
var leakedSvg = win.document.createElement("svg")
leakedSvg.id = rid
leakedDiv.appendChild(leakedSvg)
win.document.body.appendChild(leakedDiv)
var leakedIframe = win.document.createElement("iframe")
leakedIframe.id = "i" + rid
win.document.body.appendChild(leakedIframe)
check("artifacts planted in body", bodyArtifactCount() >= 2, true)
removeMermaidRenderArtifacts(rid)
check("removeMermaidRenderArtifacts removes #<id>/#d<id>/#i<id> leftovers", bodyArtifactCount(), 0)
// 再调一次（幂等，不抛错）
removeMermaidRenderArtifacts(rid)
check("removeMermaidRenderArtifacts idempotent", bodyArtifactCount(), 0)

// ---------- 2. 端到端：语法错误渲染失败，无临时元素残留 ----------
var schema = buildSchema()
var parser = buildMarkdownParser(schema)
// "flowchart TD\nA -->" 缺失连线终点，mermaid v11 必然解析失败
var doc = parseMarkdown(schema, parser, "```mermaid\nflowchart TD\nA -->\n```\n\ntail")
if (!doc) {
  throw new Error("parse failed")
}
var editorState = EditorState.create({ schema: schema, doc: doc })
var view: any = null
view = new EditorView(win.document.getElementById("editor") as HTMLElement, {
  state: editorState,
  nodeViews: {
    code_block: function (node: any, editorView: any, getPos: () => number) {
      return createMermaidNodeView(node, { opts: {} as any, view: editorView, getPos: getPos })
    }
  } as any
})

var diagram = win.document.querySelector(".md-editor-preview-diagram") as HTMLElement | null
check("mermaid nodeview shell mounted", !!diagram, true)

// 失败路径：mermaid.render reject → catch 清扫临时元素 + diagram 进 error 态
await waitUntil(function () {
  return !!diagram && diagram.className.indexOf("md-editor-preview-error") >= 0
}, 5000, "mermaid render failure settles into error state")
check("render failure settles into error state", !!diagram && diagram.className.indexOf("md-editor-preview-error") >= 0, true)
check("error message shown in diagram", !!diagram && diagram.textContent.indexOf("Parse error") >= 0, true)
check("no mermaid temp artifacts leak in document.body", bodyArtifactCount(), 0)

// ---------- 3. 删除整篇：NodeView destroy 后仍无残留 ----------
var paragraphType = schema.nodes.paragraph
view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, paragraphType.create()))
await waitUntil(function () {
  return win.document.querySelector(".md-editor-preview-shell") === null
}, 2000, "mermaid shell removed after deleting whole doc")
check("mermaid shell removed after deleting whole doc", win.document.querySelector(".md-editor-preview-shell"), null)
check("still no mermaid temp artifacts after nodeview destroy", bodyArtifactCount(), 0)

view.destroy()

if (failures > 0) {
  console.log("FAILED: " + failures)
  process.exit(1)
}
console.log("ALL MERMAID ARTIFACT TESTS PASSED")