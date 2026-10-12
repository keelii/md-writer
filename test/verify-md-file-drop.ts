// 本地 md 文件拖入功能验证（createMarkdownFileDropPlugin）：
// - 拖入 .md/.markdown/.mdown/.mkd 文件：无论原文档是否为空，整体替换（等效"打开文件"）
// - 拖入非 md 文件（.txt）：不接管（handleDrop 返回 false）
// - 响应范围是整个页面：document 级 dragover（带文件）preventDefault + 挂高亮类；
//   dragleave 离开窗口移除高亮类；drop 落在编辑器外由 document 级监听接管，
//   落在编辑器内由 handleDrop 接管（document 级跳过，避免双重插入）
// - 多文件合并后整体替换；destroy 移除全部 document 监听
// Node 18 无全局 FileReader / document，脚本内注入同步 stub。
import { EditorState } from "prosemirror-state"
import { Node as PMNode } from "prosemirror-model"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, parseMarkdown } from "../src/prosemirror/markdown"
import { createMarkdownFileDropPlugin } from "../src/prosemirror/plugins"

// ---- 同步 FileReader stub（Node 18 无全局实现） ----
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
var plugin = createMarkdownFileDropPlugin(schema, parser)
var props: any = plugin.props
if (typeof props.handleDrop !== "function") {
  throw new Error("no handleDrop prop found")
}

// fake 文件：name/type + __content 供 FileReader stub 读取
function mdFile(name: string, content: string, type?: string) {
  return { name: name, type: type || "", __content: content } as any
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

// fake view：dispatch 应用到闭包 state
function fakeView(initialMarkdown: string) {
  var doc = parseMarkdown(schema, parser, initialMarkdown)
  var state = EditorState.create({ schema: schema, doc: doc })
  var dom = fakeDom() as any
  var view: any = {
    dom: dom,
    state: state,
    dispatch: function (tr: any) {
      view.state = view.state.apply(tr)
    }
  }
  return view
}

function dropEvent(files: any[]) {
  var prevented = false
  return {
    prevented: function () {
      return prevented
    },
    dataTransfer: {
      files: files,
      types: files.length > 0 ? ["Files"] : []
    },
    clientX: 10,
    clientY: 10,
    preventDefault: function () {
      prevented = true
    }
  } as any
}

async function runDrop(view: any, event: any) {
  var handled = props.handleDrop(view, event)
  // FileReader stub 同步完成，但 handleDrop 内有 Promise.all 微任务链，用宏任务一次 flush 干净
  await new Promise(function (resolve) {
    setTimeout(resolve, 0)
  })
  return handled
}

function topNodeNames(state: EditorState) {
  var names: string[] = []
  state.doc.forEach(function (node: PMNode) {
    names.push(node.type.name)
  })
  return names
}

// 1. 空文档拖入 .md → 整体替换（heading + 列表生效）
async function caseEmptyDoc() {
  var view = fakeView("")
  var md = "# 标题\n\n- 甲\n- 乙\n"
  var handled = await runDrop(view, dropEvent([mdFile("note.md", md)]))
  var names = topNodeNames(view.state)
  assert("1a 空文档拖入 .md 返回 true", handled === true)
  assert("1b 文档被替换为 heading + bullet_list", names.join(",") === "heading,bullet_list", names.join(","))
  assert("1c 空段落占位被移除", view.state.doc.textContent.indexOf("标题") >= 0)
}

// 2. 非空文档拖入 → 原文档被清空，整体替换为文件内容
async function caseNonEmptyDoc() {
  var view = fakeView("原有段落。")
  var md = "## 新章节\n\n正文。\n"
  var handled = await runDrop(view, dropEvent([mdFile("chap.md", md)]))
  var names = topNodeNames(view.state)
  var text = view.state.doc.textContent
  assert("2a 非空文档拖入返回 true", handled === true)
  assert("2b 文档被替换为 heading + paragraph", names.join(",") === "heading,paragraph", names.join(","))
  assert("2c 原文档内容被清空", text.indexOf("原有段落。") < 0 && text.indexOf("新章节") >= 0)
}

// 3. 非 md 文件 → 不接管
async function caseNonMdFile() {
  var view = fakeView("")
  var handled = await runDrop(view, dropEvent([mdFile("a.txt", "# 不是 md\n\n正文")]))
  assert("3a 拖入 .txt 返回 false", handled === false)
  assert("3b 文档保持为空", view.state.doc.textContent === "")
}

// 4. 扩展名变体与 MIME 均识别
async function caseExtVariants() {
  var viewA = fakeView("")
  var handledA = await runDrop(viewA, dropEvent([mdFile("x.markdown", "# A\n\na\n")]))
  var viewB = fakeView("")
  var handledB = await runDrop(viewB, dropEvent([mdFile("y.bin", "# B\n\nb\n", "text/markdown")]))
  assert("4a .markdown 扩展被接管", handledA === true && topNodeNames(viewA.state)[0] === "heading")
  assert("4b text/markdown MIME 被接管", handledB === true && topNodeNames(viewB.state)[0] === "heading")
}

// 5. 拖入文件落点在 code_block 内 → 仍整体替换文档（md 转换正常生效）
async function caseCodeBlock() {
  var view = fakeView("```\nabc\n```\n")
  var handled = await runDrop(view, dropEvent([mdFile("code.md", "# 转换生效\n")]))
  var names = topNodeNames(view.state)
  assert("5a code_block 内拖入返回 true", handled === true)
  assert("5b 原文档（含 code_block）被清空", names.join(",") === "heading", names.join(","))
  assert("5c md 转换正常生效", view.state.doc.textContent.indexOf("转换生效") >= 0)
}

// 6. 多文件合并插入（\n\n 连接）
async function caseMultiFiles() {
  var view = fakeView("")
  var handled = await runDrop(view, dropEvent([mdFile("1.md", "# 一\n"), mdFile("2.md", "# 二\n")]))
  var headings: string[] = []
  view.state.doc.forEach(function (node: PMNode) {
    if (node.type.name === "heading") {
      headings.push(node.textContent)
    }
  })
  assert("6a 多文件拖入返回 true", handled === true)
  assert("6b 两个文件的 heading 均插入", headings.length === 2, headings.join("|"))
}

// 7. document 级监听：响应范围是整个页面
async function caseDragOverHighlight() {
  // Node 环境无 document：注入 stub 捕获插件注册的监听器
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
      contains: function (node: any) {
        return !!node && node.insidePage === true
      }
    }
  }

  var view = fakeView("")
  var pluginView: any = (plugin as any).spec.view(view)
  assert("7a 注册了 document 级 dragover/dragleave/drop 监听", !!listeners.dragover && !!listeners.dragleave && !!listeners.drop)

  var withFiles = dropEvent([mdFile("a.md", "# A\n")])
  listeners.dragover[0](withFiles)
  assert("7b dragover(带文件) preventDefault", withFiles.prevented() === true)
  assert("7c 高亮类已挂载", view.dom.classList.contains("md-editor-file-drag-over") === true)

  var noFiles = dropEvent([])
  listeners.dragover[0](noFiles)
  assert("7d dragover(无文件) 不 preventDefault", noFiles.prevented() === false)

  // dragleave 且 relatedTarget 在页面外（null）→ 移除类
  listeners.dragleave[0]({ relatedTarget: null })
  assert("7e dragleave(离开窗口) 移除高亮类", view.dom.classList.contains("md-editor-file-drag-over") === false)

  // relatedTarget 在页面内（body.contains 为 true）→ 不清理
  listeners.dragover[0](withFiles)
  listeners.dragleave[0]({ relatedTarget: { insidePage: true } })
  assert("7f dragleave(页面内移动) 不清理", view.dom.classList.contains("md-editor-file-drag-over") === true)
  listeners.dragleave[0]({ relatedTarget: null })

  // drop 落在编辑器外（target 不在 view.dom 内）→ document 级接管，整体替换文档
  var outsideEvent = dropEvent([mdFile("note.md", "# 外部落点\n\n正文\n")])
  listeners.drop[0](outsideEvent)
  await new Promise(function (resolve) {
    setTimeout(resolve, 0)
  })
  var names = topNodeNames(view.state)
  assert("7g 编辑器外 drop 被 preventDefault", outsideEvent.prevented() === true)
  assert("7h 编辑器外 drop 后高亮类移除", view.dom.classList.contains("md-editor-file-drag-over") === false)
  assert("7i 编辑器外 drop 整体替换文档", names.join(",") === "heading,paragraph", names.join(","))

  // drop 落在编辑器内（target 在 view.dom 内）→ document 级跳过，交由 handleDrop
  var insideView = fakeView("")
  insideView.dom.contains = function (target: any) {
    return target === "editor-inside"
  }
  var insidePluginView: any = (plugin as any).spec.view(insideView)
  var insideEvent = dropEvent([mdFile("in.md", "# 不应插入\n")])
  insideEvent.target = "editor-inside"
  listeners.drop[listeners.drop.length - 1](insideEvent)
  await new Promise(function (resolve) {
    setTimeout(resolve, 0)
  })
  assert("7j 编辑器内 drop 由 document 级跳过", insideView.state.doc.textContent === "")

  // destroy：移除全部 document 监听 + 高亮类
  pluginView.destroy()
  insidePluginView.destroy()
  assert(
    "7k destroy 移除全部 document 监听",
    listeners.dragover.length === 0 && listeners.dragleave.length === 0 && listeners.drop.length === 0
  )
  delete (globalThis as any).document
}

// 8. 编辑器卸载后异步回调不 dispatch
async function caseDestroyedView() {
  var view = fakeView("")
  view.dom.isConnected = false
  var handled = await runDrop(view, dropEvent([mdFile("a.md", "# A\n")]))
  assert("8a 卸载视图仍返回 true（事件已接管）", handled === true)
  assert("8b 卸载视图不修改文档", view.state.doc.textContent === "")
}

async function main() {
  await caseEmptyDoc()
  await caseNonEmptyDoc()
  await caseNonMdFile()
  await caseExtVariants()
  await caseCodeBlock()
  await caseMultiFiles()
  await caseDragOverHighlight()
  await caseDestroyedView()
  if (failures > 0) {
    console.log("RESULT: " + failures + " FAILED")
    process.exit(1)
  }
  console.log("RESULT: ALL PASS")
}

main()