// 图片文件拖入功能验证（createMarkdownFileDropPlugin 图片分支）：
// - 拖入图片文件落点在编辑器内：按 posAtCoords 定位插入 image 节点
// - 落点在 code_block 等纯文本块：不插入（静默放弃，但事件仍接管）
// - posAtCoords 返回 null：静默放弃
// - 编辑器外 drop（document 级接管）：插入到当前选区，且 preventDefault 防浏览器导航
// - 多图顺序插入；md 与图片混合时 md 优先（按打开文档处理，不插图）
// - 无 onImageUpload 时走 dataURL 读取；有 onImageUpload 时走宿主管线（对象/字符串结果）
// - 非图片非 md 文件不接管；编辑器卸载后异步回调不 dispatch
// Node 环境无全局 FileReader / document，脚本内注入同步 stub。
import { EditorState, TextSelection } from "prosemirror-state"
import { Node as PMNode } from "prosemirror-model"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, parseMarkdown } from "../src/prosemirror/markdown"
import { createMarkdownFileDropPlugin } from "../src/prosemirror/plugins"

// ---- 同步 FileReader stub（Node 18 无全局实现），支持 readAsText 与 readAsDataURL ----
class StubFileReader {
  result: string | null = null
  error: any = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  readAsText(file: any) {
    this.result = file.__content
    if (this.onload) {
      this.onload()
    }
  }
  readAsDataURL(file: any) {
    this.result = "data:" + file.type + ";base64," + file.__data
    if (this.onload) {
      this.onload()
    }
  }
}
;(globalThis as any).FileReader = StubFileReader

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

function imageFile(name: string, type?: string) {
  return { name: name, type: type || "image/png", __data: "IMG_" + name } as any
}

function mdFile(name: string, content: string) {
  return { name: name, type: "", __content: content } as any
}

function txtFile(name: string) {
  return { name: name, type: "text/plain", __content: "纯文本" } as any
}

function fakeDom() {
  var classes = new Set<string>()
  return {
    classes: classes,
    isConnected: true,
    contains: function () {
      return false
    },
    classList: {
      add: function (name: string) {
        classes.add(name)
      },
      remove: function (name: string) {
        classes.delete(name)
      },
      contains: function (name: string) {
        return classes.has(name)
      }
    }
  }
}

// fake view：闭包 state + 可配置 posAtCoords；target 为 "editor-inside" 视为编辑器内落点
function fakeView(markdown: string, posAtCoordsPos?: number) {
  var doc = parseMarkdown(schema, parser, markdown)
  var state = EditorState.create({ schema: schema, doc: doc })
  var dom = fakeDom() as any
  var view: any = {
    dom: dom,
    state: state,
    posAtCoords: function () {
      return posAtCoordsPos == null ? null : { pos: posAtCoordsPos, inside: 1 }
    },
    dispatch: function (tr: any) {
      view.state = view.state.apply(tr)
    }
  }
  view.dom.contains = function (target: any) {
    return target === "editor-inside"
  }
  return view
}

// 把选区设到文档顶层第 startFrom 个文本位置（用于编辑器外落点插入断言）
function selectAt(view: any, from: number, to: number) {
  var state = view.state as EditorState
  view.state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
}

function dropEvent(files: any[], target?: string) {
  var prevented = false
  return {
    prevented: function () {
      return prevented
    },
    dataTransfer: {
      files: files,
      types: files.length > 0 ? ["Files"] : []
    },
    target: target,
    clientX: 10,
    clientY: 10,
    preventDefault: function () {
      prevented = true
    }
  } as any
}

async function runDrop(pluginProps: any, view: any, event: any) {
  var handled = pluginProps.handleDrop(view, event)
  await new Promise(function (resolve) {
    setTimeout(resolve, 0)
  })
  return handled
}

function imagesIn(state: EditorState) {
  var results: Array<{ pos: number; src: string; alt: string; title: any }> = []
  state.doc.descendants(function (node: PMNode, pos: number) {
    if (node.type.name === "image") {
      results.push({ pos: pos, src: String(node.attrs.src), alt: String(node.attrs.alt), title: node.attrs.title })
    }
    return true
  })
  return results
}

// ---- 1. 编辑器内落点：按 posAtCoords 插入 ----
async function caseInsideDrop() {
  var plugin = createMarkdownFileDropPlugin(schema, parser)
  // "段落一" 文本占 pos 1..4（+1 前缀），落点 pos 3 在段落内
  var view = fakeView("段落一\n\n段落二", 3)
  var event = dropEvent([imageFile("a.png")], "editor-inside")
  var handled = await runDrop((plugin as any).props, view, event)
  var imgs = imagesIn(view.state)
  console.log("--- 1. 编辑器内落点插入 ---")
  assert("1a 图片拖入返回 true（事件接管）", handled === true)
  assert("1b drop 事件被 preventDefault", event.prevented() === true)
  assert("1c image 节点已插入", imgs.length === 1, JSON.stringify(imgs))
  assert("1d 插入位置为 posAtCoords 结果", imgs[0] && imgs[0].pos === 3, imgs[0] ? String(imgs[0].pos) : "")
  assert("1e src 为 dataURL", imgs[0] && imgs[0].src === "data:image/png;base64,IMG_a.png", imgs[0] ? imgs[0].src : "")
  assert("1f alt 为文件名", imgs[0] && imgs[0].alt === "a.png")
}

// ---- 2. 落点在 code_block：不插入（静默放弃）----
async function caseCodeBlockDrop() {
  var plugin = createMarkdownFileDropPlugin(schema, parser)
  // code_block 内 pos：doc 结构为 doc > code_block > text
  var view = fakeView("```\nvar x = 1\n```", 2)
  var event = dropEvent([imageFile("b.png")], "editor-inside")
  var handled = await runDrop((plugin as any).props, view, event)
  console.log("")
  console.log("--- 2. code_block 落点拒绝 ---")
  assert("2a 事件仍返回 true（阻止浏览器打开图片）", handled === true)
  assert("2b 事件被 preventDefault", event.prevented() === true)
  assert("2c code_block 内不插入 image", imagesIn(view.state).length === 0)
}

// ---- 3. posAtCoords 返回 null（坐标不可解析）：静默放弃 ----
async function caseNoCoordsDrop() {
  var plugin = createMarkdownFileDropPlugin(schema, parser)
  var view = fakeView("段落一", null)
  var handled = await runDrop((plugin as any).props, view, dropEvent([imageFile("c.png")], "editor-inside"))
  console.log("")
  console.log("--- 3. 坐标不可解析 ---")
  assert("3a 返回 true 但不插入", handled === true && imagesIn(view.state).length === 0)
}

// ---- 4. 编辑器外落点：document 级接管，插入到当前选区 ----
async function caseOutsideDrop() {
  var listeners: Record<string, Array<(e: any) => void>> = {}
  ;(globalThis as any).document = {
    addEventListener: function (type: string, fn: any) {
      ;(listeners[type] = listeners[type] || []).push(fn)
    },
    removeEventListener: function (type: string, fn: any) {
      var arr = listeners[type] || []
      var idx = arr.indexOf(fn)
      if (idx >= 0) {
        arr.splice(idx, 1)
      }
    },
    body: {
      contains: function () {
        return false
      }
    }
  }
  var plugin = createMarkdownFileDropPlugin(schema, parser)
  // "段落二" 顶层第二段，pos 8..11
  var view = fakeView("段落一\n\n段落二")
  selectAt(view, 9, 9)
  var pluginView: any = (plugin as any).spec.view(view)
  var event = dropEvent([imageFile("d.png")]) // target undefined → 编辑器外
  listeners.drop[0](event)
  await new Promise(function (resolve) {
    setTimeout(resolve, 0)
  })
  var imgs = imagesIn(view.state)
  console.log("")
  console.log("--- 4. 编辑器外落点（document 级接管） ---")
  assert("4a 编辑器外 drop 被 preventDefault", event.prevented() === true)
  assert("4b 插入到当前选区位置", imgs.length === 1 && imgs[0].pos === 9, JSON.stringify(imgs))
  assert("4c 选区所在段落文本保留", view.state.doc.textContent.indexOf("段落二") >= 0)
  pluginView.destroy()
  delete (globalThis as any).document
}

// ---- 5. 编辑器外落点且选区在 code_block：不插入 ----
async function caseOutsideCodeBlock() {
  var listeners: Record<string, Array<(e: any) => void>> = {}
  ;(globalThis as any).document = {
    addEventListener: function (type: string, fn: any) {
      ;(listeners[type] = listeners[type] || []).push(fn)
    },
    removeEventListener: function () {},
    body: { contains: function () { return false } }
  }
  var plugin = createMarkdownFileDropPlugin(schema, parser)
  var view = fakeView("```\nvar x = 1\n```")
  selectAt(view, 2, 2)
  var pluginView: any = (plugin as any).spec.view(view)
  var event = dropEvent([imageFile("e.png")])
  listeners.drop[0](event)
  await new Promise(function (resolve) {
    setTimeout(resolve, 0)
  })
  console.log("")
  console.log("--- 5. 编辑器外落点但选区在 code_block ---")
  assert("5a 事件被接管", event.prevented() === true)
  assert("5b code_block 选区不插入 image", imagesIn(view.state).length === 0)
  pluginView.destroy()
  delete (globalThis as any).document
}

// ---- 6. 多图顺序插入 ----
async function caseMultiImages() {
  var plugin = createMarkdownFileDropPlugin(schema, parser)
  var view = fakeView("段落一", 3)
  var handled = await runDrop(
    (plugin as any).props,
    view,
    dropEvent([imageFile("1.png"), imageFile("2.png")], "editor-inside")
  )
  var imgs = imagesIn(view.state)
  console.log("")
  console.log("--- 6. 多图顺序插入 ---")
  assert("6a 多图拖入返回 true", handled === true)
  assert("6b 两张图片均插入", imgs.length === 2, JSON.stringify(imgs))
  assert(
    "6c 按文件顺序排列",
    imgs.length === 2 && imgs[0].src.indexOf("1.png") >= 0 && imgs[1].src.indexOf("2.png") >= 0,
    imgs.map(function (i) { return i.src }).join(" | ")
  )
  assert("6d 位置依次排布", imgs.length === 2 && imgs[1].pos > imgs[0].pos)
}

// ---- 7. md 与图片混合：md 优先（按打开文档处理）----
async function caseMixedFiles() {
  var plugin = createMarkdownFileDropPlugin(schema, parser)
  var view = fakeView("段落一", 3)
  var handled = await runDrop(
    (plugin as any).props,
    view,
    dropEvent([imageFile("x.png"), mdFile("a.md", "# 标题\n")], "editor-inside")
  )
  var imgs = imagesIn(view.state)
  console.log("")
  console.log("--- 7. md 与图片混合优先 md ---")
  assert("7a 返回 true", handled === true)
  assert("7b 按 md 打开文档（heading 替换原文档）", view.state.doc.firstChild && view.state.doc.firstChild.type.name === "heading")
  assert("7c 不插入 image 节点", imgs.length === 0)
}

// ---- 8. 非图片非 md 文件：不接管 ----
async function caseNonImageFile() {
  var plugin = createMarkdownFileDropPlugin(schema, parser)
  var view = fakeView("段落一", 3)
  var event = dropEvent([txtFile("n.txt")], "editor-inside")
  var handled = await runDrop((plugin as any).props, view, event)
  console.log("")
  console.log("--- 8. 非图片非 md 不接管 ---")
  assert("8a 拖入 .txt 返回 false", handled === false)
  assert("8b 不 preventDefault", event.prevented() === false)
  assert("8c 文档保持不变", imagesIn(view.state).length === 0 && view.state.doc.textContent === "段落一")
}

// ---- 9. 编辑器卸载后异步回调不 dispatch ----
async function caseDestroyedView() {
  var plugin = createMarkdownFileDropPlugin(schema, parser)
  var view = fakeView("段落一", 3)
  view.dom.isConnected = false
  var handled = await runDrop((plugin as any).props, view, dropEvent([imageFile("y.png")], "editor-inside"))
  console.log("")
  console.log("--- 9. 卸载视图 ---")
  assert("9a 卸载视图仍返回 true（事件已接管）", handled === true)
  assert("9b 卸载视图不修改文档", imagesIn(view.state).length === 0)
}

// ---- 10. onImageUpload 宿主管线 ----
async function caseUploadPipeline() {
  // 10a 对象结果 {src, alt, title}
  var pluginA = createMarkdownFileDropPlugin(schema, parser, undefined, {
    onImageUpload: function (file: any) {
      return Promise.resolve({ src: "https://cdn.example.com/" + file.name, alt: "描述", title: "标题" })
    }
  } as any)
  var viewA = fakeView("段落一", 3)
  await runDrop((pluginA as any).props, viewA, dropEvent([imageFile("u.png")], "editor-inside"))
  var imgsA = imagesIn(viewA.state)

  // 10b 字符串结果（直接作为 src）
  var pluginB = createMarkdownFileDropPlugin(schema, parser, undefined, {
    onImageUpload: function (file: any) {
      return Promise.resolve("https://cdn.example.com/raw/" + file.name)
    }
  } as any)
  var viewB = fakeView("段落一", 3)
  await runDrop((pluginB as any).props, viewB, dropEvent([imageFile("v.png")], "editor-inside"))
  var imgsB = imagesIn(viewB.state)

  console.log("")
  console.log("--- 10. onImageUpload 宿主管线 ---")
  assert("10a 对象结果生成 image 节点", imgsA.length === 1, JSON.stringify(imgsA))
  assert("10b 对象 src/alt/title 生效", imgsA[0] && imgsA[0].src === "https://cdn.example.com/u.png" && imgsA[0].alt === "描述" && imgsA[0].title === "标题")
  assert("10c 字符串结果作为 src", imgsB.length === 1 && imgsB[0].src === "https://cdn.example.com/raw/v.png", JSON.stringify(imgsB))
  assert("10d 字符串结果 alt 回退文件名", imgsB[0] && imgsB[0].alt === "v.png")
}

async function main() {
  await caseInsideDrop()
  await caseCodeBlockDrop()
  await caseNoCoordsDrop()
  await caseOutsideDrop()
  await caseOutsideCodeBlock()
  await caseMultiImages()
  await caseMixedFiles()
  await caseNonImageFile()
  await caseDestroyedView()
  await caseUploadPipeline()
  if (failures > 0) {
    console.log("")
    console.log("RESULT: " + failures + " FAILED")
    process.exit(1)
  }
  console.log("")
  console.log("RESULT: ALL PASS")
}

main()