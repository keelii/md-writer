// 段落/标题菜单验证：顶层段落与顶层 heading 各自由独立注册装饰（paragraph-menu /
// heading-menu），列表/表格/引用内的段落不应有装饰，单图段落由图片菜单接管、
// 不命中段落菜单。装饰由 block-menu 核心生成：每个命中的块 = 一个 node decoration
//（source 类）+ 一个 widget 装饰。
// 菜单面板：段落面板在类型切换（正文/H1-H6/删除）之外追加「引用/列表/表格」
// 三个块形态转换项（标题面板不追加）；转换操作用假 view 驱动：
// 引用/列表包裹原段落内容，表格空段原位替换、非空段插其后且内容保留。
import { EditorState, TextSelection, Transaction } from "prosemirror-state"
import { SvgIcon } from "../src/icons"
import { DecorationSet } from "prosemirror-view"
import { Node as PMNode } from "prosemirror-model"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, parseMarkdown } from "../src/prosemirror/markdown"
import { createHeadingMenuRegistration } from "../src/prosemirror/heading-menu"
import { createParagraphMenuRegistration } from "../src/prosemirror/paragraph-menu"
import { createBlockMenuPlugin, BlockMenuRegistration } from "../src/prosemirror/block-menu"

class FakeElement {
  tagName: string
  nodeType: number
  attrs: Record<string, string>
  children: FakeElement[]
  text: string
  listeners: Record<string, Array<(event: any) => void>>
  classSet: Set<string>
  // utils.tsx 的 class 操作走 classList，stub 需提供同名接口（内部仍由 classSet 支撑）
  classList: {
    contains: (name: string) => boolean
    add: (name: string) => void
    remove: (name: string) => void
    toggle: (name: string, force?: boolean) => void
  }

  constructor(tagName: string, nodeType: number, text?: string) {
    this.tagName = tagName
    this.nodeType = nodeType
    this.attrs = {}
    this.children = []
    this.text = text == null ? "" : text
    this.listeners = {}
    this.classSet = new Set()
    var self = this
    this.classList = {
      contains: function (name: string) { return self.classSet.has(name) },
      add: function (name: string) { self.classSet.add(name) },
      remove: function (name: string) { self.classSet.delete(name) },
      toggle: function (name: string, force?: boolean) {
        var on = force == null ? !self.classSet.has(name) : !!force
        if (on) {
          self.classSet.add(name)
        } else {
          self.classSet.delete(name)
        }
      }
    }
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

// 数组等引用类型断言：=== 恒为 false，须按序列化内容比较
function assertEqualDeep(actual: any, expected: any, label: string) {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), label)
}

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

function getDecoratedPos(markdown: string) {
  var headingRegistration = createHeadingMenuRegistration(schema)
  var paragraphRegistration = createParagraphMenuRegistration(schema)
  if (!headingRegistration || !paragraphRegistration) {
    throw new Error("registration is null")
  }
  var plugin = createBlockMenuPlugin([headingRegistration, paragraphRegistration])
  var doc = parseMarkdown(schema, parser, markdown)
  if (!doc) {
    throw new Error("parse failed for: " + markdown)
  }
  var state = EditorState.create({ schema: schema, doc: doc })
  var decorations = (plugin.props as any).decorations(state)
  if (!decorations) {
    return []
  }
  var set = decorations as DecorationSet
  var found = set.find()
  var positions: number[] = []
  for (var i = 0; i < found.length; i += 1) {
    // 只取菜单 widget（点装饰 from == to），忽略来源块的 node decoration
    if (found[i].from === found[i].to) {
      positions.push(found[i].from)
    }
  }
  return positions.sort(function (a, b) { return a - b })
}

// 两个顶层段落 + 一个 heading：应有 3 个 widget（2 段落 + 1 标题）
var p1 = getDecoratedPos("# 标题\n\n第一段\n\n第二段")
assertEqual(p1.length, 3, "heading + 2 paragraphs => 3 widgets")
assertEqual(p1[0], 1, "heading widget pos 1")
assertEqual(p1[1], 5, "first paragraph widget pos 5")
assertEqual(p1[2], 10, "second paragraph widget pos 10")

// 列表内的段落：顶层列表项不算段落装饰，仅顶层无段落
var p2 = getDecoratedPos("- a\n- b")
assertEqual(p2.length, 0, "list items produce no paragraph widgets")

// 引用块内段落不装饰
var p3 = getDecoratedPos("> quoted")
assertEqual(p3.length, 0, "blockquote paragraph produces no widget")

// 表格单元格内段落不装饰
var p4 = getDecoratedPos("| a | b |\n| --- | --- |\n| c | d |")
assertEqual(p4.length, 0, "table cell paragraph produces no widget")

// 单图独占段落：由图片菜单接管，不命中段落/标题菜单
var p5 = getDecoratedPos("![alt](https://example.com/a.png)")
assertEqual(p5.length, 0, "image-only paragraph produces no paragraph widget")

// ---------- 菜单面板项 ----------

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

// 正文类型项无 title（label 为空，仅 pilcrow icon），需按 icon 定位；
// toggle 主按钮的 icon 是直接 innerHTML 属性而非 icon span 子元素，不会误匹配
function findButtonByIcon(host: FakeElement, icon: string): FakeElement | null {
  var found: FakeElement | null = null
  walk(host, function (el) {
    if (found || el.tagName !== "button") {
      return
    }
    var matched = false
    walk(el, function (child) {
      if (child.className === "md-editor-block-op-menu-icon" && child.innerHTML === icon) {
        matched = true
      }
    })
    if (matched) {
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

// 假 view：dispatch 即 state.apply，focus 为空操作
function fakeView(markdown: string) {
  var doc = parseMarkdown(schema, parser, markdown)
  if (!doc) {
    throw new Error("parse failed for: " + markdown)
  }
  return fakeViewFromDoc(doc)
}

function fakeViewFromDoc(doc: PMNode) {
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

// 构建文档首个顶层段落/标题的菜单 DOM
function buildMenuFor(registration: BlockMenuRegistration | null, view: any): FakeElement {
  if (!registration) {
    throw new Error("registration is null")
  }
  var doc = view.state.doc
  var target: { node: PMNode, pos: number } | null = null
  doc.forEach(function (child: PMNode, offset: number) {
    if (!target && registration.matches(child, doc)) {
      target = { node: child, pos: offset }
    }
  })
  if (!target) {
    throw new Error("no matching block")
  }
  var matched = target as { node: PMNode, pos: number }
  return registration.buildMenu({
    node: matched.node,
    pos: matched.pos,
    view: view,
    doc: doc
  } as any) as unknown as FakeElement
}

// 点击指定 title 的面板项，返回操作后的文档结构描述（顶层块类型名序列）
function runTransformItem(markdown: string, buttonTitle: string, serialize: boolean): any {
  var view = fakeView(markdown)
  var menu = buildMenuFor(createParagraphMenuRegistration(schema), view)
  var button = findButtonByTitle(menu, buttonTitle)
  if (!button) {
    throw new Error("button not found: " + buttonTitle)
  }
  clickButton(button)
  if (serialize) {
    return serializer.serialize(view.state.doc)
  }
  var names: string[] = []
  view.state.doc.forEach(function (child: PMNode) {
    names.push(child.type.name)
  })
  return names
}

// 段落面板：类型项 + 三个转换项 + 删除（多块文档）。
// 当前已是正文：类型项省略「正文」（toggle 主按钮的 pilcrow 已表达当前类型），
// 仅列 H1-H6
var paraMenu = buildMenuFor(createParagraphMenuRegistration(schema), fakeView("第一段\n\n第二段"))
assertEqual(!!findButtonByIcon(paraMenu, SvgIcon.pilcrow), false, "paragraph panel omits 正文 item (already a paragraph)")
assertEqual(!!findButtonByTitle(paraMenu, "三级标题"), true, "paragraph panel has 三级标题 item")
assertEqual(!!findButtonByTitle(paraMenu, "引用内容"), true, "paragraph panel has 引用内容 item")
assertEqual(!!findButtonByTitle(paraMenu, "有序列表"), true, "paragraph panel has 有序列表 item")
assertEqual(!!findButtonByTitle(paraMenu, "表格数据"), true, "paragraph panel has 表格数据 item")
assertEqual(!!findButtonByTitle(paraMenu, "删除段落"), true, "paragraph panel has 删除段落 item (multi-block doc)")

// 文档仅剩唯一段落：删除项省略，转换项保留
var singleMenu = buildMenuFor(createParagraphMenuRegistration(schema), fakeView("唯一段落"))
assertEqual(!!findButtonByTitle(singleMenu, "删除段落"), false, "single-block doc omits 删除段落 item")
assertEqual(!!findButtonByTitle(singleMenu, "表格数据"), true, "single-block doc keeps transform items")

// 标题面板不追加转换项，但含「转为正文」项（pilcrow icon）
var headingMenu = buildMenuFor(createHeadingMenuRegistration(schema), fakeView("# 标题\n\n段落"))
assertEqual(!!findButtonByTitle(headingMenu, "引用内容"), false, "heading panel has no 引用内容 item")
assertEqual(!!findButtonByTitle(headingMenu, "表格数据"), false, "heading panel has no 表格数据 item")
assertEqual(!!findButtonByIcon(headingMenu, SvgIcon.pilcrow), true, "heading panel has 正文 (pilcrow) item")

// 段落面板主按钮图标：非空段落用段落符 pilcrow，删除项 icon 后显示可见文字「删除段落」
var paraToggle = findButtonByTitle(paraMenu, "段落操作")
assertEqual(paraToggle ? paraToggle.innerHTML === SvgIcon.pilcrow : false, true, "non-empty paragraph toggle uses pilcrow icon")

// 空段落主按钮用羽毛 feather 图标（起笔意象）
var emptyParaMenu = buildMenuFor(createParagraphMenuRegistration(schema), fakeView(""))
var emptyParaToggle = findButtonByTitle(emptyParaMenu, "段落操作")
assertEqual(emptyParaToggle ? emptyParaToggle.innerHTML === SvgIcon.feather : false, true, "empty paragraph toggle uses feather icon")
var deleteButton = findButtonByTitle(paraMenu, "删除段落")
var deleteText = ""
if (deleteButton) {
  for (var di = 0; di < deleteButton.children.length; di += 1) {
    var dchild = deleteButton.children[di]
    if (dchild.nodeType === 3) {
      deleteText = dchild.text
    }
  }
}
assertEqual(deleteText, "删除段落", "delete item shows visible label after icon")

// 转换项/删除项前各有一条分组分隔线
var dividerCount = 0
walk(paraMenu, function (el) {
  if (el.tagName === "div" && el.className === "md-editor-block-op-menu-divider") {
    dividerCount += 1
  }
})
assertEqual(dividerCount, 2, "dividers before transform items and delete item")

// ---------- 转换操作 ----------

// 引用：段落包进 blockquote，内容保留
assertEqual(runTransformItem("第一段\n\n第二段", "引用内容", true), "> 第一段\n\n第二段", "引用内容 wraps paragraph in blockquote")

// 列表：段落包进 bullet_list，内容保留
assertEqual(runTransformItem("第一段\n\n第二段", "有序列表", true), "* 第一段\n\n第二段", "有序列表 wraps paragraph in bullet list")

// 表格：非空段落保留内容、表格插在其后
assertEqualDeep(runTransformItem("第一段\n\n第二段", "表格数据", false), ["paragraph", "table", "paragraph"], "表格数据 keeps non-empty paragraph and inserts table after it")

// 表格：空段落原位替换为表格（markdown 解析不出空段落，直接构建 doc）
var emptyParaDocType = schema.nodes.doc
var emptyParaDoc = emptyParaDocType.create(null, [
  schema.nodes.paragraph.create(),
  schema.nodes.paragraph.create(null, [schema.text("第二段")])
])
var emptyParaView = fakeViewFromDoc(emptyParaDoc)
var emptyParaMenu = buildMenuFor(createParagraphMenuRegistration(schema), emptyParaView)
var emptyParaButton = findButtonByTitle(emptyParaMenu, "表格数据")
if (!emptyParaButton) {
  throw new Error("表格数据 button not found")
}
clickButton(emptyParaButton)
var emptyParaNames: string[] = []
emptyParaView.state.doc.forEach(function (child: PMNode) {
  emptyParaNames.push(child.type.name)
})
assertEqualDeep(emptyParaNames, ["table", "paragraph"], "表格 replaces empty paragraph in place")

// 表格后光标落首格（table > table_head > table_row > table_header 内容起点）
var tableView = fakeView("第一段\n\n第二段")
var tableMenu = buildMenuFor(createParagraphMenuRegistration(schema), tableView)
clickButton(findButtonByTitle(tableMenu, "表格数据") as FakeElement)
var sel = tableView.state.selection
assertEqual(sel instanceof TextSelection && sel.$from.depth >= 4, true, "cursor lands inside first table cell")

if (failures > 0) {
  console.log("FAILED: " + failures)
  process.exit(1)
}
console.log("ALL PARAGRAPH MENU TESTS PASSED")