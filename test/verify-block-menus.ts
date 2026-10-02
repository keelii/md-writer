// 列表/引用/代码块 DecoMenu 验证：
// 1. decoration 匹配：顶层 bullet_list/ordered_list/blockquote/非 mermaid code_block 各挂一个
//    块前 widget；mermaid code_block 与嵌套列表不匹配；段落/标题不被这些注册命中。
// 2. 菜单操作（最小 DOM stub + 假 view，不依赖真实 EditorView）：
//    列表切换有序/无序保留内容；引用转正文整体上提；删除列表/引用/代码块整块删除；
//    文档仅剩一块时删除回退为空段落。
// 3. 代码块语言切换：主按钮显示当前语言扩展名（别名归一如 python→py，无语言为“文本”），当前语言项高亮；
//    点击语言候选写回 params（fence info），内容保留；切“纯文本”params 归 null。
// 4. 主按钮图标：列表主按钮显示当前列表类型 icon，引用主按钮显示 quote icon。
// 5. 光标/选区在块内：来源块 node decoration 追加 -active 常显类（CSS 免 hover
//    显示菜单的依据）；块边界位置严格不点亮；NodeSelection 选中整块点亮。
import { EditorState, NodeSelection, Selection, TextSelection, Transaction } from "prosemirror-state"
import { DecorationSet } from "prosemirror-view"
import { Node as PMNode } from "prosemirror-model"
import { SvgIcon } from "../src/icons"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, parseMarkdown } from "../src/prosemirror/markdown"
import { BlockMenuRegistration, createBlockMenuPlugin } from "../src/prosemirror/block-menu"
import { createListMenuRegistration } from "../src/prosemirror/list-menu"
import { createBlockquoteMenuRegistration } from "../src/prosemirror/blockquote-menu"
import { createCodeBlockMenuRegistration } from "../src/prosemirror/code-block-menu"

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
    // icon 按钮的内联 SVG 在 stub 中只记长度，结构不需要
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

function assertEqual(actual: any, expected: any, label: string) {
  if (actual === expected) {
    console.log("PASS: " + label)
  } else {
    failures += 1
    console.log("FAIL: " + label)
    console.log("  expected: " + JSON.stringify(expected))
    console.log("  actual:   " + JSON.stringify(actual))
  }
}

function assertDeepEqual(actual: any[], expected: any[], label: string) {
  var same = actual.length === expected.length
  for (var i = 0; same && i < actual.length; i += 1) {
    if (actual[i] !== expected[i]) {
      same = false
    }
  }
  if (same) {
    console.log("PASS: " + label)
  } else {
    failures += 1
    console.log("FAIL: " + label)
    console.log("  expected: " + JSON.stringify(expected))
    console.log("  actual:   " + JSON.stringify(actual))
  }
}

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

function buildRegistrations(): BlockMenuRegistration[] {
  var list = createListMenuRegistration(schema)
  var quote = createBlockquoteMenuRegistration(schema)
  var code = createCodeBlockMenuRegistration(schema)
  var out: BlockMenuRegistration[] = []
  if (list) {
    out.push(list)
  }
  if (quote) {
    out.push(quote)
  }
  if (code) {
    out.push(code)
  }
  return out
}

// 命中块的 widget（from == to）位置，块前锚形态下应等于块自身 offset
function widgetPositions(markdown: string): number[] {
  var doc = parseMarkdown(schema, parser, markdown)
  if (!doc) {
    throw new Error("parse failed for: " + markdown)
  }
  var state = EditorState.create({ schema: schema, doc: doc })
  var decorations = (createBlockMenuPlugin(buildRegistrations()).props as any).decorations(state)
  if (!decorations) {
    return []
  }
  var found = (decorations as DecorationSet).find()
  var positions: number[] = []
  for (var i = 0; i < found.length; i += 1) {
    if (found[i].from === found[i].to) {
      positions.push(found[i].from)
    }
  }
  return positions.sort(function (a, b) { return a - b })
}

function topLevelOffsets(markdown: string, typeNames: string[]): number[] {
  var doc = parseMarkdown(schema, parser, markdown)
  if (!doc) {
    throw new Error("parse failed for: " + markdown)
  }
  var offsets: number[] = []
  doc.forEach(function (child: PMNode, offset: number) {
    if (typeNames.indexOf(child.type.name) >= 0) {
      offsets.push(offset)
    }
  })
  return offsets
}

// ---------- 1. decoration 匹配 ----------

assertDeepEqual(widgetPositions("- a\n- b"), [0], "top-level bullet list gets one widget")
assertDeepEqual(widgetPositions("1. a\n2. b"), [0], "top-level ordered list gets one widget")
assertDeepEqual(widgetPositions("> quoted"), [0], "top-level blockquote gets one widget")
assertDeepEqual(widgetPositions("```js\ncode\n```"), [0], "top-level code block gets one widget")
assertDeepEqual(widgetPositions("```mermaid\ngraph TB\n```"), [], "mermaid code block not matched")
assertDeepEqual(widgetPositions("plain text"), [], "paragraph not matched")
assertDeepEqual(widgetPositions("# heading"), [], "heading not matched")
assertDeepEqual(widgetPositions("- a\n  - nested"), [0], "nested list inside list item not matched")

var combined = "intro\n\n- item\n\n> quote\n\n```js\ncode\n```"
assertDeepEqual(
  widgetPositions(combined),
  topLevelOffsets(combined, ["bullet_list", "blockquote", "code_block"]),
  "combined doc decorates list/blockquote/code block at their offsets"
)

// ---------- 2. 菜单操作（假 view + DOM stub 点击） ----------

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

// 用假 view 驱动菜单 run：dispatch 即 state.apply，focus 为空操作
function runMenuItem(markdown: string, buttonTitle: string): string {
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
  var registrations = buildRegistrations()
  var target: { node: PMNode, pos: number } | null = null
  doc.forEach(function (child: PMNode, offset: number) {
    if (!target) {
      for (var i = 0; i < registrations.length; i += 1) {
        if (registrations[i].matches(child, doc)) {
          target = { node: child, pos: offset }
          break
        }
      }
    }
  })
  if (!target) {
    throw new Error("no registration matched in: " + markdown)
  }
  var matched = target as { node: PMNode, pos: number }
  var menuDom: FakeElement | null = null
  for (var i = 0; i < registrations.length; i += 1) {
    if (registrations[i].matches(matched.node, doc)) {
      menuDom = registrations[i].buildMenu({ node: matched.node, pos: matched.pos, view: view }) as unknown as FakeElement
      break
    }
  }
  if (!menuDom) {
    throw new Error("buildMenu returned nothing")
  }
  var button = findButtonByTitle(menuDom, buttonTitle)
  if (!button) {
    throw new Error("button not found: " + buttonTitle)
  }
  clickButton(button)
  return serializer.serialize(view.state.doc)
}

assertEqual(runMenuItem("- first\n- second", "有序"), "1. first\n2. second", "bullet -> ordered keeps content")
assertEqual(runMenuItem("1. first\n2. second", "无序"), "* first\n* second", "ordered -> bullet keeps content")
assertEqual(runMenuItem("> quoted\n\nafter", "正文"), "quoted\n\nafter", "blockquote unwraps to paragraphs")
assertEqual(runMenuItem("> quoted\n\nafter", "删除"), "after", "delete blockquote removes whole block")
assertEqual(runMenuItem("- first\n\nafter", "删除"), "after", "delete list removes whole list")
assertEqual(runMenuItem("before\n\n```js\ncode\n```", "删除"), "before", "delete code block removes whole block")
assertEqual(runMenuItem("```js\ncode\n```", "删除"), "", "delete only block falls back to empty paragraph")

// ---------- 3. 代码块语言切换 ----------

function textOf(node: FakeElement): string {
  var out = node.nodeType === 3 ? node.text : ""
  for (var i = 0; i < node.children.length; i += 1) {
    out += textOf(node.children[i])
  }
  return out
}

// 构建首个顶层 code_block 的菜单 DOM（含假 view），供主按钮文字 / active 高亮断言
function buildCodeMenuFor(markdown: string): FakeElement {
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
  var registrations = buildRegistrations()
  var target: { node: PMNode, pos: number } | null = null
  doc.forEach(function (child: PMNode, offset: number) {
    if (!target && child.type.name === "code_block") {
      for (var i = 0; i < registrations.length; i += 1) {
        if (registrations[i].matches(child, doc)) {
          target = { node: child, pos: offset }
          break
        }
      }
    }
  })
  if (!target) {
    throw new Error("no code block in: " + markdown)
  }
  var matched = target as { node: PMNode, pos: number }
  for (var j = 0; j < registrations.length; j += 1) {
    if (registrations[j].matches(matched.node, doc)) {
      return registrations[j].buildMenu({ node: matched.node, pos: matched.pos, view: view }) as unknown as FakeElement
    }
  }
  throw new Error("no registration matched code block")
}

var jsMenu = buildCodeMenuFor("```js\nconsole.log(1)\n```")
var jsToggle = findButtonByTitle(jsMenu, "切换代码块语言")
assertEqual(jsToggle ? textOf(jsToggle) : "", "js", "toggle shows current fence word")
var jsActive = findButtonByTitle(jsMenu, "JavaScript")
assertEqual(!!jsActive && jsActive.classList.contains("md-editor-block-op-menu-item-active"), true, "current language item highlighted")
var pyItem = findButtonByTitle(jsMenu, "Python")
assertEqual(!!pyItem && pyItem.classList.contains("md-editor-block-op-menu-item-active"), false, "other language item not highlighted")
var jsDividerCount = 0
walk(jsMenu, function (el) {
  if (el.tagName === "div" && el.className === "md-editor-block-op-menu-divider") {
    jsDividerCount += 1
  }
})
assertEqual(jsDividerCount, 1, "one divider between language list and delete")

var plainMenu = buildCodeMenuFor("```\ncode\n```")
var plainToggle = findButtonByTitle(plainMenu, "切换代码块语言")
assertEqual(plainToggle ? textOf(plainToggle) : "", "文本", "no-language toggle shows 文本")
var plainActive = findButtonByTitle(plainMenu, "纯文本")
assertEqual(!!plainActive && plainActive.classList.contains("md-editor-block-op-menu-item-active"), true, "纯文本 item highlighted for no-language block")

assertEqual(runMenuItem("```js\ncode\n```", "Python"), "```py\ncode\n```", "switch language keeps content")
assertEqual(runMenuItem("```\ncode\n```", "Go"), "```go\ncode\n```", "plain code block gains language")
assertEqual(runMenuItem("```ts\ncode\n```", "纯文本"), "```\ncode\n```", "switch to 纯文本 clears params")

// ---------- 4. 主按钮图标（列表/引用显示块类型 icon，代码块语言归一） ----------

// 构建文档首个可匹配块的菜单 DOM，供主按钮形态断言
function buildFirstMenuFor(markdown: string): FakeElement {
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
  var registrations = buildRegistrations()
  var target: { node: PMNode, pos: number } | null = null
  doc.forEach(function (child: PMNode, offset: number) {
    if (!target) {
      for (var i = 0; i < registrations.length; i += 1) {
        if (registrations[i].matches(child, doc)) {
          target = { node: child, pos: offset }
          break
        }
      }
    }
  })
  if (!target) {
    throw new Error("no registration matched in: " + markdown)
  }
  var matched = target as { node: PMNode, pos: number }
  for (var j = 0; j < registrations.length; j += 1) {
    if (registrations[j].matches(matched.node, doc)) {
      return registrations[j].buildMenu({ node: matched.node, pos: matched.pos, view: view }) as unknown as FakeElement
    }
  }
  throw new Error("buildMenu returned nothing")
}

var bulletMenu = buildFirstMenuFor("- first\n- second")
var bulletToggle = findButtonByTitle(bulletMenu, "无序列表操作")
assertEqual(!!bulletToggle && bulletToggle.attrs["innerHTML"] === SvgIcon.list, true, "bullet list toggle shows bullet icon")

var orderedMenu = buildFirstMenuFor("1. first\n2. second")
var orderedToggle = findButtonByTitle(orderedMenu, "有序列表操作")
assertEqual(!!orderedToggle && orderedToggle.attrs["innerHTML"] === SvgIcon.listOrdered, true, "ordered list toggle shows ordered icon")

var quoteMenu = buildFirstMenuFor("> quoted")
var quoteToggle = findButtonByTitle(quoteMenu, "引用块操作")
assertEqual(!!quoteToggle && quoteToggle.attrs["innerHTML"] === SvgIcon.quote, true, "blockquote toggle shows quote icon")

// 语言别名归一：python → 主按钮与高亮均按扩展名 py 处理
var pyAliasMenu = buildCodeMenuFor("```python\ncode\n```")
var pyAliasToggle = findButtonByTitle(pyAliasMenu, "切换代码块语言")
assertEqual(pyAliasToggle ? textOf(pyAliasToggle) : "", "py", "python alias toggle shows py")
var pyAliasActive = findButtonByTitle(pyAliasMenu, "Python")
assertEqual(!!pyAliasActive && pyAliasActive.classList.contains("md-editor-block-op-menu-item-active"), true, "python alias highlights Python item")

// ---------- 5. 光标在块内：来源块加 -active 常显类 ----------

// 返回文档中全部 node decoration（from < to）的 class 列表，按文档顺序排列
function sourceClasses(markdown: string, selection: Selection): string[] {
  var doc = parseMarkdown(schema, parser, markdown)
  if (!doc) {
    throw new Error("parse failed for: " + markdown)
  }
  var state = EditorState.create({ schema: schema, doc: doc, selection: selection })
  var decorations = (createBlockMenuPlugin(buildRegistrations()).props as any).decorations(state)
  if (!decorations) {
    return []
  }
  var found = (decorations as DecorationSet).find()
  var decorated: Array<{from: number, className: string}> = []
  for (var i = 0; i < found.length; i += 1) {
    if (found[i].from < found[i].to) {
      decorated.push({from: found[i].from, className: (found[i] as any).type.attrs.class})
    }
  }
  decorated.sort(function (a, b) { return a.from - b.from })
  return decorated.map(function (item) { return item.className })
}

function hasActive(className: string): boolean {
  return className.indexOf("md-editor-block-menu-source-active") >= 0
}

// 文档结构：列表（首位）+ 引用 + 代码块，位置由文档结构推导
var selMarkdown = "- a\n- b\n\n> quote\n\n```js\ncode\n```"
var selDoc = parseMarkdown(schema, parser, selMarkdown)
if (!selDoc) {
  throw new Error("parse failed for: " + selMarkdown)
}
var listPos = 0
var quotePos = listPos + (selDoc as PMNode).child(0).nodeSize
var codePos = quotePos + (selDoc as PMNode).child(1).nodeSize

// 光标在列表首项文本内（bullet_list > list_item > paragraph 文本起点 +1+1）
var inList = sourceClasses(selMarkdown, TextSelection.create(selDoc as PMNode, 3))
assertEqual(inList.length, 3, "cursor inside doc decorates all three source blocks")
assertEqual(hasActive(inList[0]), true, "cursor in list: list source block active")
assertEqual(hasActive(inList[1]), false, "cursor in list: blockquote source block not active")
assertEqual(hasActive(inList[2]), false, "cursor in list: code block source block not active")
assertEqual(inList[0].indexOf("md-editor-block-menu-source") >= 0, true, "active block keeps base source class")

// 光标在代码块内容内
var inCode = sourceClasses(selMarkdown, TextSelection.create(selDoc as PMNode, codePos + 1))
assertEqual(hasActive(inCode[2]) && !hasActive(inCode[0]) && !hasActive(inCode[1]), true, "cursor in code block: only code source block active")

// 块边界位置（前块终点 = 后块起点）严格不点亮任何块
var atBoundary = sourceClasses(selMarkdown, TextSelection.create(selDoc as PMNode, codePos))
assertEqual(!hasActive(atBoundary[0]) && !hasActive(atBoundary[1]) && !hasActive(atBoundary[2]), true, "cursor at block boundary lights nothing up")

// 跨块文本选区：两端点所在块点亮，中间被完全覆盖的块不点亮
var spanSelection = TextSelection.create(selDoc as PMNode, 3, codePos + 2)
var spanClasses = sourceClasses(selMarkdown, spanSelection)
assertEqual(hasActive(spanClasses[0]) && !hasActive(spanClasses[1]) && hasActive(spanClasses[2]), true, "spanning selection lights endpoint blocks only")

// NodeSelection 整块选中代码块（点击 atom 预览块的同款形态）
var nodeSelected = sourceClasses(selMarkdown, NodeSelection.create(selDoc as PMNode, codePos))
assertEqual(hasActive(nodeSelected[2]) && !hasActive(nodeSelected[0]) && !hasActive(nodeSelected[1]), true, "node selection on code block lights it up")

// 光标在无菜单注册的段落：列表不点亮（该文档仅有列表注册命中）
var paraMarkdown = "plain\n\n- a\n- b"
var paraDoc = parseMarkdown(schema, parser, paraMarkdown)
if (!paraDoc) {
  throw new Error("parse failed for: " + paraMarkdown)
}
var inParagraph = sourceClasses(paraMarkdown, TextSelection.create(paraDoc, 1))
assertEqual(inParagraph.length, 1, "paragraph doc decorates only the list")
assertEqual(!inParagraph.some(hasActive), true, "cursor in paragraph lights no source block")

if (failures > 0) {
  console.log("FAILED: " + failures)
  process.exit(1)
}
console.log("ALL BLOCK MENU TESTS PASSED")