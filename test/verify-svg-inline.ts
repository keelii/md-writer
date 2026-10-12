// 行内 SVG 验证（无头）：
// 1. markdown 解析：段落文本中间的单行 <svg>...</svg> 切为 raw_inline；
//    行首 <svg> 仍为 raw_block（块级路径不受影响）；
//    svg 内含 $ 文本不被公式 pattern 吞掉
// 2. markdown 序列化往返（原文无损）
// 3. NodeView（fake DOM）：sanitize 复用块级规则、error 态回退源码、
//    非 svg 文本返回 null / update 拒绝非 svg
// 运行：npx --yes tsx --import ./test/css-shim.mjs test/verify-svg-inline.ts
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, parseMarkdown } from "../src/prosemirror/markdown"
import { Node as PMNode } from "prosemirror-model"
import { NodeSelection } from "prosemirror-state"

var failures = 0

function check(name: string, actual: unknown, expected: unknown) {
  var ok = actual === expected
  if (!ok) {
    failures += 1
  }
  console.log((ok ? "PASS" : "FAIL") + ": " + name + (ok ? "" : "  [" + JSON.stringify(actual) + " != " + JSON.stringify(expected) + "]"))
}

// ---- 最小 fake DOM：够 parseSvgRawBlockSource / sanitizeSvgElement 用 ----
// （与 verify-svg-block.ts 同一套，覆盖测试 fixture 形态的简易 XML 解析）
class FakeAttr {
  name: string
  value: string
  constructor(name: string, value: string) {
    this.name = name
    this.value = value
  }
}

class FakeNode {
  tagName: string
  attributes: FakeAttr[] = []
  children: FakeNode[] = []
  parent: FakeNode | null = null
  textContent = ""
  constructor(tagName: string) {
    this.tagName = tagName
  }
  getAttribute(name: string) {
    for (var i = 0; i < this.attributes.length; i += 1) {
      if (this.attributes[i].name === name) {
        return this.attributes[i].value
      }
    }
    return null
  }
  removeAttribute(name: string) {
    for (var i = 0; i < this.attributes.length; i += 1) {
      if (this.attributes[i].name === name) {
        this.attributes.splice(i, 1)
        return
      }
    }
  }
  removeChild(child: FakeNode) {
    var index = this.children.indexOf(child)
    if (index !== -1) {
      this.children.splice(index, 1)
    }
    return child
  }
  appendChild(child: FakeNode) {
    child.parent = this
    this.children.push(child)
    return child
  }
}

function fakeFindAll(root: FakeNode, tagName: string, out: FakeNode[]) {
  for (var i = 0; i < root.children.length; i += 1) {
    if (root.children[i].tagName.toLowerCase() === tagName) {
      out.push(root.children[i])
    }
    fakeFindAll(root.children[i], tagName, out)
  }
  return out
}

class FakeDocument {
  documentElement: FakeNode | null
  constructor(root: FakeNode | null) {
    this.documentElement = root
  }
  getElementsByTagName(tagName: string) {
    if (!this.documentElement) {
      return []
    }
    if (this.documentElement.tagName.toLowerCase() === tagName) {
      return [this.documentElement]
    }
    return fakeFindAll(this.documentElement, tagName, [])
  }
}

class FakeDOMParser {
  parseFromString(source: string) {
    var error = new FakeNode("parsererror")
    var pos = 0
    var tagRe = /<\/?\s*([a-zA-Z][\w.:-]*)((?:\s+[^\s=<>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g
    var stack: FakeNode[] = []
    var root: FakeNode | null = null
    var closed = false
    while (pos < source.length) {
      var rest = source.slice(pos)
      if (/^\s*$/.test(rest)) {
        break
      }
      if (rest[0] !== "<") {
        var next = rest.indexOf("<")
        if (next === -1) {
          break
        }
        pos += next
        continue
      }
      if (rest.startsWith("<?") || rest.startsWith("<!--")) {
        var skip = rest.startsWith("<?") ? rest.indexOf("?>") : rest.indexOf("-->")
        if (skip === -1) {
          return new FakeDocument(error)
        }
        pos += skip + (rest.startsWith("<?") ? 2 : 3)
        continue
      }
      tagRe.lastIndex = 0
      var match = tagRe.exec(rest)
      if (!match || match.index !== 0) {
        return new FakeDocument(error)
      }
      var raw = match[0]
      var tagName = match[1]
      var isClose = raw[1] === "/"
      var selfClose = /\/\s*>$/.test(raw)
      if (isClose) {
        var top = stack.pop()
        if (!top || top.tagName.toLowerCase() !== tagName.toLowerCase()) {
          return new FakeDocument(error)
        }
        if (stack.length === 0) {
          closed = true
        }
      } else {
        var element = new FakeNode(tagName)
        var attrRe = /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
        var attrRaw = match[2] || ""
        var attrMatch: RegExpExecArray | null
        while ((attrMatch = attrRe.exec(attrRaw)) !== null) {
          element.attributes.push(new FakeAttr(attrMatch[1], attrMatch[2] != null ? attrMatch[2] : (attrMatch[3] != null ? attrMatch[3] : (attrMatch[4] != null ? attrMatch[4] : ""))))
        }
        if (stack.length === 0) {
          if (root) {
            return new FakeDocument(error)
          }
          root = element
        } else {
          stack[stack.length - 1].appendChild(element)
        }
        if (!selfClose) {
          stack.push(element)
        } else if (stack.length === 0) {
          closed = true
        }
      }
      pos += raw.length
    }
    if (!root || stack.length > 0 || !closed) {
      return new FakeDocument(error)
    }
    return new FakeDocument(root)
  }
}

;(globalThis as any).DOMParser = FakeDOMParser
;(globalThis as any).window = { location: { origin: "http://localhost" } }

// ---- 1. markdown 解析 ----
var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

var INLINE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="red"/></svg>'
var MD = "前缀 " + INLINE_SVG + " 后缀"
var doc = parseMarkdown(schema, parser, MD)
var para = doc.childCount === 1 ? doc.child(0) : null
check("inline svg doc has one paragraph", !!para, true)
if (para) {
  check("inline svg para child count", para.childCount, 3)
  check("inline svg leading text", para.child(0).type.name === "text" && para.child(0).textContent, "前缀 ")
  check("inline svg middle raw_inline", para.child(1).type.name === "raw_inline", true)
  check("inline svg raw_inline text", para.child(1).textContent, INLINE_SVG)
  check("inline svg trailing text", para.child(2).type.name === "text" && para.child(2).textContent, " 后缀")
}

// 行首 svg 仍走块级路径（raw_block），不受行内 pattern 影响
var docBlock = parseMarkdown(schema, parser, INLINE_SVG + "\n\nafter")
check("line-start svg still raw_block", docBlock.child(0).type.name === "raw_block", true)
check("block svg followed by paragraph", docBlock.child(1).type.name === "paragraph", true)

// svg 内含 $ 文本：svg 优先匹配，不被公式 pattern 切走
var DOLLAR_SVG = '<svg viewBox="0 0 4 4"><text>$5</text></svg>'
var docDollar = parseMarkdown(schema, parser, "a " + DOLLAR_SVG + " b")
var paraDollar = docDollar.child(0)
check("svg containing dollar stays one raw_inline", paraDollar.childCount === 3 && paraDollar.child(1).type.name === "raw_inline", true)
check("svg containing dollar text kept", paraDollar.child(1).textContent, DOLLAR_SVG)

// svg 换行（跨行内）：仍整体切为一个 raw_inline
var MULTILINE_SVG = '<svg viewBox="0 0 4 4">\n  <rect/>\n</svg>'
var docMulti = parseMarkdown(schema, parser, "x " + MULTILINE_SVG + " y")
check("multiline inline svg one raw_inline", docMulti.child(0).childCount === 3 && docMulti.child(0).child(1).textContent === MULTILINE_SVG, true)

// ---- 2. 序列化往返 ----
var roundtrip = serializer.serialize(doc)
check("inline svg roundtrip", roundtrip === MD, true)
var roundtripDollar = serializer.serialize(docDollar)
check("inline svg dollar roundtrip", roundtripDollar === "a " + DOLLAR_SVG + " b", true)

// ---- 3. NodeView ----
// h() / setClass 需要的 document 最小 stub
class FakeDomNode {
  nodeType = 1
  tagName: string
  className = ""
  textContent = ""
  childNodes: any[] = []
  listeners: Record<string, Function[]> = {}
  constructor(tagName: string) {
    this.tagName = tagName
  }
  setAttribute(name: string, value: string) {
    if (name === "class") {
      this.className = value
      return
    }
    ;(this as any)["attr_" + name] = value
  }
  appendChild(child: any) {
    this.childNodes.push(child)
    return child
  }
  addEventListener(type: string, handler: Function) {
    ;(this.listeners[type] || (this.listeners[type] = [])).push(handler)
  }
  classList = {
    add: (name: string) => {
      if (!this.className.split(/\s+/).includes(name)) {
        this.className = (this.className + " " + name).trim()
      }
    },
    remove: (name: string) => {
      this.className = this.className.split(/\s+/).filter(function (c) { return c && c !== name }).join(" ")
    }
  }
}
;(globalThis as any).document = {
  createElement: function (tagName: string) {
    return new FakeDomNode(tagName)
  },
  createTextNode: function (text: string) {
    return { nodeType: 3, textContent: text }
  }
}

var { createRawInlineSvgNodeView } = await import("../src/prosemirror/nodeviews/widgets/svg-inline")

function fakeNode(text: string, typeName?: string): PMNode {
  return {type: {name: typeName || "raw_inline"}, textContent: text} as unknown as PMNode
}

// 非 raw_inline / 非 svg 文本 → null（交回分派器）
check("nodeview rejects raw_block node", createRawInlineSvgNodeView(fakeNode(INLINE_SVG, "raw_block")), null)
check("nodeview rejects math text", createRawInlineSvgNodeView(fakeNode("$x$")), null)
check("nodeview rejects footnote text", createRawInlineSvgNodeView(fakeNode("[^1]")), null)

// 正常渲染：span 容器 + sanitize 后的 svg（script 被移除、fill 保留）
var UNSAFE_SVG = '<svg viewBox="0 0 4 4"><script>alert(1)</script><rect fill="red" onload="alert(2)"/></svg>'
var view = createRawInlineSvgNodeView(fakeNode(UNSAFE_SVG))
check("nodeview created for svg text", !!view, true)
if (view) {
  var dom = view.dom as unknown as FakeDomNode
  check("nodeview container class", dom.className, "md-editor-raw-inline-preview md-editor-raw-inline-svg")
  check("nodeview container not editable", (dom as any).attr_contenteditable, "false")
  var svgEl = dom.childNodes[0] as unknown as FakeNode
  check("nodeview renders sanitized svg", !!svgEl && svgEl.tagName.toLowerCase() === "svg", true)
  var childTags: string[] = []
  svgEl.children.forEach(function (c: FakeNode) { childTags.push(c.tagName.toLowerCase()) })
  check("nodeview strips script", childTags.join(","), "rect")
  check("nodeview strips onload", svgEl.children[0].attributes.map(function (a: FakeAttr) { return a.name }).join(","), "fill")

  // 同 svg 文本变化原地重渲染
  var updated = view.update(fakeNode(INLINE_SVG))
  check("nodeview update same-kind", updated, true)
  var svgEl2 = (view.dom as unknown as FakeDomNode).childNodes[0] as unknown as FakeNode
  check("nodeview re-rendered", !!svgEl2 && svgEl2.children.length === 1 && svgEl2.children[0].tagName.toLowerCase() === "rect", true)

  // 变为非 svg 文本 → false（交回分派器）
  check("nodeview update rejects non-svg", view.update(fakeNode("$x$")), false)
}

// 非法 svg（parseError）：error 态回退显示源码文本
var viewErr = createRawInlineSvgNodeView(fakeNode("<svg><rect></svg>"))
check("nodeview created for invalid svg", !!viewErr, true)
if (viewErr) {
  var domErr = viewErr.dom as unknown as FakeDomNode
  check("nodeview error class", domErr.className, "md-editor-raw-inline-preview md-editor-raw-inline-preview-error")
  check("nodeview error shows source", domErr.textContent, "<svg><rect></svg>")
}

// ---- 4. NodeView 选中交互 ----
// selectNode / deselectNode 挂/摘 ProseMirror-selectednode 类
var viewSel = createRawInlineSvgNodeView(fakeNode(INLINE_SVG))
check("nodeview created for selection test", !!viewSel, true)
if (viewSel) {
  viewSel.selectNode()
  check("selectNode adds ProseMirror-selectednode",
    (viewSel.dom as any).className.indexOf("ProseMirror-selectednode") !== -1, true)
  viewSel.deselectNode()
  check("deselectNode removes ProseMirror-selectednode",
    (viewSel.dom as any).className.indexOf("ProseMirror-selectednode") === -1, true)
}

// mousedown：dispatch NodeSelection(getPos) 并 focus
// （doc 来自第 1 节：paragraph("前缀 ", raw_inline, " 后缀")，raw_inline 在 pos 4）
var capturedSel: any = null
var focused = false
var fakeTr: any = {
  setSelection: function (sel: any) { capturedSel = sel; return fakeTr }
}
var fakeView: any = {
  state: { doc: doc, tr: fakeTr },
  dispatch: function () {},
  focus: function () { focused = true }
}
var viewM = createRawInlineSvgNodeView(fakeNode(INLINE_SVG), fakeView, function () { return 4 })
check("mousedown nodeview created with view", !!viewM, true)
if (viewM) {
  var domM = viewM.dom as unknown as FakeDomNode
  check("mousedown handler attached", (domM.listeners["mousedown"] || []).length, 1)
  var fakeEvent = { preventDefault: function () {}, stopPropagation: function () {} }
  ;(domM.listeners["mousedown"][0] as any)(fakeEvent)
  check("mousedown dispatches NodeSelection", capturedSel instanceof NodeSelection, true)
  check("NodeSelection targets raw_inline pos", capturedSel ? capturedSel.from : -1, 4)
  check("mousedown refocuses editor", focused, true)
}

if (failures > 0) {
  console.log(failures + " failure(s)")
  process.exit(1)
} else {
  console.log("ALL PASS")
}