// frontmatter 删除端到端验证（复现「点击删除没反应」）：
// 1. frontmatter 是单项按钮形态（仅"删除"），run 在 mousedown 触发（button===0），
//    click 仅在键盘合成（detail===0）时兜底——与 dropdown 形态（click 执行）不同。
// 2. 假 view + DOM stub：mousedown 触发 → deleteBlockAt → tr 删除 frontmatter，
//    序列化结果不再含 frontmatter。
// 3. 对照组：公式块 dropdown 的删除（click 触发）应同样删除整块。
// 4. 文档仅剩 frontmatter 时删除回退空段落（replaceWith 分支，不传 schema 的场景）。
import { EditorState, Transaction } from "prosemirror-state"
import { Node as PMNode } from "prosemirror-model"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, parseMarkdown } from "../src/prosemirror/markdown"
import { createBlockMenuPlugin } from "../src/prosemirror/block-menu"
import { previewBlockOpMenuRegistration } from "../src/prosemirror/nodeviews/node-op-menu"

class FakeElement {
  tagName: string
  nodeType: number
  attrs: Record<string, string>
  children: FakeElement[]
  text: string
  parent: FakeElement | null
  listeners: Record<string, Array<(event: any) => void>>
  classSet: Set<string>

  constructor(tagName: string, nodeType: number, text?: string) {
    this.tagName = tagName
    this.nodeType = nodeType
    this.attrs = {}
    this.children = []
    this.text = text == null ? "" : text
    this.parent = null
    this.listeners = {}
    this.classSet = new Set()
  }

  setAttribute(name: string, value: string) {
    this.attrs[name] = value
    if (name === "class") {
      this.classSet = new Set(value.split(/\s+/).filter(Boolean))
    }
  }

  get className(): string {
    return Array.from(this.classSet).join(" ")
  }

  set innerHTML(value: string) {
    this.attrs["innerHTML"] = String(value)
  }

  get innerHTML(): string {
    return this.attrs["innerHTML"] || ""
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
}

// 注入最小 document stub，供 JSX h() 构建菜单 DOM
;(globalThis as any).document = {
  createElement: function (tag: string) {
    return new FakeElement(tag, 1)
  },
  createTextNode: function (text: string) {
    return new FakeElement("#text", 3, text)
  },
  querySelectorAll: function () {
    return [] as FakeElement[]
  },
  addEventListener: function () {},
  removeEventListener: function () {}
}

var failures = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log("PASS: " + label)
  } else {
    failures += 1
    console.log("FAIL: " + label)
  }
}

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

function walk(node: FakeElement, visit: (el: FakeElement) => void) {
  for (var i = 0; i < node.children.length; i += 1) {
    var child = node.children[i]
    if (child.nodeType === 1) {
      visit(child)
      walk(child, visit)
    }
  }
}

function findButtonByTitle(host: FakeElement, title: string): FakeElement | null {
  var found: FakeElement | null = null
  walk(host, function (el) {
    if (!found && el.tagName === "button" && el.attrs["title"] === title) {
      found = el
    }
  })
  return found
}

function fire(button: FakeElement, type: string, props: Record<string, any>) {
  var listeners = button.listeners[type] || []
  var event = Object.assign({
    button: 0,
    detail: 1,
    preventDefault: function () {},
    stopPropagation: function () {}
  }, props)
  for (var i = 0; i < listeners.length; i += 1) {
    listeners[i](event)
  }
}

// 构建首个命中预览块菜单并触发指定事件，返回操作后序列化文档
function runPreviewMenu(markdown: string, title: string, type: string): string {
  var doc = parseMarkdown(schema, parser, markdown)
  if (!doc) {
    throw new Error("parse failed for: " + markdown)
  }
  var state = EditorState.create({ schema: schema, doc: doc })
  var view: any = {
    state: state,
    dispatch: function (tr: Transaction) {
      view.state = view.state.apply(tr)
    },
    focus: function () {}
  }
  var target: { node: PMNode, pos: number } | null = null
  doc.forEach(function (child: PMNode, offset: number) {
    if (!target && previewBlockOpMenuRegistration.matches(child, doc)) {
      target = { node: child, pos: offset }
    }
  })
  if (!target) {
    throw new Error("no preview block matched in: " + markdown)
  }
  var matched = target as { node: PMNode, pos: number }
  var menuDom = previewBlockOpMenuRegistration.buildMenu({
    node: matched.node,
    pos: matched.pos,
    view: view
  }) as unknown as FakeElement
  var button = findButtonByTitle(menuDom, title)
  if (!button) {
    throw new Error("button not found: " + title)
  }
  fire(button, type, {})
  return serializer.serialize(view.state.doc)
}

// ---------- 1. frontmatter 单项按钮：mousedown 触发删除 ----------

var fmResult = runPreviewMenu("---\ntitle: a\nauthor: b\n---\n\nhello", "删除", "mousedown")
assert(fmResult.indexOf("title: a") === -1, "frontmatter deleted on mousedown")
assert(fmResult.indexOf("hello") !== -1, "following content kept after frontmatter delete")

// click 分支（handledOnMouseDown 后的 click / 键盘合成 click）不应重复删除
var fmResult2 = runPreviewMenu("---\ntitle: a\n---\n\nhello", "删除", "click")
assert(fmResult2.indexOf("title: a") !== -1, "real click (detail>0, no prior mousedown) does not delete")

// 键盘合成 click（detail===0）兜底删除
var fmResult3 = runPreviewMenu("---\ntitle: a\n---\n\nhello", "删除", "click")
// 上一条已确认不删；这条单独模拟 detail 0
var fmResult4 = (function () {
  var doc = parseMarkdown(schema, parser, "---\ntitle: a\n---\n\nhello")
  if (!doc) {
    throw new Error("parse failed")
  }
  var state = EditorState.create({ schema: schema, doc: doc })
  var view: any = {
    state: state,
    dispatch: function (tr: Transaction) { view.state = view.state.apply(tr) },
    focus: function () {}
  }
  var menuDom = previewBlockOpMenuRegistration.buildMenu({
    node: doc.firstChild as PMNode,
    pos: 0,
    view: view
  }) as unknown as FakeElement
  var button = findButtonByTitle(menuDom, "删除")
  if (!button) {
    throw new Error("button not found")
  }
  fire(button, "click", { detail: 0 })
  return serializer.serialize(view.state.doc)
})()
assert(fmResult4.indexOf("title: a") === -1, "synthetic click (detail 0) deletes frontmatter")

// ---------- 2. 文档仅剩 frontmatter：不传 schema，tr.delete 走 else 分支 ----------

var fmOnly = (function () {
  var doc = parseMarkdown(schema, parser, "---\ntitle: a\n---")
  if (!doc) {
    throw new Error("parse failed")
  }
  var state = EditorState.create({ schema: schema, doc: doc })
  var view: any = {
    state: state,
    dispatch: function (tr: Transaction) { view.state = view.state.apply(tr) },
    focus: function () {}
  }
  var menuDom = previewBlockOpMenuRegistration.buildMenu({
    node: doc.firstChild as PMNode,
    pos: 0,
    view: view
  }) as unknown as FakeElement
  var button = findButtonByTitle(menuDom, "删除")
  if (!button) {
    throw new Error("button not found")
  }
  fire(button, "mousedown", {})
  return { childCount: view.state.doc.childCount, firstType: view.state.doc.firstChild ? view.state.doc.firstChild.type.name : "" }
})()
assert(fmOnly.childCount >= 1, "deleting last frontmatter keeps doc non-empty")

// ---------- 3. 初始渲染时序：ctx.view 必须延迟求值 ----------

// PM 构造顺序（prosemirror-view EditorView constructor）：
//   初始 docView 渲染（调用 widget 工厂 buildMenu）→ plugin view() 回调（设置 view 引用）。
// 即首次构建菜单 ctx 时 view 引用尚未就绪。若 buildMenu 立即读取 view，
// 则「加载后未做任何编辑」前点击菜单（删除等）静默无反应——
// ctx.view 须为 getter，延迟到操作发生时求值。
var capturedCtx: any = null
var wrappedRegistration = {
  anchorInside: previewBlockOpMenuRegistration.anchorInside,
  matches: function (node: PMNode, parent: PMNode) {
    return previewBlockOpMenuRegistration.matches(node, parent)
  },
  buildMenu: function (ctx: any) {
    capturedCtx = ctx
    return previewBlockOpMenuRegistration.buildMenu(ctx)
  }
}
var fmDoc = parseMarkdown(schema, parser, "---\ntitle: a\n---\n\nhello")
if (!fmDoc) {
  throw new Error("parse failed")
}
var initState = EditorState.create({ schema: schema, doc: fmDoc })
var menuPlugin = createBlockMenuPlugin([wrappedRegistration])
var decoSet = (menuPlugin.props as any).decorations(initState)
var widgets = (decoSet ? (decoSet as any).find() : []).filter(function (d: any) { return d.from === d.to })
assert(widgets.length > 0, "frontmatter doc gets block menu widget")

var lateView: any = {
  state: initState,
  dispatch: function (tr: Transaction) { lateView.state = lateView.state.apply(tr) },
  focus: function () {}
}

// 按真实时序：先构建 widget DOM（buildMenu 被调用），后执行 plugin view() 设置 view 引用
var menuFromWidget = (widgets[0] as any).type.toDOM(lateView, function () { return 0 })
assert(!!menuFromWidget, "widget factory builds menu DOM")
;(menuPlugin.spec as any).view(lateView)
assert(capturedCtx && capturedCtx.view === lateView, "ctx.view resolves late (getter) after plugin view() runs")

// 端到端：初始时序下构建的菜单，view 就绪后 mousedown 删除生效
var delButton = findButtonByTitle(menuFromWidget as unknown as FakeElement, "删除")
if (!delButton) {
  throw new Error("button not found in widget menu")
}
fire(delButton, "mousedown", {})
assert(lateView.state.doc.childCount === 1, "initial-load menu delete works after view ready")
assert((lateView.state.doc.firstChild as PMNode).type.name !== "raw_block", "frontmatter removed by initial-load menu")

if (failures > 0) {
  console.log("FAILED: " + failures)
  process.exit(1)
}
console.log("ALL FRONTMATTER DELETE TESTS PASSED")