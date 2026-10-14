// 源码模式与 TOC 联动验证（jsdom + 真实 MDWriter.init）：
// 1. TOC 可见时进入源码模式 → TOC 强制关闭（按钮本已 disabled，视觉也须一致）
// 2. 退出源码模式 → 恢复进入前可见的 TOC
// 3. TOC 本来隐藏时进/出源码模式 → 不得强行开启
// 4. 状态落盘：进入源码模式后 showToc:false 且 sourceMode:true（异步完成后的补存）
// 5. 刷新恢复 sourceMode:true（且存储 showToc:true）→ 源码态下 TOC 不显示
// 运行：npx --yes tsx --import ./test/css-shim.mjs test/verify-source-mode-toc.ts
// （先 npm install --no-save jsdom@22；跑完可 npm prune 移除）

// @ts-ignore -- jsdom 为临时依赖（--no-save），无类型声明
import { JSDOM } from "jsdom"

// ---- jsdom 全局注入（同 verify-storage.ts 的清单）----
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
;(globalThis as any).requestAnimationFrame = win.requestAnimationFrame.bind(win)
;(globalThis as any).cancelAnimationFrame = win.cancelAnimationFrame.bind(win)
;(globalThis as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
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
;(globalThis as any).APP_ENV = "dev"

// 模块导入须在全局注入之后
var { STORAGE_STATE_KEY, writeStoredContent } = await import("../src/storage")
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

// ---- 1-3. 进/出源码模式的 TOC 联动 ----
ls.clear()
writeStoredContent("localStorage", "# 源码 TOC 联动")
var editor = init({
  mount: "#editor",
  storage: "localStorage"
})
var tocRoot = mount.querySelector(".md-editor-toc") as HTMLElement | null
check("0.1 toc 容器存在（auto-created）", tocRoot !== null, true)
check("0.2 初始 toc 隐藏", tocRoot ? isHidden(tocRoot) : null, true)
clickViewButton(mount, "toggle_toc")
check("0.3 打开 toc 后可见", tocRoot ? isHidden(tocRoot) : null, false)

// 进入源码模式（enterSourceMode 异步：CM 懒加载链）
clickViewButton(mount, "toggle_source")
await sleep(150)
var sourceHost = mount.querySelector(".md-editor-source-host") as HTMLElement
check("1.1 进入源码模式：源码宿主可见", isHidden(sourceHost), false)
check("1.2 进入源码模式：TOC 强制关闭", tocRoot ? isHidden(tocRoot) : null, true)
check("1.3 进入后状态落盘 showToc:false", JSON.parse(ls.getItem(STORAGE_STATE_KEY) || "null").showToc, false)
check("1.4 进入后状态落盘 sourceMode:true", JSON.parse(ls.getItem(STORAGE_STATE_KEY) || "null").sourceMode, true)

// 退出源码模式
clickViewButton(mount, "toggle_source")
check("2.1 退出源码模式：源码宿主隐藏", isHidden(sourceHost), true)
check("2.2 退出源码模式：TOC 恢复可见", tocRoot ? isHidden(tocRoot) : null, false)
check("2.3 退出后状态落盘 showToc:true", JSON.parse(ls.getItem(STORAGE_STATE_KEY) || "null").showToc, true)
check("2.4 退出后状态落盘 sourceMode:false", JSON.parse(ls.getItem(STORAGE_STATE_KEY) || "null").sourceMode, false)
editor.destroy()

// ---- 3. TOC 本来隐藏：进出源码不得强行开启 ----
ls.clear()
writeStoredContent("localStorage", "# toc 本来隐藏")
var editor3 = init({
  mount: "#editor",
  storage: "localStorage"
})
var tocRoot3 = mount.querySelector(".md-editor-toc") as HTMLElement | null
clickViewButton(mount, "toggle_source")
await sleep(150)
check("3.1 隐藏态进入源码：TOC 仍隐藏", tocRoot3 ? isHidden(tocRoot3) : null, true)
clickViewButton(mount, "toggle_source")
check("3.2 隐藏态退出源码：TOC 仍隐藏（不强行开启）", tocRoot3 ? isHidden(tocRoot3) : null, true)
editor3.destroy()

// ---- 4. 刷新恢复 sourceMode=true（存储 showToc:true 的遗留态）----
ls.clear()
writeStoredContent("localStorage", "# 恢复源码态")
ls.setItem(STORAGE_STATE_KEY, JSON.stringify({sourceMode: true, showToc: true, showRhythmGrid: false}))
var editor4 = init({
  mount: "#editor",
  storage: "localStorage"
})
await sleep(150)
var sourceHost4 = mount.querySelector(".md-editor-source-host") as HTMLElement
var tocRoot4 = mount.querySelector(".md-editor-toc") as HTMLElement | null
check("4.1 sourceMode=true 恢复：源码宿主可见", isHidden(sourceHost4), false)
check("4.2 恢复源码态下 TOC 不显示", tocRoot4 ? isHidden(tocRoot4) : null, true)
check("4.3 恢复后状态落盘 showToc:false", JSON.parse(ls.getItem(STORAGE_STATE_KEY) || "null").showToc, false)
editor4.destroy()

console.log(failures === 0 ? "\nAll source-mode TOC checks passed." : "\n" + failures + " check(s) failed.")
process.exit(failures === 0 ? 0 : 1)