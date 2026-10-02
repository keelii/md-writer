// 纯 SVG 预览块验证（无头）：
// 1. markdown 中 <svg>...</svg> 解析为 raw_block，kind 判定为 "svg"（kinds.ts）
// 2. parseSvgRawBlockSource 的 sanitize 规则（fake DOMParser 驱动）
// 3. isPreviewBlock 覆盖 svg 块（边界 Backspace/Delete 整删保护生效前提）
// 4. markdown 序列化往返
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, parseMarkdown } from "../src/prosemirror/markdown"
import {
  getRawBlockKind,
  isSvgRawBlockText,
  parseSvgRawBlockSource,
  isPreviewBlock,
  deletePreviewRawBlockOnBackspace
} from "../src/prosemirror/nodeviews/kinds"
import { EditorState, TextSelection } from "prosemirror-state"
import { Node as PMNode } from "prosemirror-model"

var failures = 0

function check(name: string, actual: unknown, expected: unknown) {
  var ok = actual === expected
  if (!ok) {
    failures += 1
  }
  console.log((ok ? "PASS" : "FAIL") + ": " + name + (ok ? "" : "  [" + JSON.stringify(actual) + " != " + JSON.stringify(expected) + "]"))
}

// ---- 最小 fake DOM：够 parseSvgRawBlockSource / sanitizeSvgElement 用 ----
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

// 简易 XML 解析：仅覆盖测试 fixture 形态（标签/属性/自闭合/嵌套），
// 闭合不匹配、根未闭合、根后残余内容一律判为 parsererror
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
        // 标签之间的文本（含 script 内容）直接跳到下一个标签
        var next = rest.indexOf("<")
        if (next === -1) {
          break
        }
        pos += next
        continue
      }
      if (rest.startsWith("<?") || rest.startsWith("<!--")) {
        var skip = rest.startsWith("<?")
          ? rest.indexOf("?>")
          : rest.indexOf("-->")
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

// ---- 1. kind 判定 ----
check("svg block kind", getRawBlockKind('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>'), "svg")
check("svg with leading whitespace kind", getRawBlockKind('\n<svg viewBox="0 0 4 4"><rect/></svg>\n'), "svg")
check("div html block not svg", getRawBlockKind("<div>\nhello\n</div>"), "")
check("svg unclosed not svg", getRawBlockKind("<svg><rect/></div>"), "")
check("isSvgRawBlockText plain", isSvgRawBlockText("hello"), false)
check("isSvgRawBlockText svg", isSvgRawBlockText("<svg></svg>"), true)
check("isSvgRawBlockText svgx", isSvgRawBlockText("<svgx></svg>"), false)

// ---- 2. sanitize 规则 ----
function sanitizeOf(source: string) {
  var root = parseSvgRawBlockSource(source)
  if (!root) {
    return ""
  }
  var parts: string[] = []
  function walk(node: FakeNode) {
    parts.push("<" + node.tagName.toLowerCase() + ">")
    for (var i = 0; i < node.attributes.length; i += 1) {
      parts.push("@" + node.attributes[i].name)
    }
    node.children.forEach(walk)
  }
  walk(root as unknown as FakeNode)
  return parts.join(" ")
}

var SAFE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="red"/></svg>'
check("safe svg parses", !!parseSvgRawBlockSource(SAFE_SVG), true)
check("safe svg keeps rect", sanitizeOf(SAFE_SVG).indexOf("<rect>") !== -1, true)
check("safe svg keeps fill attr", sanitizeOf(SAFE_SVG).indexOf("@fill") !== -1, true)

check("script removed", sanitizeOf('<svg><script>alert(1)</script><rect/></svg>'), "<svg> <rect>")
check("foreignObject removed", sanitizeOf('<svg><foreignObject><div>x</div></foreignObject><rect/></svg>'), "<svg> <rect>")
check("nested script removed", sanitizeOf('<svg><g><script>alert(1)</script></g></svg>'), "<svg> <g>")
check("onload attr removed", sanitizeOf('<svg><rect onload="alert(1)"/></svg>'), "<svg> <rect>")
check("onclick attr removed", sanitizeOf('<svg><a onclick="alert(1)"><rect/></a></svg>'), "<svg> <a> <rect>")
check("javascript href removed", sanitizeOf('<svg><a href="javascript:alert(1)"><rect/></a></svg>'), "<svg> <a> <rect>")
check("xlink javascript href removed", sanitizeOf('<svg><a xlink:href="javascript:alert(1)"/></svg>'), "<svg> <a>")
check("data href removed", sanitizeOf('<svg><a href="data:text/html,x"/></svg>'), "<svg> <a>")
check("fragment href kept", sanitizeOf('<svg><use href="#icon"/></svg>').indexOf("@href") !== -1, true)
check("http href kept", sanitizeOf('<svg><image href="https://example.com/i.png"/></svg>').indexOf("@href") !== -1, true)
check("parsererror returns null", parseSvgRawBlockSource("<svg><rect></svg>"), null)
check("unclosed root returns null", parseSvgRawBlockSource("<svg><rect/>"), null)
check("multi root returns null", parseSvgRawBlockSource("<svg/><svg/>"), null)
check("non svg text returns null", parseSvgRawBlockSource("hello"), null)

// ---- 3. markdown 解析 + isPreviewBlock + 往返 ----
var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

var MD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="red"/></svg>'
var doc = parseMarkdown(schema, parser, MD_SVG)
check("svg parses to raw_block", doc.childCount === 1 && doc.child(0).type.name === "raw_block", true)
check("svg raw_block is preview block", isPreviewBlock(doc.child(0)), true)

var roundtrip = serializer.serialize(doc)
check("svg markdown roundtrip", roundtrip === MD_SVG, true)

// 边界删除保护：svg 块后段落开头 Backspace 整删 svg 块
var docTail = parseMarkdown(schema, parser, MD_SVG + "\n\nafter")
var start = -1
docTail.forEach(function (_n: PMNode, offset: number, i: number) {
  if (i === 1) {
    start = offset + 1
  }
})
var stateTail = EditorState.create({ doc: docTail, selection: TextSelection.create(docTail, start) })
var appliedState = stateTail
var handled = deletePreviewRawBlockOnBackspace(stateTail, function (tr: any) {
  appliedState = appliedState.apply(tr)
})
var summary = ""
appliedState.doc.forEach(function (n: PMNode) {
  summary += n.type.name + "(" + n.textContent.slice(0, 5) + ")"
})
check("backspace after svg block handled", handled, true)
check("svg block removed by backspace", summary, "paragraph(after)")

if (failures > 0) {
  console.log(failures + " failure(s)")
  process.exit(1)
} else {
  console.log("ALL PASS")
}