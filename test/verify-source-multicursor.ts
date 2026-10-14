// 源码模式 Cmd+D 多光标（selectNextOccurrence）端到端验证（jsdom + 真实 CodeMirror）：
// 1. keymap 绑定生效：光标在词内 Cmd+D → 选中当前词；再按 → 追加下一个相同词
// 2. 多光标编辑：两处选区同时插入文本，adapter.getValue 同步
// 3. highlightSelectionMatches 装饰生效（.cm-selectionMatch 出现）
// 运行：npx --yes tsx --import ./test/css-shim.mjs test/verify-source-multicursor.ts
// （先 npm install --no-save jsdom；跑完可 npm prune 移除）

// @ts-ignore -- jsdom 为临时依赖（--no-save），无类型声明
import { JSDOM } from "jsdom"

// ---- jsdom 全局注入（同 verify-storage.ts 的清单）----
var dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
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
;(globalThis as any).Window = win.Window
;(globalThis as any).getSelection = win.getSelection.bind(win)
Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true })
Object.defineProperty((win as any).navigator, "platform", { value: "MacIntel", configurable: true })
;(globalThis as any).getComputedStyle = win.getComputedStyle.bind(win)
;(globalThis as any).requestAnimationFrame = win.requestAnimationFrame.bind(win)
;(globalThis as any).cancelAnimationFrame = win.cancelAnimationFrame.bind(win)
;(globalThis as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(win.HTMLElement.prototype as any).scrollIntoView = function () {}

// CodeMirror 在模块加载时读 navigator.platform 判定 Mod→Meta（mac）
// 故平台探测须在导入 @codemirror/view 之前完成，注入须先于一切模块导入
var { EditorView } = await import("@codemirror/view")
var { EditorSelection } = await import("@codemirror/state")

// ---- 捕获真实 EditorView 实例：原型 focus 打桩，不侵入生产代码 ----
var captured: any[] = []
var origFocus = (EditorView.prototype as any).focus
;(EditorView.prototype as any).focus = function () {
  captured.push(this)
  return origFocus.call(this)
}

var { createCodeMirrorSourceEditor } = await import("../src/codemirror/source-editor")

var failures = 0

function check(label: string, actual: any, expected: any) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures++
    console.error("FAIL " + label + "  expected=" + JSON.stringify(expected) + "  actual=" + JSON.stringify(actual))
  } else {
    console.log("ok   " + label)
  }
}

function rangesOf(view: any): number[] {
  var out: number[] = []
  var ranges = view.state.selection.ranges
  for (var i = 0; i < ranges.length; i++) {
    out.push(ranges[i].from, ranges[i].to)
  }
  return out
}

function pressCmdD(view: any) {
  view.contentDOM.dispatchEvent(
    new win.KeyboardEvent("keydown", {
      key: "d",
      code: "KeyD",
      metaKey: true,
      bubbles: true,
      cancelable: true
    })
  )
}

// ---- 场景：foo bar foo baz，Cmd+D 追加选中两个 foo ----
var container = win.document.createElement("div")
win.document.body.appendChild(container)
var latestValue = ""
var adapter = createCodeMirrorSourceEditor(container, "foo bar foo baz", function (v: string) {
  latestValue = v
})
adapter.focus()
;(EditorView.prototype as any).focus = origFocus
var view = captured[0]
if (!view) {
  console.error("FAIL 未捕获到 EditorView 实例")
  process.exit(1)
}

// 1) 光标置于第一个 foo 中间（无选区），Cmd+D 选中当前词
view.dispatch({ selection: EditorSelection.cursor(2) })
pressCmdD(view)
check("1.1 Cmd+D（无选区）选中当前词", rangesOf(view), [0, 3])

// 3) highlightSelectionMatches 装饰：选中词在别处有相同词时被高亮
//    （多选区时上游按设计返回 Decoration.none，故必须在单选区状态下检查）
var matchEls = container.querySelectorAll(".cm-selectionMatch")
check("3.1 selectionMatch 装饰存在", matchEls.length > 0, true)

// 2) 再按 Cmd+D 追加下一个相同词
pressCmdD(view)
check("2.1 第二次 Cmd+D 后共 2 个选区", view.state.selection.ranges.length, 2)
check("2.2 选区覆盖两个 foo", rangesOf(view), [0, 3, 8, 11])

// 3) highlightSelectionMatches 在多选区时按设计不产生装饰（上游 index.js:422
//    sel.ranges.length > 1 → Decoration.none），故装饰检查移至 1.1 单选区之后

// 4) 多光标同时输入：replaceSelection 是 CM 输入管线多光标插入的等价路径
view.dispatch(view.state.replaceSelection("X") as any)
check("4.1 两处选区同时替换", adapter.getValue(), "X bar X baz")
check("4.2 onChange 收到编辑后内容", latestValue, "X bar X baz")

// 5) 只有 2 个 foo：第三次 Cmd+D 不再新增选区
pressCmdD(view)
check("5.1 无第三个相同词时选区数不再增加", view.state.selection.ranges.length, 2)

// 6) 多行文档：跨行追加相同词（"alpha\nbeta\nalpha" 第二个 alpha 位于 11-16）
view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "alpha\nbeta\nalpha" } })
view.dispatch({ selection: EditorSelection.range(0, 5) })
pressCmdD(view)
check("6.1 跨行追加相同词", rangesOf(view), [0, 5, 11, 16])

adapter.destroy()

console.log(failures === 0 ? "\nAll source multicursor checks passed." : "\n" + failures + " check(s) failed.")
process.exit(failures === 0 ? 0 : 1)