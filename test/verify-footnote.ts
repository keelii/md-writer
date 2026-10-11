// 脚注渲染端到端验证：
// 1. kinds 分类与解析：getRawBlockKind 识别脚注定义块（不干扰 math/frontmatter/svg），
//    parseFootnoteRawBlockSource 剥掉续行一层缩进，parseFootnoteRawInlineSource 只认 [^label]。
// 2. markdown 往返：行内 `[^1]` 解析为 raw_inline、定义块为 raw_block，序列化还原原文。
// 3. isPreviewBlock 覆盖脚注定义块（相邻块边界 Backspace 整删保护）。
// 4. NodeView DOM：定义块为 display:none 隐藏占位（无可见内容，查看/编辑走
//    引用 tooltip）、行内 sup 上标、update 跨 kind 返回 false。
// 5. op menu 不再挂接：隐藏占位 hover / 选中都不可达，注册表不匹配脚注定义块。
import { EditorState, TextSelection, Transaction } from "prosemirror-state"
import { Node as PMNode } from "prosemirror-model"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, buildRestrictedMarkdownParser, parseMarkdown } from "../src/prosemirror/markdown"
import {
  getRawBlockKind,
  isPreviewBlock,
  parseFootnoteRawBlockSource,
  parseFootnoteRawInlineSource
} from "../src/prosemirror/nodeviews/kinds"
import {
  buildInnerFootnoteSchema,
  buildInnerFootnotePlugins,
  createFootnoteRawBlockNodeView,
  createFootnoteRefRawInlineNodeView,
  parseFootnoteLineParagraph,
  serializeFootnoteLineParagraph
} from "../src/prosemirror/nodeviews/widgets/footnote"
import { previewBlockOpMenuRegistration } from "../src/prosemirror/nodeviews/node-op-menu"
import { placeTooltip } from "../src/utils"

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
  // getBoundingClientRect 度量结果（placeTooltip 摆位用），测试里手工设定
  rect: { left: number, top: number, right: number, bottom: number, width: number, height: number }
  // style.setProperty 记录表：摆位箭头坐标写入 --md-tooltip-arrow-x
  styleProperties: Record<string, string>
  style: any

  constructor(tagName: string, nodeType: number, text?: string) {
    this.tagName = tagName
    this.nodeType = nodeType
    this.attrs = {}
    this.children = []
    this.text = text == null ? "" : text
    this.parent = null
    this.listeners = {}
    this.classSet = new Set()
    this.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    this.styleProperties = {}
    var self = this
    this.style = {
      setProperty: function (name: string, value: string) {
        self.styleProperties[name] = value
      }
    }
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

  // contenteditable div 提交逻辑读 innerText（真实浏览器里 Enter 产生 div/br）；
  // stub 环境无渲染差异，直接等价 textContent
  get innerText(): string {
    return this.textContent
  }

  set innerText(value: string) {
    this.textContent = value
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

  get parentNode(): FakeElement | null {
    return this.parent
  }

  removeChild(child: FakeElement) {
    var index = this.children.indexOf(child)
    if (index !== -1) {
      this.children.splice(index, 1)
    }
    child.parent = null
    return child
  }

  addEventListener(type: string, fn: (event: any) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = []
    }
    this.listeners[type].push(fn)
  }

  focus() {}

  getBoundingClientRect() {
    return this.rect
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

// placeTooltip（utils）读视口尺寸，stub 一个常规桌面视口
;(globalThis as any).window = {
  innerWidth: 1280,
  innerHeight: 800
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
    // 定义块在正文里是 display:none 的隐藏占位：无 shell、无子元素、不可编辑，
    // 查看与编辑只发生在引用处的 tooltip
    var dom = nv.dom as unknown as FakeElement
    assert(dom.tagName === "div" && dom.classSet.has("md-editor-raw-footnote-def"), "footnote block renders hidden placeholder")
    assert(dom.attrs["contenteditable"] === "false", "hidden placeholder is not editable")
    assert(dom.children.length === 0, "hidden placeholder renders no content")

    // 同 kind 文本变化：继续复用隐藏占位
    var nextText = "[^2]: changed"
    var nextNode = schema.nodes.raw_block.createAndFill({}, schema.text(nextText))
    assert(nextNode !== null && nv.update(nextNode) === true, "same-kind update reuses NodeView")
    assert((nv.dom as unknown as FakeElement) === dom && dom.children.length === 0, "same-kind update keeps placeholder empty")

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

// ---------- 5. op menu 不再挂接脚注定义块 ----------

// 定义块是 display:none 的隐藏占位：hover / NodeSelection 都不可达，挂菜单只会
// 凭空弹出浮层——注册表必须不匹配脚注定义块。删除定义块走相邻文本块边界
// Backspace 整删（deleteAdjacentPreviewBlock，链路见 verify-raw-block-del.ts）。
assert(
  blockFound !== null && !previewBlockOpMenuRegistration.matches(blockFound, doc),
  "hidden footnote block no longer matches op menu registration"
)
var mathPreviewBlock = schema.nodes.raw_block.createAndFill({}, schema.text("$$\nx\n$$"))
assert(
  mathPreviewBlock !== null && previewBlockOpMenuRegistration.matches(mathPreviewBlock, doc),
  "other preview blocks still match op menu"
)

// ---------- 6. 引用处点击 tooltip 预览 + 编辑 ----------

function fireListeners(el: FakeElement, type: string, event: Record<string, unknown>) {
  var listeners = el.listeners[type] || []
  for (var i = 0; i < listeners.length; i += 1) {
    listeners[i](event)
  }
}

function findByTag(root: FakeElement, tag: string): FakeElement | null {
  for (var i = 0; i < root.children.length; i += 1) {
    var child = root.children[i]
    if (child.nodeType === 1) {
      if (child.tagName === tag) {
        return child
      }
      var nested = findByTag(child, tag)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

// 6a. 有定义：selectNode 打开的子编辑器（new EditorView）依赖真实 DOM，
// 在本测试的 FakeElement 环境下无法运行——该路径由 test/tmp-tooltip-check.html
// 在 headless Chrome 中验证（点击 → NodeSelection → 子编辑器预填 → 提交）。

// 6b. 无定义（悬空引用）：selectNode 弹只读提示，不创建子编辑器；deselectNode 收起
var danglingMd = "Dangling ref[^missing] here.\n\nplain block"
var danglingDoc = parseMarkdown(schema, parser, danglingMd)
if (!danglingDoc) {
  throw new Error("parse failed for dangling case")
}
var danglingInline = findFootnoteNode(danglingDoc, function (n: PMNode) {
  return n.type.name === "raw_inline" && n.textContent === "[^missing]"
})
assert(danglingInline !== null, "dangling case: inline reference found")
if (danglingInline) {
  var danglingState = EditorState.create({ schema: schema, doc: danglingDoc })
  var danglingView: any = {
    state: danglingState,
    dispatch: function (tr: Transaction) {
      danglingView.state = danglingView.state.apply(tr)
    },
    focus: function () {}
  }
  var danglingNv = createFootnoteRefRawInlineNodeView(danglingInline, danglingView)
  var danglingDom = danglingNv!.dom as unknown as FakeElement
  danglingNv!.selectNode()
  var emptyTip = findByTag(danglingDom, "span")
  assert(
    emptyTip !== null && emptyTip.classSet.has("md-editor-footnote-tooltip-empty"),
    "selectNode on dangling reference shows read-only empty tooltip"
  )
  assert(
    emptyTip !== null && emptyTip.classSet.has("md-editor-tooltip"),
    "tooltip carries generic .md-editor-tooltip base class (reusable shell + arrow)"
  )
  assert(
    danglingDom.classSet.has("ProseMirror-selectednode"),
    "selectNode marks sup as selected node"
  )
  assert(danglingDom.children.length === 2, "sup keeps label text while tooltip open")
  assert(
    danglingNv!.stopEvent({ target: emptyTip } as unknown as Event) === false,
    "stopEvent passes through without inner editor (official semantics)"
  )
  danglingNv!.deselectNode()
  assert(danglingDom.children.length === 1, "deselectNode closes tooltip")
  assert(
    !danglingDom.classSet.has("ProseMirror-selectednode"),
    "deselectNode clears selected-node class"
  )

  // 6c. label 变化的 update：tooltip 打开时静默丢弃并收起
  var relabelNv = createFootnoteRefRawInlineNodeView(danglingInline, danglingView)
  var relabelDom = relabelNv!.dom as unknown as FakeElement
  relabelNv!.selectNode()
  assert(relabelDom.children.length === 2, "relabel case: tooltip opened")
  var relabelSource = "[^renamed]"
  var relabelInline = findFootnoteNode(parseMarkdown(schema, parser, "x[^renamed]")!, function (n: PMNode) {
    return n.type.name === "raw_inline" && n.textContent === relabelSource
  })
  assert(relabelInline !== null, "relabel case: new inline node found")
  if (relabelInline) {
    assert(relabelNv!.update(relabelInline) === true, "label change accepted by update")
    assert(findByTag(relabelDom, "span") === null, "label change closes tooltip without commit")
    assert(textOf(relabelDom) === "renamed", "sup label refreshed after relabel")
  }

  // 6d. destroy 收起 tooltip
  var destroyNv = createFootnoteRefRawInlineNodeView(danglingInline, danglingView)
  var destroyDom = destroyNv!.dom as unknown as FakeElement
  destroyNv!.selectNode()
  assert(destroyDom.children.length === 2, "destroy case: tooltip opened")
  destroyNv!.destroy()
  assert(destroyDom.children.length === 1, "destroy closes tooltip")
}

// ---------- 7. 子编辑器受限 schema：只允许段落 + 行内 marks ----------

var innerSchema = buildInnerFootnoteSchema(schema)
var innerParser = buildRestrictedMarkdownParser(innerSchema)

var innerNodeNames: string[] = []
innerSchema.spec.nodes.forEach(function (name: string, _spec: unknown) {
  innerNodeNames.push(name)
})
assert(
  innerNodeNames.join(",") === "doc,paragraph,text",
  "inner footnote schema allows only doc/paragraph/text (got: " + innerNodeNames.join(",") + ")"
)

function paragraphHasMark(paragraph: PMNode, markName: string): boolean {
  var seen = false
  paragraph.forEach(function (child: PMNode) {
    for (var i = 0; i < child.marks.length; i += 1) {
      if (child.marks[i].type.name === markName) {
        seen = true
      }
    }
  })
  return seen
}

// 行内 marks 照常解析
var boldLineNode = parseFootnoteLineParagraph(innerParser, innerSchema, "a **bold** b")
assert(
  boldLineNode.type.name === "paragraph" && paragraphHasMark(boldLineNode, "strong"),
  "restricted parser still parses inline marks (strong)"
)
assert(boldLineNode.textContent === "a bold b", "inline mark text content preserved")
var mdSerializer = buildMarkdownSerializer(schema)
assert(
  serializeFootnoteLineParagraph(mdSerializer, boldLineNode) === "a **bold** b",
  "inline marks serialize back to markdown source"
)

// 块级 / 图片语法一律退回纯文本段落
var blockSyntaxCases: Array<[string, string]> = [
  ["# heading", "# heading"],
  ["- list item", "- list item"],
  ["> quote", "> quote"],
  ["![alt](https://example.com/y.png)", "![alt](https://example.com/y.png)"]
]
for (var caseIndex = 0; caseIndex < blockSyntaxCases.length; caseIndex += 1) {
  var syntaxCase = blockSyntaxCases[caseIndex]
  var fallbackNode = parseFootnoteLineParagraph(innerParser, innerSchema, syntaxCase[0])
  assert(
    fallbackNode.type.name === "paragraph" &&
      fallbackNode.textContent === syntaxCase[1] &&
      fallbackNode.childCount === 1 &&
      fallbackNode.child(0).marks.length === 0,
    "block/image syntax falls back to plain text paragraph: " + syntaxCase[0]
  )
}

// ---------- 7b. 子编辑器双空格跳出 mark（与正文同手势） ----------

// tooltip 内的嵌套子编辑器走 buildInnerFootnotePlugins：行内 mark 末尾连输
// 两个空格也应像主编辑器一样跳出。直接调用 inputRules 的 handleTextInput
// 模拟输入（不依赖真实 DOM，见 verify-exit-mark.ts 同款手法）。
var innerPluginList = buildInnerFootnotePlugins(innerSchema, {})
var innerHandleTextInput: any = null
for (var ip = 0; ip < innerPluginList.length; ip += 1) {
  var innerProps = (innerPluginList[ip] as any).props
  if (innerProps && typeof innerProps.handleTextInput === "function") {
    innerHandleTextInput = innerProps.handleTextInput
  }
}
assert(innerHandleTextInput !== null, "inner editor plugins include inputRules (exit-mark rule wired)")

function typeInnerText(state: EditorState, text: string) {
  var applied = state
  var handled = innerHandleTextInput(
    {
      composing: false,
      state: state,
      dispatch: function (tr: any) {
        applied = applied.apply(tr)
      }
    },
    state.selection.from,
    state.selection.to,
    text
  )
  return { handled: handled, state: applied }
}

// 受限 schema 段落：文本 + marks，光标在末尾
function buildInnerState(children: Array<[string, string[]]>) {
  var innerNodes: PMNode[] = []
  for (var bi = 0; bi < children.length; bi += 1) {
    var innerPair = children[bi]
    var innerMarks = innerPair[1].map(function (name: string) {
      return innerSchema.marks[name].create()
    })
    innerNodes.push(innerSchema.text(innerPair[0], innerMarks))
  }
  var innerPara = innerSchema.nodes.paragraph.create(null, innerNodes)
  var innerDoc = innerSchema.topNodeType.create(null, innerPara)
  return EditorState.create({
    doc: innerDoc,
    selection: TextSelection.create(innerDoc, 1 + innerPara.content.size)
  })
}

function summarizeInnerChildren(state: EditorState): string[] {
  var out: string[] = []
  state.doc.forEach(function (para) {
    para.forEach(function (child) {
      var names = child.marks.map(function (m) {
        return m.type.name
      })
      out.push((child.text || child.type.name) + "[" + names.sort().join(",") + "]")
    })
  })
  return out
}

if (innerHandleTextInput) {
  var innerMarkNames = ["code", "strong", "em", "strike"]
  for (var im = 0; im < innerMarkNames.length; im += 1) {
    var innerMarkName = innerMarkNames[im]
    // 第一个空格带 mark 写入
    var innerBase = buildInnerState([["foo", [innerMarkName]]])
    innerBase = innerBase.apply(innerBase.tr.insertText(" "))
    // 第二个空格：规则消费手势，第一个空格去掉 mark 跳出
    var innerResult = typeInnerText(innerBase, " ")
    assert(innerResult.handled === true, "inner second space handled for " + innerMarkName)
    assert(
      summarizeInnerChildren(innerResult.state).join("|") === "foo[" + innerMarkName + "]| []",
      "inner first space unmarked for " + innerMarkName + " (got: " + summarizeInnerChildren(innerResult.state).join("|") + ")"
    )
    // 跳出后继续输入不带 mark
    var innerTyped = innerResult.state.apply(innerResult.state.tr.insertText("x"))
    assert(
      summarizeInnerChildren(innerTyped).join("|") === "foo[" + innerMarkName + "]| x[]",
      "inner subsequent typing unmarked for " + innerMarkName + " (got: " + summarizeInnerChildren(innerTyped).join("|") + ")"
    )
  }

  // 无 mark 普通文本双空格不触发（防误伤）
  var innerPlain = buildInnerState([["foo", []]])
  innerPlain = innerPlain.apply(innerPlain.tr.insertText(" "))
  var innerPlainResult = typeInnerText(innerPlain, " ")
  assert(innerPlainResult.handled === false, "inner plain double space not handled")

  // 行尾 nbsp 变体（Chrome 行尾空格以 \u00a0 进入）同样触发
  var innerNbsp = buildInnerState([["foo", ["strong"]]])
  innerNbsp = innerNbsp.apply(innerNbsp.tr.insertText("\u00a0"))
  var innerNbspResult = typeInnerText(innerNbsp, "\u00a0")
  assert(innerNbspResult.handled === true, "inner tail-nbsp second space handled")
}

// ---------- 8. tooltip 摆位：屏幕边缘自适应（placeTooltip + 位置变体类） ----------

type FakeRect = { left: number, top: number, right: number, bottom: number, width: number, height: number }

function makePlacementPair(anchorRect: FakeRect): FakeElement {
  var anchor = new FakeElement("sup", 1)
  anchor.rect = anchorRect
  var tooltip = new FakeElement("span", 1)
  // 浮层尺寸固定（280x120）：FakeElement 不真渲染，位置类名不改 rect
  tooltip.rect = { left: 405, top: 437, right: 685, bottom: 557, width: 280, height: 120 }
  placeTooltip(anchor as unknown as HTMLElement, tooltip as unknown as HTMLElement)
  return tooltip
}

// 屏幕中央（视口 1280x800）：保持默认下方居中，无任何变体类；
// 箭头指向锚点中心（锚点中心 515 - 浮层左边 405 = 110px）
var centerTip = makePlacementPair({ left: 500, top: 400, right: 530, bottom: 416, width: 30, height: 16 })
assert(
  !centerTip.classSet.has("md-editor-tooltip--above") &&
    !centerTip.classSet.has("md-editor-tooltip--align-start") &&
    !centerTip.classSet.has("md-editor-tooltip--align-end"),
  "centered anchor keeps default below-center placement"
)
assert(
  centerTip.styleProperties["--md-tooltip-arrow-x"] === "110px",
  "arrow points at anchor center (px offset on tooltip)"
)

// 锚点贴近视口下边缘：下方放不下、上方放得下 → 翻转到上方
var aboveTip = makePlacementPair({ left: 500, top: 690, right: 530, bottom: 706, width: 30, height: 16 })
assert(
  aboveTip.classSet.has("md-editor-tooltip--above") &&
    !aboveTip.classSet.has("md-editor-tooltip--align-start") &&
    !aboveTip.classSet.has("md-editor-tooltip--align-end"),
  "anchor near viewport bottom flips tooltip above (--above)"
)

// 锚点贴近视口左边缘：居中溢出左边 → 贴齐锚点左缘
var startTip = makePlacementPair({ left: 2, top: 400, right: 32, bottom: 416, width: 30, height: 16 })
assert(
  startTip.classSet.has("md-editor-tooltip--align-start") &&
    !startTip.classSet.has("md-editor-tooltip--above") &&
    !startTip.classSet.has("md-editor-tooltip--align-end"),
  "anchor near viewport left edge aligns tooltip start (--align-start)"
)

// 锚点贴近视口右边缘：居中溢出右边 → 贴齐锚点右缘
var endTip = makePlacementPair({ left: 1250, top: 400, right: 1280, bottom: 416, width: 30, height: 16 })
assert(
  endTip.classSet.has("md-editor-tooltip--align-end") &&
    !endTip.classSet.has("md-editor-tooltip--above") &&
    !endTip.classSet.has("md-editor-tooltip--align-start"),
  "anchor near viewport right edge aligns tooltip end (--align-end)"
)

if (failures > 0) {
  console.log("FAILED: " + failures)
  process.exit(1)
}
console.log("ALL FOOTNOTE TESTS PASSED")