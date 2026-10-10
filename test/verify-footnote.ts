// 脚注渲染端到端验证：
// 1. kinds 分类与解析：getRawBlockKind 识别脚注定义块（不干扰 math/frontmatter/svg），
//    parseFootnoteRawBlockSource 剥掉续行一层缩进，parseFootnoteRawInlineSource 只认 [^label]。
// 2. markdown 往返：行内 `[^1]` 解析为 raw_inline、定义块为 raw_block，序列化还原原文。
// 3. isPreviewBlock 覆盖脚注定义块（整删保护 / op menu 语义随之生效）。
// 4. NodeView DOM：定义块卡片（label 徽标 + 定义文本 + body class）、行内 sup 上标、
//    update 跨 kind 返回 false。
// 5. op menu 删除：脚注定义块命中预览块菜单，mousedown 整块删除。
import { EditorState, Transaction } from "prosemirror-state"
import { Node as PMNode } from "prosemirror-model"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, parseMarkdown } from "../src/prosemirror/markdown"
import {
  getRawBlockKind,
  isPreviewBlock,
  parseFootnoteRawBlockSource,
  parseFootnoteRawInlineSource
} from "../src/prosemirror/nodeviews/kinds"
import { createFootnoteRawBlockNodeView, createFootnoteRefRawInlineNodeView } from "../src/prosemirror/nodeviews/widgets/footnote"
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
  classList: any

  constructor(tagName: string, nodeType: number, text?: string) {
    this.tagName = tagName
    this.nodeType = nodeType
    this.attrs = {}
    this.children = []
    this.text = text == null ? "" : text
    this.parent = null
    this.listeners = {}
    this.classSet = new Set()
    var self = this
    this.classList = {
      add: function () {
        for (var i = 0; i < arguments.length; i += 1) {
          self.classSet.add(arguments[i])
        }
      },
      remove: function () {
        for (var i = 0; i < arguments.length; i += 1) {
          self.classSet.delete(arguments[i])
        }
      },
      contains: function (name: string) {
        return self.classSet.has(name)
      },
      toggle: function (name: string) {
        if (self.classSet.has(name)) {
          self.classSet.delete(name)
        } else {
          self.classSet.add(name)
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

  set className(value: string) {
    this.setAttribute("class", value)
  }

  // NodeView 重渲染前会 body.textContent = "" 清空再重建，stub 须模拟该语义
  set textContent(value: string) {
    this.children = []
    this.text = String(value)
  }

  get textContent(): string {
    var out = this.text || ""
    for (var i = 0; i < this.children.length; i += 1) {
      out += this.children[i].textContent
    }
    return out
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

// 注入最小 document stub，供 JSX h() 构建脚注卡片 / 菜单 DOM
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

// ---------- 1. kinds 分类与解析 ----------

assert(getRawBlockKind("[^1]: 脚注定义") === "footnote", "getRawBlockKind recognizes footnote block")
assert(getRawBlockKind("[^note]: with spaces in label") === "footnote", "footnote label may contain spaces")
assert(getRawBlockKind("$$\nx^2\n$$") === "math", "math kind unaffected by footnote branch")
assert(getRawBlockKind("---\ntitle: a\n---") === "frontmatter", "frontmatter kind unaffected")
assert(getRawBlockKind("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>") === "svg", "svg kind unaffected")
assert(getRawBlockKind("plain text") === "", "plain text still unclassified")
assert(getRawBlockKind("[^broken label") !== "footnote", "malformed footnote marker not classified")

var parsedBlock = parseFootnoteRawBlockSource("[^1]: first line\n    second (4 spaces)\n\tthird (tab)\n\n    tail")
assert(parsedBlock !== null, "parseFootnoteRawBlockSource succeeds")
if (parsedBlock) {
  assert(parsedBlock.label === "1", "footnote block label extracted")
  assert(parsedBlock.lines.length === 5, "footnote block keeps all lines")
  assert(parsedBlock.lines[0] === "first line", "first body line after label")
  assert(parsedBlock.lines[1] === "second (4 spaces)", "4-space continuation de-indented")
  assert(parsedBlock.lines[2] === "third (tab)", "tab continuation de-indented")
  assert(parsedBlock.lines[3] === "", "blank line kept")
  assert(parsedBlock.lines[4] === "tail", "next continuation de-indented")
}
assert(parseFootnoteRawBlockSource("not a footnote") === null, "parseFootnoteRawBlockSource rejects plain text")

assert(parseFootnoteRawInlineSource("[^1]") !== null, "inline footnote reference parses")
var parsedInline = parseFootnoteRawInlineSource("[^note-a]")
assert(parsedInline !== null && parsedInline.label === "note-a", "inline footnote label extracted")
assert(parseFootnoteRawInlineSource("$x$") === null, "math inline not mistaken for footnote")
assert(parseFootnoteRawInlineSource("[1]") === null, "plain bracket reference not mistaken for footnote")
assert(parseFootnoteRawInlineSource("[^1]:") === null, "footnote definition not mistaken for inline ref")

// ---------- 2. markdown 往返 ----------

var md = "Text with a reference[^1].\n\n[^1]: first line\n    second line\n\nafter block"
var doc = parseMarkdown(schema, parser, md)
if (!doc) {
  throw new Error("parse failed")
}

function findFootnoteNode(docNode: PMNode, pred: (n: PMNode) => boolean): PMNode | null {
  var found: PMNode | null = null
  docNode.descendants(function (node: PMNode) {
    if (!found && pred(node)) {
      found = node
    }
    return true
  })
  return found
}

var inlineFound = findFootnoteNode(doc, function (node: PMNode) {
  return node.type.name === "raw_inline" && node.textContent === "[^1]"
})
var blockFound = findFootnoteNode(doc, function (node: PMNode) {
  return node.type.name === "raw_block" && getRawBlockKind(node.textContent) === "footnote"
})
assert(inlineFound !== null, "inline footnote reference parsed as raw_inline [^1]")
assert(blockFound !== null, "footnote definition parsed as raw_block with footnote kind")
assert(blockFound !== null && blockFound.textContent === "[^1]: first line\n    second line", "footnote block text keeps continuation line")

var roundtrip = serializer.serialize(doc)
assert(roundtrip === md, "footnote markdown round-trips exactly")
assert(parseFootnoteRawInlineSource(inlineFound ? inlineFound.textContent : "") !== null, "inline node text parses as footnote ref")

// ---------- 3. isPreviewBlock 覆盖脚注定义块 ----------

assert(blockFound !== null && isPreviewBlock(blockFound), "footnote block is a preview block (delete protection)")
var plainBlock = schema.nodes.raw_block.createAndFill({}, schema.text("plain"))
assert(plainBlock !== null && !isPreviewBlock(plainBlock), "plain raw_block is not a preview block")

// ---------- 4. NodeView DOM ----------

function textOf(el: FakeElement): string {
  var out = el.text || ""
  for (var i = 0; i < el.children.length; i += 1) {
    out += textOf(el.children[i])
  }
  return out
}

if (blockFound) {
  var nv = createFootnoteRawBlockNodeView(blockFound)
  assert(nv !== null, "footnote block NodeView created")
  if (nv) {
    var dom = nv.dom as unknown as FakeElement
    assert(dom.tagName === "div" && dom.classSet.has("md-editor-raw-preview"), "footnote card uses raw preview shell")
    var body = dom.children[0]
    assert(body !== undefined && body.classSet.has("md-editor-raw-footnote-preview"), "footnote body class applied")
    assert(body !== undefined && body.children.length === 2, "footnote card has label + text children")
    var labelEl = body ? body.children[0] : null
    var textEl = body ? body.children[1] : null
    assert(labelEl !== null && labelEl.tagName === "span" && labelEl.classSet.has("md-editor-footnote-label") && textOf(labelEl) === "1", "label badge shows footnote label")
    assert(textEl !== null && textEl.tagName === "div" && textOf(textEl) === "first line\nsecond line", "definition text de-indented and joined")

    // 同 kind 文本变化：原地重渲染
    var nextText = "[^2]: changed"
    var nextNode = schema.nodes.raw_block.createAndFill({}, schema.text(nextText))
    assert(nextNode !== null && nv.update(nextNode) === true, "same-kind update reuses NodeView")
    var reTextEl = body ? body.children[1] : null
    assert(reTextEl !== null && reTextEl !== textEl && textOf(reTextEl) === "changed", "same-kind update re-renders text")

    // 跨 kind 变化：返回 false 交回分派器
    var mathNode = schema.nodes.raw_block.createAndFill({}, schema.text("$$\nx\n$$"))
    assert(mathNode !== null && nv.update(mathNode) === false, "cross-kind update returns false")

    // 非脚注文本：工厂返回 null
    var plainNode = schema.nodes.raw_block.createAndFill({}, schema.text("plain"))
    assert(plainNode !== null && createFootnoteRawBlockNodeView(plainNode) === null, "factory rejects non-footnote block")
  }
}

if (inlineFound) {
  var refNv = createFootnoteRefRawInlineNodeView(inlineFound)
  assert(refNv !== null, "inline footnote NodeView created")
  if (refNv) {
    var refDom = refNv.dom as unknown as FakeElement
    assert(refDom.tagName === "sup" && refDom.classSet.has("md-editor-raw-inline-footnote"), "inline footnote renders as sup")
    assert(refDom.attrs["contenteditable"] === "false", "inline footnote is read-only")
    assert(textOf(refDom) === "1", "sup shows the label")

    var nextRef = schema.nodes.raw_inline.createAndFill({}, schema.text("[^7]"))
    assert(nextRef !== null && refNv.update(nextRef) === true, "inline footnote update accepted")
    assert(textOf(refDom) === "7", "inline footnote update refreshes label")

    var mathInline = schema.nodes.raw_inline.createAndFill({}, schema.text("$x$"))
    assert(mathInline !== null && refNv.update(mathInline) === false, "inline factory update rejects math")
    assert(mathInline !== null && createFootnoteRefRawInlineNodeView(mathInline) === null, "inline factory rejects math raw_inline")
  }
}

// ---------- 5. op menu 删除 ----------

function runPreviewMenuDelete(markdown: string): string {
  var menuDoc = parseMarkdown(schema, parser, markdown)
  if (!menuDoc) {
    throw new Error("parse failed for: " + markdown)
  }
  var state = EditorState.create({ schema: schema, doc: menuDoc })
  var view: any = {
    state: state,
    dispatch: function (tr: Transaction) {
      view.state = view.state.apply(tr)
    },
    focus: function () {}
  }
  var target: { node: PMNode, pos: number } | null = null
  menuDoc.forEach(function (child: PMNode, offset: number) {
    if (!target && previewBlockOpMenuRegistration.matches(child, menuDoc)) {
      target = { node: child, pos: offset }
    }
  })
  if (!target) {
    throw new Error("no preview block matched in: " + markdown)
  }
  var matched = target as { node: PMNode, pos: number }
  assert(getRawBlockKind(matched.node.textContent) === "footnote", "op menu targets the footnote block")
  var menuDom = previewBlockOpMenuRegistration.buildMenu({
    doc: menuDoc,
    node: matched.node,
    pos: matched.pos,
    view: view
  }) as unknown as FakeElement
  var toggle: FakeElement | null = null
  var button: FakeElement | null = null
  ;(function walk(el: FakeElement) {
    for (var i = 0; i < el.children.length; i += 1) {
      var child = el.children[i]
      if (child.nodeType === 1) {
        if (!toggle && child.tagName === "button" && child.attrs["title"] === "脚注操作") {
          toggle = child
        }
        if (!button && child.tagName === "button" && child.classSet.has("md-editor-block-op-menu-item") && child.attrs["title"] === "删除") {
          button = child
        }
        walk(child)
      }
    }
  })(menuDom)
  // dropdown 形态：主按钮 title 为「脚注操作」，删除在面板行（click 执行）
  assert(toggle !== null, "footnote dropdown toggle uses footnote title")
  if (!button) {
    throw new Error("delete button not found")
  }
  var deleteButton = button as FakeElement
  var listeners = deleteButton.listeners["click"] || []
  var event = {
    button: 0,
    detail: 1,
    preventDefault: function () {},
    stopPropagation: function () {}
  }
  for (var i = 0; i < listeners.length; i += 1) {
    listeners[i](event)
  }
  return serializer.serialize(view.state.doc)
}

var afterDelete = runPreviewMenuDelete(md)
assert(afterDelete.indexOf("[^1]:") === -1, "op menu deletes footnote definition block")
assert(afterDelete.indexOf("reference[^1].") !== -1, "inline reference and text kept after delete")

if (failures > 0) {
  console.log("FAILED: " + failures)
  process.exit(1)
}
console.log("ALL FOOTNOTE TESTS PASSED")