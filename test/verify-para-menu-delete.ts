// 段落/标题菜单删除项显隐验证（唯一顶层块语义）：
// 1. 文档仅剩一个段落时，段落菜单不提供删除按钮（删除会被空文档兜底重置为
//    空段落，等于纯清空，按钮无意义）；菜单其余项（H1-H6 切换、主按钮）不变。
// 2. 文档有多个顶层块时，段落菜单照常提供删除按钮，点击整块删除。
// 3. 标题菜单不受影响：文档仅剩一个标题时仍有删除按钮（删除标题回退空段落
//    是有意义的降级——去掉标题格式）。
// 4. view 尚未挂载（null）时按 ctx.doc 快照正确判断（首次构建 widget 时
//    viewRef 尚为 null，判断不依赖 view）。
// 菜单 widget 每次事务重建（block-menu 的 toDOM 每次都是新闭包），此判断随
// 文档变化自动生效，无需额外失效机制——本脚本通过多次 buildMenu 模拟。
// 运行：npx --yes tsx --import ./test/css-shim.mjs test/verify-para-menu-delete.ts
import { EditorState, Transaction } from "prosemirror-state"
import { Node as PMNode } from "prosemirror-model"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, parseMarkdown } from "../src/prosemirror/markdown"
import { createHeadingMenuRegistration } from "../src/prosemirror/heading-menu"
import { createParagraphMenuRegistration } from "../src/prosemirror/paragraph-menu"

class FakeElement {
  tagName: string
  nodeType: number
  attrs: Record<string, string>
  children: FakeElement[]
  text: string
  listeners: Record<string, Array<(event: any) => void>>
  classSet: Set<string>

  constructor(tagName: string, nodeType: number, text?: string) {
    this.tagName = tagName
    this.nodeType = nodeType
    this.attrs = {}
    this.children = []
    this.text = text == null ? "" : text
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

  get classList() {
    var self = this
    return {
      add: function (c: string) { self.classSet.add(c) },
      remove: function (c: string) { self.classSet.delete(c) },
      contains: function (c: string) { return self.classSet.has(c) },
      toggle: function (c: string) {
        if (self.classSet.has(c)) {
          self.classSet.delete(c)
        } else {
          self.classSet.add(c)
        }
      }
    }
  }

  set innerHTML(value: string) {
    this.attrs["innerHTML"] = String(value)
  }

  get innerHTML(): string {
    return this.attrs["innerHTML"] || ""
  }

  addEventListener(type: string, fn: (event: any) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = []
    }
    this.listeners[type].push(fn)
  }

  appendChild(child: FakeElement) {
    this.children.push(child)
    return child
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
  }
}

var failures = 0

function check(label: string, actual: any, expected: any) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures += 1
  }
  console.log((ok ? "PASS" : "FAIL") + " " + label + (ok ? "" : " -> expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)))
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

function clickButton(button: FakeElement) {
  var listeners = button.listeners["click"] || []
  for (var i = 0; i < listeners.length; i += 1) {
    listeners[i]({ preventDefault: function () {}, stopPropagation: function () {} })
  }
}

// 构建文档首个命中注册块的菜单 DOM（假 view：dispatch 即 state.apply）
function buildMenuFor(markdown: string, registrationKind: "paragraph" | "heading") {
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
  var registration = registrationKind === "paragraph"
    ? createParagraphMenuRegistration(schema)
    : createHeadingMenuRegistration(schema)
  if (!registration) {
    throw new Error("registration is null")
  }
  var target: { node: PMNode, pos: number } | null = null
  doc.forEach(function (child: PMNode, offset: number) {
    if (!target && registration.matches(child, doc)) {
      target = { node: child, pos: offset }
    }
  })
  if (!target) {
    throw new Error("no block matched in: " + markdown)
  }
  var matched = target as { node: PMNode, pos: number }
  var menuDom = registration.buildMenu({ node: matched.node, pos: matched.pos, doc: doc, view: view }) as unknown as FakeElement
  return { menuDom: menuDom, view: view }
}

// 1. 文档仅剩一个段落：无删除按钮，主按钮仍在
var single = buildMenuFor("唯一段落", "paragraph")
check("single paragraph: no delete button", !!findButtonByTitle(single.menuDom, "删除"), false)
check("single paragraph: toggle button still present", !!findButtonByTitle(single.menuDom, "段落操作"), true)

// 2. 多个顶层块：删除按钮在，点击整块删除
var multi = buildMenuFor("第一段\n\n第二段", "paragraph")
var multiDelete = findButtonByTitle(multi.menuDom, "删除")
check("two paragraphs: delete button present", !!multiDelete, true)
if (multiDelete) {
  clickButton(multiDelete)
  check("delete removes first paragraph", serializer.serialize(multi.view.state.doc), "第二段")
}

// 段落 + 标题混排：段落菜单仍有删除
var mixed = buildMenuFor("# 标题\n\n正文", "paragraph")
check("paragraph with heading: delete button present", !!findButtonByTitle(mixed.menuDom, "删除"), true)

// 3. 仅剩一个标题：标题菜单保留删除按钮（行为不变）
var singleHeading = buildMenuFor("# 唯一标题", "heading")
check("single heading: delete button still present", !!findButtonByTitle(singleHeading.menuDom, "删除"), true)

// 4. view 未挂载（null）：按 ctx.doc 快照判断，不依赖 view
//（首次构建 widget 时 viewRef 尚为 null，见 block-menu.ts 注释）
var doc = parseMarkdown(schema, parser, "唯一段落")
if (!doc) {
  throw new Error("parse failed")
}
var paraRegistration = createParagraphMenuRegistration(schema)
if (!paraRegistration) {
  throw new Error("paragraph registration is null")
}
var multiDoc = parseMarkdown(schema, parser, "第一段\n\n第二段")
if (!multiDoc) {
  throw new Error("parse failed for multi doc")
}
var nullViewMulti = paraRegistration.buildMenu({ node: multiDoc.firstChild!, pos: 0, doc: multiDoc, view: null }) as unknown as FakeElement
check("view not mounted, multi-block doc: delete button present", !!findButtonByTitle(nullViewMulti, "删除"), true)
var nullViewSingle = paraRegistration.buildMenu({ node: doc.firstChild!, pos: 0, doc: doc, view: null }) as unknown as FakeElement
check("view not mounted, single-block doc: no delete button", !!findButtonByTitle(nullViewSingle, "删除"), false)

if (failures > 0) {
  console.log("FAILED: " + failures)
  process.exit(1)
}
console.log("ALL PARAGRAPH MENU DELETE TESTS PASSED")