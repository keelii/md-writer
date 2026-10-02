// 预览块「编辑源码」端到端验证：
// 1. NodeOpMenu（预览块 DecoMenu）包含 复制 / 编辑 / 删除节点 三项。
// 2. 编辑源码弹窗流程（最小 DOM stub 驱动 dialog 基建，不依赖真实浏览器）：
//    源码区为 CodeMirror（工厂注入桩模拟，真实 CM 依赖浏览器布局），
//    打开时编辑器预填当前源码；改值点确认 → 纯命令替换 text* 内容，
//    公式块与 mermaid 块各自校验；点取消 → 文档不变。
// 3. 纯命令守卫：内容相同跳过 dispatch（不产生空历史）；
//    类型不符（非预览块 / pos 越界）不动作。
import { EditorState, Transaction } from "prosemirror-state"
import { Node as PMNode } from "prosemirror-model"
import { buildSchema } from "../src/prosemirror/schema"
import { createPreviewSourceReplaceCommand } from "../src/prosemirror/commands"
import { editPreviewBlockSource } from "../src/prosemirror/actions"
import { previewBlockOpMenuRegistration } from "../src/prosemirror/nodeviews/node-op-menu"
import { sourceEditorFactory } from "../src/prosemirror/source-edit-dialog"
import { SourceEditorAdapter } from "../src/codemirror/source-editor"
import { SvgIcon } from "../src/icons"

class FakeElement {
  tagName: string
  nodeType: number
  attrs: Record<string, string>
  children: FakeElement[]
  text: string
  parent: FakeElement | null
  listeners: Record<string, Array<(event: any) => void>>
  value: string

  constructor(tagName: string, nodeType: number, text?: string) {
    this.tagName = tagName
    this.nodeType = nodeType
    this.attrs = {}
    this.children = []
    this.text = text == null ? "" : text
    this.parent = null
    this.listeners = {}
    this.value = ""
  }

  setAttribute(name: string, value: string) {
    this.attrs[name] = value
  }

  removeAttribute(name: string) {
    delete this.attrs[name]
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
  }

  appendChild(child: FakeElement) {
    child.parent = this
    this.children.push(child)
    return child
  }

  addEventListener(type: string, fn: (event: any) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = []
    }
    this.listeners[type].push(fn)
  }

  removeEventListener(type: string, fn: (event: any) => void) {
    var list = this.listeners[type] || []
    var index = list.indexOf(fn)
    if (index >= 0) {
      list.splice(index, 1)
    }
  }

  contains(node: FakeElement): boolean {
    var current: FakeElement | null = node
    while (current) {
      if (current === this) {
        return true
      }
      current = current.parent
    }
    return false
  }

  get className(): string {
    return this.attrs["class"] || ""
  }

  get classList() {
    var self = this
    return {
      add: function (c: string) {
        var parts = self.attrs["class"] ? self.attrs["class"].split(/\s+/) : []
        if (parts.indexOf(c) < 0) {
          parts.push(c)
        }
        self.attrs["class"] = parts.join(" ")
      },
      remove: function (c: string) {
        var parts = self.attrs["class"] ? self.attrs["class"].split(/\s+/).filter(Boolean) : []
        self.attrs["class"] = parts.filter(function (p) { return p !== c }).join(" ")
      },
      contains: function (c: string) {
        return (self.attrs["class"] || "").split(/\s+/).indexOf(c) >= 0
      },
      toggle: function (c: string) {
        if ((self.attrs["class"] || "").split(/\s+/).indexOf(c) >= 0) {
          return
        }
        self.attrs["class"] = (self.attrs["class"] ? self.attrs["class"] + " " : "") + c
      }
    }
  }

  set innerHTML(value: string) {
    this.attrs["innerHTML"] = String(value)
  }

  get innerHTML(): string {
    return this.attrs["innerHTML"] || ""
  }

  focus() {}

  select() {}

  // 支持 [attr~="token"] 形式选择器，可逗号分隔多个（dialog 基建全部使用该形态）
  private static matches(el: FakeElement, selector: string): boolean {
    var parts = selector.split(",")
    for (var i = 0; i < parts.length; i += 1) {
      var match = parts[i].trim().match(/^\[([a-zA-Z-]+)~="([^"]+)"\]$/)
      if (!match) {
        continue
      }
      var tokens = (el.attrs[match[1]] || "").split(/\s+/)
      if (tokens.indexOf(match[2]) >= 0) {
        return true
      }
    }
    return false
  }

  querySelector(selector: string): FakeElement | null {
    for (var i = 0; i < this.children.length; i += 1) {
      var child = this.children[i]
      if (FakeElement.matches(child, selector)) {
        return child
      }
      var found = child.querySelector(selector)
      if (found) {
        return found
      }
    }
    return null
  }

  closest(selector: string): FakeElement | null {
    var current: FakeElement | null = this
    while (current) {
      if (FakeElement.matches(current, selector)) {
        return current
      }
      current = current.parent
    }
    return null
  }
}

var registered: FakeElement[] = []

;(globalThis as any).document = {
  createElement: function (tag: string) {
    return new FakeElement(tag, 1)
  },
  createTextNode: function (text: string) {
    return new FakeElement("#text", 3, text)
  },
  createDocumentFragment: function () {
    return new FakeElement("#fragment", 11)
  },
  getElementById: function (id: string) {
    for (var i = 0; i < registered.length; i += 1) {
      if (registered[i].attrs["id"] === id) {
        return registered[i]
      }
    }
    return null
  },
  querySelectorAll: function () {
    return [] as FakeElement[]
  },
  body: {
    appendChild: function (el: FakeElement) {
      registered.push(el)
      return el
    }
  }
}

// dialog 基建使用 window.DashAppUI（宿主 UI 框架，测试环境无）与 window.setTimeout
;(globalThis as any).window = globalThis

var failures = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log("PASS: " + label)
  } else {
    failures += 1
    console.log("FAIL: " + label)
  }
}

function assertEqual(actual: any, expected: any, label: string) {
  assert(actual === expected, label + "（expected: " + JSON.stringify(expected) + ", actual: " + JSON.stringify(actual) + "）")
}

function findButtonByTitle(host: FakeElement, title: string): FakeElement | null {
  for (var i = 0; i < host.children.length; i += 1) {
    var child = host.children[i]
    if (child.nodeType === 1 && child.tagName === "button" && child.attrs["title"] === title) {
      return child
    }
    var found = findButtonByTitle(child, title)
    if (found) {
      return found
    }
  }
  return null
}

var schema = buildSchema()

function createFakeView(doc: PMNode) {
  var state = EditorState.create({ schema: schema, doc: doc })
  var view: any = {
    state: state,
    dispatch: function (tr: Transaction) {
      view.state = view.state.apply(tr)
    },
    focus: function () {}
  }
  return view
}

// ---------- 1. NodeOpMenu 菜单项 ----------

var mathSource = "$$\nE=mc^2\n$$"
var mathDoc = schema.topNodeType.createAndFill(null, [
  schema.nodes.raw_block.create(null, schema.text(mathSource))
]) as PMNode
var menuView = createFakeView(mathDoc)
var menuDom = previewBlockOpMenuRegistration.buildMenu({
  node: mathDoc.firstChild as PMNode,
  pos: 0,
  view: menuView
}) as unknown as FakeElement
assert(!!findButtonByTitle(menuDom, "复制"), "menu has 复制")
assert(!!findButtonByTitle(menuDom, "编辑"), "menu has 编辑")
assert(!!findButtonByTitle(menuDom, "删除"), "menu has 删除")

// 主按钮 icon 按块类型区分：math=sigma / svg=vector-square / mermaid=square-chart-gantt
function assertToggleIcon(doc: PMNode, title: string, icon: string, label: string) {
  var view = createFakeView(doc)
  var dom = previewBlockOpMenuRegistration.buildMenu({
    node: doc.firstChild as PMNode,
    pos: 0,
    view: view
  }) as unknown as FakeElement
  var toggle = findButtonByTitle(dom, title)
  assert(!!toggle, label + " toggle button exists（title=" + title + "）")
  if (toggle) {
    assertEqual(toggle.innerHTML, icon, label + " toggle icon")
  }
}

assertToggleIcon(mathDoc, "公式操作", SvgIcon.sigma, "math")
var svgDoc = schema.topNodeType.createAndFill(null, [
  schema.nodes.raw_block.create(null, schema.text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'))
]) as PMNode
assertToggleIcon(svgDoc, "SVG 操作", SvgIcon.vectorSquare, "svg")
var ganttDoc = schema.topNodeType.createAndFill(null, [
  schema.nodes.code_block.create({ params: "mermaid" }, schema.text("graph TB\nA-->B"))
]) as PMNode
assertToggleIcon(ganttDoc, "图表操作", SvgIcon.squareChartGantt, "mermaid")

// ---------- 2. 纯命令（mermaid code_block 路径 + 守卫） ----------

var mermaidDoc = schema.topNodeType.createAndFill(null, [
  schema.nodes.code_block.create({ params: "mermaid" }, schema.text("graph TB\nA-->B"))
]) as PMNode
var mermaidState = EditorState.create({ schema: schema, doc: mermaidDoc })
var dispatched = 0
createPreviewSourceReplaceCommand(0, "graph TB\nA-->C")(mermaidState, function (tr) {
  dispatched += 1
  mermaidState = mermaidState.apply(tr)
})
assert(mermaidState.doc.firstChild!.textContent === "graph TB\nA-->C", "mermaid source replaced")
assertEqual((mermaidState.doc.firstChild as PMNode).attrs.params, "mermaid", "mermaid params preserved")

// 内容相同 → 不 dispatch（避免空历史记录）
var before = dispatched
createPreviewSourceReplaceCommand(0, "graph TB\nA-->C")(mermaidState, function () {
  dispatched += 1
})
assertEqual(dispatched, before, "unchanged source skips dispatch")

// 非预览块 → 命令返回 false 不动作
var paraDoc = schema.topNodeType.createAndFill(null, [schema.nodes.paragraph.create()]) as PMNode
var paraState = EditorState.create({ schema: schema, doc: paraDoc })
assert(createPreviewSourceReplaceCommand(0, "x")(paraState) === false, "non-preview block rejected")

// ---------- 3. 弹窗端到端：确认改源码 / 取消不变 ----------

// CodeMirror 工厂注入桩：记录每次创建的编辑器状态，模拟用户编辑
// （真实 CodeMirror 依赖浏览器布局，FakeElement 环境无法承载）
var fakeEditorStates: Array<{ value: string, onChange?: (value: string) => void }> = []
var fakeEditorDestroys = 0
sourceEditorFactory.create = function (
  container: HTMLElement,
  initialValue: string,
  onChange?: (value: string) => void
): SourceEditorAdapter {
  var state = { value: String(initialValue == null ? "" : initialValue), onChange: onChange }
  fakeEditorStates.push(state)
  return {
    getValue: function () { return state.value },
    setValue: function (value: string) { state.value = String(value == null ? "" : value) },
    focus: function () {},
    refresh: function () {},
    getWrapperElement: function () { return container },
    destroy: function () { fakeEditorDestroys += 1 }
  }
}

async function main() {
  // 确认路径：公式块
  var view = createFakeView(mathDoc)
  editPreviewBlockSource(view, 0, null)
  var backdrop = (globalThis as any).document.getElementById("md-editor-source-dialog") as FakeElement | null
  assert(!!backdrop, "dialog backdrop created")
  var editorHost = backdrop && backdrop.querySelector('[data-role~="md-editor-source-editor"]')
  assert(!!editorHost, "dialog has code editor host")
  var editorState = fakeEditorStates[fakeEditorStates.length - 1]
  assertEqual(editorState ? editorState.value : "", mathSource, "code editor preset with current source")
  if (editorState) {
    editorState.value = "$$\nE=mc\n$$"
  }
  var confirmBtn = backdrop && backdrop.querySelector('[data-role~="md-editor-dialog-confirm"]')
  assert(!!confirmBtn, "dialog has confirm button")
  if (backdrop && confirmBtn) {
    var clicks = backdrop.listeners["click"] || []
    for (var i = 0; i < clicks.length; i += 1) {
      clicks[i]({ target: confirmBtn, preventDefault: function () {} })
    }
  }
  await new Promise(function (resolve) { setTimeout(resolve, 20) })
  assertEqual((view.state.doc.firstChild as PMNode).textContent, "$$\nE=mc\n$$", "confirm applies new math source")

  // 取消路径：文档不变
  var view2 = createFakeView(mathDoc)
  editPreviewBlockSource(view2, 0, null)
  var backdrop2 = (globalThis as any).document.getElementById("md-editor-source-dialog") as FakeElement | null
  var cancelBtn = backdrop2 && backdrop2.querySelector('[data-role~="md-editor-dialog-cancel"]')
  assert(!!cancelBtn, "dialog has cancel button")
  if (backdrop2 && cancelBtn) {
    var clicks2 = backdrop2.listeners["click"] || []
    for (var j = 0; j < clicks2.length; j += 1) {
      clicks2[j]({ target: cancelBtn, preventDefault: function () {} })
    }
  }
  await new Promise(function (resolve) { setTimeout(resolve, 20) })
  assertEqual((view2.state.doc.firstChild as PMNode).textContent, mathSource, "cancel keeps source unchanged")

  // mermaid 弹窗路径：编辑器预填 mermaid 源码
  var mermaidView = createFakeView(mermaidDoc)
  editPreviewBlockSource(mermaidView, 0, null)
  var backdrop3 = (globalThis as any).document.getElementById("md-editor-source-dialog") as FakeElement | null
  var mermaidEditorState = fakeEditorStates[fakeEditorStates.length - 1]
  assertEqual(mermaidEditorState ? mermaidEditorState.value : "", "graph TB\nA-->B", "mermaid editor preset with source")
  // 每次打开的编辑器都在关闭时销毁（无泄漏）
  assertEqual(fakeEditorDestroys, fakeEditorStates.length - 1, "editor destroyed on dialog close")

  if (failures > 0) {
    console.log("FAILED: " + failures)
    process.exit(1)
  }
  console.log("ALL PREVIEW EDIT TESTS PASSED")
}

main()