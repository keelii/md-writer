// 持久存储层（localStorage）端到端验证（jsdom + 真实 MDWriter.init）：
// 1. storage.ts 单元层：内容读写往返（空串是合法值）、状态 JSON 损坏静默降级
// 2. 恢复优先级：存储内容优先于 initialMarkdown；无存储时 initialMarkdown 兜底
// 3. 视图状态恢复：sourceMode / showToc / showRhythmGrid 均从存储读出生效
// 4. 内容写入：编辑（setMarkdown）后 300ms debounce 落盘；destroy() 强制 flush 立即落盘
// 5. 状态写入：点工具栏 toggle_toc / toggle_rhythm 按钮后状态写回 localStorage
// 6. 未启用 storage：不读不写（localStorage 保持为空）
// 运行：npx --yes tsx --import ./test/css-shim.mjs test/verify-storage.ts
// （先 npm install --no-save jsdom；跑完可 npm prune 移除）

// @ts-ignore -- jsdom 为临时依赖（--no-save），无类型声明
import { JSDOM } from "jsdom"

// ---- jsdom 全局注入（同 verify-table-handles.ts 的 PM polyfill 清单）----
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
;(globalThis as any).Window = win.Window
;(globalThis as any).getSelection = win.getSelection.bind(win)
Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true })
;(globalThis as any).getComputedStyle = win.getComputedStyle.bind(win)
// CodeMirror 6 需要 rAF（pretendToBeVisual 提供，但 Node 全局没有）
;(globalThis as any).requestAnimationFrame = win.requestAnimationFrame.bind(win)
;(globalThis as any).cancelAnimationFrame = win.cancelAnimationFrame.bind(win)
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

// 模块导入须在全局注入之后（NodeView / CM 在模块级引用 document 等）
var { STORAGE_CONTENT_KEY, STORAGE_STATE_KEY, readStoredContent, writeStoredContent, readStoredState } = await import("../src/storage")
var { init } = await import("../src/index")

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

function sleep(ms: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

function clickViewButton(mount: Element, code: string) {
  var btn = mount.querySelector("[data-md-editor-view=\"" + code + "\"]")
  if (!btn) {
    throw new Error("view button not found: " + code)
  }
  btn.dispatchEvent(new win.MouseEvent("click", {bubbles: true, cancelable: true}))
}

function isHidden(el: Element) {
  return (el as HTMLElement).hidden || (el as HTMLElement).style.display === "none"
}

var ls = win.localStorage
var mount = win.document.getElementById("editor")!

// ---- 1. storage.ts 单元层 ----
check("1.1 无存储时 readStoredContent 返回 null", readStoredContent("localStorage"), null)
writeStoredContent("localStorage", "# stored\n")
check("1.2 写入后可读回", readStoredContent("localStorage"), "# stored\n")
writeStoredContent("localStorage", "")
check("1.3 空串是合法存储值（非 null）", readStoredContent("localStorage"), "")
check("1.4 无状态时 readStoredState 返回 null", readStoredState("localStorage"), null)
ls.setItem(STORAGE_STATE_KEY, "{broken json")
check("1.5 JSON 损坏静默降级为 null", readStoredState("localStorage"), null)
ls.setItem(STORAGE_STATE_KEY, JSON.stringify({sourceMode: false, showToc: true, showRhythmGrid: true}))
check("1.6 合法状态 JSON 可读回", readStoredState("localStorage"), {sourceMode: false, showToc: true, showRhythmGrid: true})

// ---- 2. 恢复优先级：存储内容 > initialMarkdown ----
ls.clear()
writeStoredContent("localStorage", "# 来自存储的内容")
var editor2 = init({
  mount: "#editor",
  storage: "localStorage",
  initialMarkdown: "# 来自参数的内容"
})
check("2.1 存储内容优先于 initialMarkdown", editor2.getMarkdown(), "# 来自存储的内容")
editor2.destroy()

// ---- 3. 视图状态恢复（showToc / showRhythmGrid）----
ls.setItem(STORAGE_STATE_KEY, JSON.stringify({sourceMode: false, showToc: true, showRhythmGrid: true}))
ls.removeItem(STORAGE_CONTENT_KEY)
var editor3 = init({
  mount: "#editor",
  storage: "localStorage",
  initialMarkdown: "# 状态恢复"
})
var tocRoot3 = mount.querySelector(".md-editor-toc") as HTMLElement | null
check("3.1 toc 容器存在（auto-created）", tocRoot3 !== null, true)
if (tocRoot3) {
  check("3.2 showToc=true 恢复：toc 可见", isHidden(tocRoot3), false)
}
check("3.3 showRhythmGrid=true 恢复：body 带 rhythm-grid 类", win.document.body.classList.contains("rhythm-grid"), true)
check("3.4 无存储内容时 initialMarkdown 兜底", editor3.getMarkdown(), "# 状态恢复")
editor3.destroy()
check("3.5 destroy 后移除 body rhythm-grid 类", win.document.body.classList.contains("rhythm-grid"), false)

// ---- 4. 状态写入：toggle 按钮触发持久化 ----
ls.clear()
var editor4 = init({
  mount: "#editor",
  storage: "localStorage",
  initialMarkdown: "# 状态写入"
})
clickViewButton(mount, "toggle_toc")
check("4.1 toggle_toc 后状态写回", JSON.parse(ls.getItem(STORAGE_STATE_KEY) || "null"), {sourceMode: false, showToc: true, showRhythmGrid: false})
clickViewButton(mount, "toggle_rhythm")
check("4.2 toggle_rhythm 后状态写回", JSON.parse(ls.getItem(STORAGE_STATE_KEY) || "null"), {sourceMode: false, showToc: true, showRhythmGrid: true})
editor4.destroy()

// ---- 5. 内容写入：debounce 落盘 + destroy flush ----
ls.clear()
var editor5 = init({
  mount: "#editor",
  storage: "localStorage",
  initialMarkdown: "# 初始"
})
// init 时 sync() 已 schedule：debounce 窗口内不应落盘
check("5.1 debounce 窗口内未落盘", ls.getItem(STORAGE_CONTENT_KEY), null)
editor5.setMarkdown("# 编辑后")
// 仍在 300ms 窗口内（setMarkdown → applyMarkdownToEditor → sync → 重新 schedule）
check("5.2 编辑后 debounce 窗口内仍未落盘", ls.getItem(STORAGE_CONTENT_KEY), null)
await sleep(400)
check("5.3 debounce 到期后落盘", ls.getItem(STORAGE_CONTENT_KEY), "# 编辑后")
editor5.setMarkdown("# 关闭前最后一次编辑")
check("5.4 destroy 前未落盘", ls.getItem(STORAGE_CONTENT_KEY), "# 编辑后")
editor5.destroy()
check("5.5 destroy 强制 flush", ls.getItem(STORAGE_CONTENT_KEY), "# 关闭前最后一次编辑")

// ---- 6. 未启用 storage：不读不写 ----
ls.clear()
writeStoredContent("localStorage", "# 旧内容")
ls.setItem(STORAGE_STATE_KEY, JSON.stringify({sourceMode: false, showToc: true, showRhythmGrid: true}))
var editor6 = init({
  mount: "#editor",
  initialMarkdown: "# 未启用存储"
})
check("6.1 未启用 storage 时忽略存储内容（用 initialMarkdown）", editor6.getMarkdown(), "# 未启用存储")
check("6.2 未启用 storage 时视图状态用默认（toc 隐藏）", win.document.body.classList.contains("rhythm-grid"), false)
editor6.setMarkdown("# 修改")
editor6.destroy()
check("6.3 未启用 storage 时不写内容", ls.getItem(STORAGE_CONTENT_KEY), "# 旧内容")
check("6.4 未启用 storage 时不写状态", ls.getItem(STORAGE_STATE_KEY), JSON.stringify({sourceMode: false, showToc: true, showRhythmGrid: true}))

// ---- 7. 源码态恢复（sourceMode=true，CodeMirror 懒加载完成后进入）----
ls.clear()
writeStoredContent("localStorage", "# 源码态内容")
ls.setItem(STORAGE_STATE_KEY, JSON.stringify({sourceMode: true, showToc: false, showRhythmGrid: false}))
var editor7 = init({
  mount: "#editor",
  storage: "localStorage"
})
// enterSourceMode 为异步（CM 懒加载链），等待微任务 + 一帧
await sleep(100)
var sourceHost7 = mount.querySelector(".md-editor-source-host") as HTMLElement
check("7.1 sourceMode=true 恢复：源码宿主可见", isHidden(sourceHost7), false)
check("7.2 源码态内容来自存储", editor7.getMarkdown(), "# 源码态内容")
editor7.destroy()

console.log(failures === 0 ? "\nAll storage checks passed." : "\n" + failures + " check(s) failed.")
process.exit(failures === 0 ? 0 : 1)