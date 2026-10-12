// 拖入 md 文件保存状态功能验证（脏状态 + 源文件句柄写回）：
// 1. save-file.ts setTarget 单元层：注入句柄后 save 直接覆盖写不弹 picker；
//    handle.name 缺失回退传入名；setTarget(null) 等价 reset；句柄写失效重走另存为
// 2. 拖放插件回调层（createMarkdownFileDropPlugin 第三参 options）：
//    onFileWillOpen 在 dispatch 前、onFileTarget 在文档替换完成后（时序）；
//    单 md 文件 + Chromium getAsFileSystemHandle 提取句柄；目录句柄 / 提取失败 /
//    多文件 / 无 items API 不上报句柄；读取失败不触发任何回调
// 3. index.tsx 端到端（jsdom + 真实 MDWriter.init）：
//    title 脏标记（* 前缀）：init 干净 → 编辑变脏 → Meta+S saved/downloaded 清除、
//    cancelled/failed 保持；拖入文件重建干净基线；之后 Meta+S 直接写回源文件不弹窗；
//    焦点不在编辑器时 Meta+S 不保存；destroy 恢复原始 title
// 运行：npx --yes tsx --import ./test/css-shim.mjs test/verify-md-dirty-state.ts
// （先 npm install --no-save jsdom；跑完可 npm prune 移除）

// @ts-ignore -- jsdom 为临时依赖（--no-save），无类型声明
import { JSDOM, VirtualConsole } from "jsdom"

// ---- jsdom 全局注入（同 verify-storage.ts 的 PM polyfill 清单）----
var dom = new JSDOM(
  "<!DOCTYPE html><html><head><title>MD Writer 测试</title></head><body><div id=\"editor\"></div></body></html>",
  { pretendToBeVisual: true, url: "http://localhost/", virtualConsole: new VirtualConsole() }
)
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
// save-file.ts 的下载兜底用裸 URL.createObjectURL（Node 的 URL 没有该方法）：stub 并记录
var downloads: any[] = []
;(globalThis as any).URL.createObjectURL = function (blob: any) {
  downloads.push(blob)
  return "blob:fake-" + downloads.length
}
;(globalThis as any).URL.revokeObjectURL = function () {}
// ts 直跑源码时以全局变量模拟 dev 构建（esbuild --define:APP_ENV）
;(globalThis as any).APP_ENV = "dev"

// 模块导入须在全局注入之后（index.tsx 在模块级引用 document 等）
var { EditorState } = await import("prosemirror-state")
var { buildSchema } = await import("../src/prosemirror/schema")
var { buildMarkdownParser, parseMarkdown } = await import("../src/prosemirror/markdown")
var { createMarkdownFileDropPlugin } = await import("../src/prosemirror/plugins")
var { createMarkdownFileSaver } = await import("../src/save-file")
var { init } = await import("../src/index")

var failures = 0

function assert(label: string, ok: boolean, extra?: string) {
  if (ok) {
    console.log("PASS: " + label)
  } else {
    failures += 1
    console.log("FAIL: " + label + (extra ? "  [" + extra + "]" : ""))
  }
}

function sleep(ms: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

async function waitFor(cond: () => boolean, timeoutMs?: number) {
  var limit = timeoutMs || 500
  var start = Date.now()
  while (!cond()) {
    if (Date.now() - start > limit) {
      return false
    }
    await sleep(10)
  }
  return true
}

// fake FileSystemFileHandle：记录覆盖写内容与 close 次数；failNext 模拟句柄失效一次
function fakeHandle(name: string) {
  var broken = false
  var handle: any = {
    name: name,
    kind: "file",
    writes: [] as string[],
    closeCount: 0,
    failNext: function () {
      broken = true
    }
  }
  handle.createWritable = function () {
    if (broken) {
      broken = false
      return Promise.reject(new Error("handle broken"))
    }
    return Promise.resolve({
      write: function (data: string) {
        handle.writes.push(data)
        return Promise.resolve()
      },
      close: function () {
        handle.closeCount += 1
        return Promise.resolve()
      }
    })
  }
  return handle
}

// ---- 1. save-file.ts setTarget 单元层 ----
async function part1Saver() {
  console.log("--- 1. save-file setTarget 单元层 ---")
  var pickerCalls: any[] = []
  function setPicker(resolver: (options: any) => any) {
    ;(win as any).showSaveFilePicker = function (options: any) {
      pickerCalls.push(options)
      var result = resolver(options)
      return result && typeof result.then === "function" ? result : Promise.resolve(result)
    }
  }
  function clearPicker() {
    delete (win as any).showSaveFilePicker
  }

  // 1a-1c. setTarget 注入句柄：save 直接覆盖写，不弹 picker
  var handle = fakeHandle("note.md")
  var spare = fakeHandle("spare.md")
  setPicker(function () {
    return spare
  })
  var saver = createMarkdownFileSaver()
  saver.setTarget(handle)
  assert("1a setTarget 后 getTargetName 为句柄名", saver.getTargetName() === "note.md", String(saver.getTargetName()))

  var status1 = await saver.save("# 内容A\n")
  assert("1b 注入句柄后保存返回 saved", status1 === "saved", String(status1))
  assert("1c 保存直接写句柄不弹 picker", pickerCalls.length === 0, String(pickerCalls.length))
  assert("1d 内容写入句柄", handle.writes.join("|") === "# 内容A\n", handle.writes.join("|"))
  assert("1e writable 已 close", handle.closeCount === 1, String(handle.closeCount))

  var status2 = await saver.save("# 内容B\n")
  assert("1f 第二次保存仍直接写句柄", status2 === "saved" && handle.writes.length === 2 && pickerCalls.length === 0)
  assert("1g 目标名保持", saver.getTargetName() === "note.md")

  // 1h. handle 无 name 时回退传入名
  var noName: any = { kind: "file", createWritable: fakeHandle("x").createWritable }
  var saver2 = createMarkdownFileSaver()
  saver2.setTarget(noName, "回退名.md")
  assert("1h handle.name 缺失回退传入名", saver2.getTargetName() === "回退名.md", String(saver2.getTargetName()))
  await saver2.save("# x\n")

  // 1i. setTarget(null) 等价 reset：下次保存重新弹 picker
  saver2.setTarget(null)
  assert("1i setTarget(null) 清空目标名", saver2.getTargetName() === null)
  var status3 = await saver2.save("# y\n")
  assert("1j 清空后保存走 picker", status3 === "saved" && pickerCalls.length === 1 && spare.writes.length === 1)
  assert("1k picker 拿到的 handle 名生效", saver2.getTargetName() === "spare.md")

  // 1l. 注入句柄写失效：重置后重走 picker
  var brokenHandle = fakeHandle("broken.md")
  brokenHandle.failNext()
  var fresh = fakeHandle("fresh.md")
  setPicker(function () {
    return fresh
  })
  var saver3 = createMarkdownFileSaver()
  saver3.setTarget(brokenHandle)
  var status4 = await saver3.save("# z\n")
  assert("1l 句柄写失效后重走 picker 成功", status4 === "saved" && brokenHandle.writes.length === 0)
  assert("1m 恢复后目标名更新为新句柄", saver3.getTargetName() === "fresh.md" && fresh.writes.join("|") === "# z\n")

  // 1n. setTarget 后 reset 同样清空
  saver3.setTarget(handle)
  saver3.reset()
  assert("1n reset 清空注入的目标", saver3.getTargetName() === null)

  clearPicker()
}

// ---- 2. 拖放插件 options 回调层 ----
async function part2DropCallbacks() {
  console.log("--- 2. 拖放插件 options 回调 ---")
  // 同步 FileReader stub（Node 18 无全局实现；fake 文件带 __content）
  class StubFileReader {
    result: string | null = null
    error: any = null
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    readAsText(file: any) {
      if (file.__failRead) {
        this.error = new Error("read failed")
        if (this.onerror) {
          this.onerror()
        }
        return
      }
      this.result = file.__content
      if (this.onload) {
        this.onload()
      }
    }
  }
  ;(globalThis as any).FileReader = StubFileReader

  var order: string[] = []
  var plugin = createMarkdownFileDropPlugin(schema, parser, {
    onFileWillOpen: function () {
      order.push("willOpen")
    },
    onFileTarget: function (handle: any, fileName: string) {
      order.push("target:" + fileName + ":" + handle.name)
    }
  })
  var handleDrop = (plugin.props as any).handleDrop

  function recView(initialMarkdown: string) {
    var doc = parseMarkdown(schema, parser, initialMarkdown)
    var state = EditorState.create({ schema: schema, doc: doc })
    var dom: any = {
      isConnected: true,
      contains: function () {
        return false
      },
      classList: {
        add: function () {},
        remove: function () {},
        contains: function () {
          return false
        }
      }
    }
    var view: any = {
      dom: dom,
      state: state,
      dispatch: function (tr: any) {
        order.push("dispatch")
        view.state = view.state.apply(tr)
      }
    }
    return view
  }

  function mdFile(name: string, content: string, failRead?: boolean) {
    return { name: name, type: "", __content: content, __failRead: !!failRead } as any
  }

  function itemFor(file: any, handle?: any) {
    var item: any = { getAsFile: function () { return file } }
    if (handle === "none") {
      return item
    }
    if (handle === "reject") {
      item.getAsFileSystemHandle = function () {
        return Promise.reject(new Error("extract failed"))
      }
      return item
    }
    item.getAsFileSystemHandle = function () {
      return Promise.resolve(handle)
    }
    return item
  }

  function dropEvent(files: any[], items?: any[]) {
    return {
      dataTransfer: { files: files, types: ["Files"], items: items || [] },
      preventDefault: function () {}
    } as any
  }

  async function runDrop(view: any, event: any) {
    var handled = handleDrop(view, event)
    await new Promise(function (resolve) {
      setTimeout(resolve, 0)
    })
    return handled
  }

  // 2a. 单 md 文件 + file 句柄：willOpen 在 dispatch 前，target 在替换完成后
  var view = recView("原文")
  var fileHandle = { name: "note.md", kind: "file" }
  var handled = await runDrop(view, dropEvent([mdFile("note.md", "# A\n")], [itemFor(mdFile("note.md", "# A\n"), fileHandle)]))
  assert("2a 单文件+句柄：回调时序正确", order.join(",") === "willOpen,dispatch,target:note.md:note.md", order.join(","))
  assert("2b 文档被替换", handled === true && view.state.doc.textContent.indexOf("A") >= 0)

  // 2c. 目录句柄：不上报
  order = []
  view = recView("原文")
  var dirFile = mdFile("dir.md", "# B\n")
  await runDrop(view, dropEvent([dirFile], [itemFor(dirFile, { name: "dir.md", kind: "directory" })]))
  assert("2c 目录句柄不上报", order.join(",") === "willOpen,dispatch", order.join(","))

  // 2d. 句柄提取失败（promise reject）：不上报，但文档正常打开
  order = []
  view = recView("原文")
  await runDrop(view, dropEvent([mdFile("c.md", "# C\n")], [itemFor(mdFile("c.md", "# C\n"), "reject")]))
  assert("2d 提取失败不上报", order.join(",") === "willOpen,dispatch", order.join(","))

  // 2e. 多文件：不上报句柄
  order = []
  view = recView("原文")
  var f1 = mdFile("1.md", "# 一\n")
  var f2 = mdFile("2.md", "# 二\n")
  await runDrop(view, dropEvent([f1, f2], [itemFor(f1, { name: "1.md", kind: "file" }), itemFor(f2, { name: "2.md", kind: "file" })]))
  assert("2e 多文件不上报句柄", order.join(",") === "willOpen,dispatch", order.join(","))
  assert("2f 多文件合并插入", view.state.doc.textContent.indexOf("一") >= 0 && view.state.doc.textContent.indexOf("二") >= 0)

  // 2g. items 无 getAsFileSystemHandle（Safari/Firefox）：不上报
  order = []
  view = recView("原文")
  await runDrop(view, dropEvent([mdFile("s.md", "# S\n")], [itemFor(mdFile("s.md", "# S\n"), "none")]))
  assert("2g 无 items API 不上报", order.join(",") === "willOpen,dispatch", order.join(","))

  // 2h. 读取失败：不触发任何回调，文档保持原状
  order = []
  view = recView("原文")
  await runDrop(view, dropEvent([mdFile("bad.md", "# x\n", true)], [itemFor(mdFile("bad.md", "# x\n", true), { name: "bad.md", kind: "file" })]))
  assert("2h 读取失败不触发回调", order.join(",") === "", order.join(","))
  assert("2i 读取失败保持原文档", view.state.doc.textContent === "原文")

  // 2j. 空内容文件：不替换不回调
  order = []
  view = recView("原文")
  await runDrop(view, dropEvent([mdFile("empty.md", "   ")], [itemFor(mdFile("empty.md", "  "), { name: "empty.md", kind: "file" })]))
  assert("2j 空内容不替换不回调", order.join(",") === "" && view.state.doc.textContent === "原文", order.join(","))

  // 2k. 不传 options（旧用法）：行为不变
  var plainPlugin = createMarkdownFileDropPlugin(schema, parser)
  var plainView = recView("原文")
  var plainHandled = (plainPlugin.props as any).handleDrop(plainView, dropEvent([mdFile("p.md", "# P\n")]))
  await new Promise(function (resolve) {
    setTimeout(resolve, 0)
  })
  assert("2k 不传 options 仍正常插入", plainHandled === true && plainView.state.doc.textContent.indexOf("P") >= 0)

  // 恢复真实 jsdom FileReader 供第 3 部分端到端拖入用
  ;(globalThis as any).FileReader = win.FileReader
}

// ---- 3. index.tsx 端到端（jsdom + 真实 init）----
async function part3EndToEnd() {
  console.log("--- 3. index.tsx 端到端 ---")
  var baseTitle = "MD Writer 测试"
  var mount = win.document.getElementById("editor")!
  var editor = init({ mount: "#editor", initialMarkdown: "# 初始文档\n" } as any)
  var pm = mount.querySelector(".ProseMirror") as HTMLElement

  function title() {
    return win.document.title
  }
  function pressMetaS() {
    win.document.dispatchEvent(new (win as any).KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true }))
  }

  var pickerCalls: any[] = []
  function setPicker(resolver: (options: any) => any) {
    ;(win as any).showSaveFilePicker = function (options: any) {
      pickerCalls.push(options)
      var result = resolver(options)
      return result && typeof result.then === "function" ? result : Promise.resolve(result)
    }
  }
  function clearPicker() {
    delete (win as any).showSaveFilePicker
  }

  // 3a. init 后干净（首次 sync 建立基线）
  assert("3a init 后 title 干净", title() === baseTitle, title())

  // 3b/3c. 编辑变脏、改回基线变干净
  editor.setMarkdown("# 初始文档\n\n新增段落。")
  assert("3b 编辑后 title 加 * 前缀", title() === "* " + baseTitle, title())
  editor.setMarkdown("# 初始文档")
  assert("3c 内容回到基线 title 恢复干净", title() === baseTitle, title())

  // 3d. 用户取消另存为：保持脏状态
  editor.setMarkdown("# 初始文档\n\n改动一。")
  setPicker(function () {
    return Promise.reject(Object.assign(new Error("cancelled"), { name: "AbortError" }))
  })
  pm.focus()
  assert("3d-0 焦点在编辑器内", win.document.activeElement === pm)
  pressMetaS()
  assert("3d 取消另存为后保持脏", (await waitFor(function () { return false === false })) && (await sleep(20) === undefined) && title() === "* " + baseTitle, title())

  // 3e. 另存为失败：保持脏状态
  var realWarn = console.warn
  console.warn = function () {}
  setPicker(function () {
    return Promise.reject(new TypeError("boom"))
  })
  pressMetaS()
  await sleep(20)
  console.warn = realWarn
  assert("3e 保存失败后保持脏", title() === "* " + baseTitle, title())

  // 3f. 另存为成功：清除脏标，内容写入 handle
  var firstHandle = fakeHandle("first.md")
  setPicker(function () {
    return firstHandle
  })
  pressMetaS()
  assert("3f-0 保存成功后 title 恢复干净", await waitFor(function () { return title() === baseTitle }), title())
  assert("3f 保存内容写入 handle", firstHandle.writes.length === 1 && firstHandle.writes[0] === editor.getMarkdown(), JSON.stringify(firstHandle.writes))

  // 3g. 第二次保存：覆盖写缓存 handle，不再弹 picker（3d/3e/3f 已各弹过一次）
  var pickersBefore3g = pickerCalls.length
  editor.setMarkdown("# 初始文档\n\n改动二。")
  pressMetaS()
  assert(
    "3g 覆盖写不弹 picker 且清脏",
    (await waitFor(function () { return title() === baseTitle })) && pickerCalls.length === pickersBefore3g && firstHandle.writes.length === 2,
    JSON.stringify({ pickers: pickerCalls.length, before: pickersBefore3g, writes: firstHandle.writes.length })
  )

  // 3h. 句柄失效降级为下载：downloaded 也清脏标
  editor.setMarkdown("# 初始文档\n\n改动三。")
  firstHandle.failNext()
  clearPicker()
  pressMetaS()
  assert("3h-0 下载降级后 title 恢复干净", await waitFor(function () { return title() === baseTitle }), title())
  assert("3h downloaded 走下载兜底", downloads.length === 1, String(downloads.length))

  // 3i. 焦点不在编辑器：Meta+S 不保存
  editor.setMarkdown("# 初始文档\n\n改动四。")
  pm.blur()
  pressMetaS()
  await sleep(20)
  assert("3i 焦点在外不保存（保持脏）", title() === "* " + baseTitle && downloads.length === 1, title())
  pm.focus()

  // 3j. 拖入单 md 文件：重建干净基线（Chromium 句柄注入）
  var dropHandle = fakeHandle("dropped.md")
  var dropFile = new (win as any).File(["# 拖入的文档\n\n来自文件。\n"], "dropped.md", { type: "text/markdown" })
  var dropEvent: any = new (win as any).Event("drop", { bubbles: true, cancelable: true })
  dropEvent.dataTransfer = {
    files: [dropFile],
    types: ["Files"],
    items: [
      {
        getAsFile: function () {
          return dropFile
        },
        getAsFileSystemHandle: function () {
          return Promise.resolve(dropHandle)
        }
      }
    ]
  }
  win.document.dispatchEvent(dropEvent)
  assert("3j-0 拖入后 title 重建干净基线", await waitFor(function () { return title() === baseTitle }), title())
  assert("3j 拖入内容已插入", editor.getMarkdown().indexOf("来自文件") >= 0, editor.getMarkdown())

  // 3k. 拖入后 Meta+S：直接写回源文件句柄，不弹 picker
  var pickersBefore3k = pickerCalls.length
  editor.setMarkdown("# 拖入的文档\n\n来自文件。\n\n追加改动。")
  setPicker(function () {
    return fakeHandle("不应使用.md")
  })
  pressMetaS()
  assert("3k-0 写回源文件后 title 干净", await waitFor(function () { return title() === baseTitle }), title())
  assert(
    "3k 直接写回拖入源文件",
    dropHandle.writes.length === 1
      && dropHandle.writes[0] === editor.getMarkdown()
      && pickerCalls.length === pickersBefore3k,
    JSON.stringify({ writes: dropHandle.writes, pickers: pickerCalls.length, before: pickersBefore3k })
  )

  // 3l. destroy：恢复原始 title、移除 keydown 监听
  editor.setMarkdown("# 拖入的文档\n\n再改。")
  assert("3l-0 destroy 前为脏", title() === "* " + baseTitle, title())
  editor.destroy()
  assert("3l destroy 恢复原始 title", title() === baseTitle, title())
  clearPicker()
  pressMetaS()
  await sleep(20)
  assert("3m destroy 后 Meta+S 不再保存", downloads.length === 1 && dropHandle.writes.length === 1)
}

var schema = buildSchema()
var parser = buildMarkdownParser(schema)

async function main() {
  await part1Saver()
  await part2DropCallbacks()
  await part3EndToEnd()
  if (failures > 0) {
    console.log("RESULT: " + failures + " FAILED")
    process.exit(1)
  }
  console.log("RESULT: ALL PASS")
}

main()