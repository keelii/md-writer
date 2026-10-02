// 节点 → NodeView 分类判定：哪些 raw_block / code_block 归属哪种 NodeView。
// 判定属于“节点长什么样”的知识，与具体渲染实现解耦——
// command 层（plugins.ts 的删除命令、code-highlight.ts 的跳过逻辑）只依赖本文件，
// 不依赖 raw/ 或 widgets/ 的渲染实现。
import { Node as PMNode } from "prosemirror-model"
import { EditorState, Selection } from "prosemirror-state"
import { EditorDispatch } from "../../types"
import { normalizeNewlines } from "../../utils"

// code_block 的 info 参数首词为 mermaid 时归 Widget（widgets/mermaid.tsx）。
export function isMermaidCodeBlock(node: PMNode) {
  if (node.type.name !== "code_block") {
    return false
  }
  var params = node.attrs && node.attrs.params ? String(node.attrs.params) : ""
  var lang = params.trim().split(/\s+/)[0]
  return lang.toLowerCase() === "mermaid"
}

// raw_block 文本分类：math → Widget（widgets/formula.tsx），
// iframe → Raw（raw/iframe-block.tsx），frontmatter → Widget（widgets/frontmatter.tsx），
// svg → Widget（widgets/svg-block.tsx），其余无 NodeView（PM 默认 pre 渲染）。
export function getRawBlockKind(text: string): "" | "math" | "iframe" | "frontmatter" | "svg" {
  if (extractMathRawBlockExpression(text) !== null) {
    return "math"
  }
  if (isIframeRawBlockText(text)) {
    return "iframe"
  }
  if (isFrontmatterRawBlockText(text)) {
    return "frontmatter"
  }
  if (isSvgRawBlockText(text)) {
    return "svg"
  }
  return ""
}

export function parseMathRawInlineSource(text: string) {
  var source = String(text == null ? "" : text).trim()
  if (!source || source.indexOf("\n") !== -1) {
    return null
  }

  var displayMatch = source.match(/^\$\$([\s\S]+)\$\$$/)
  if (displayMatch) {
    return {
      expression: displayMatch[1],
      displayMode: true
    }
  }

  var inlineMatch = source.match(/^\$(?!\$)([\s\S]+)\$(?!\$)$/)
  if (inlineMatch) {
    return {
      expression: inlineMatch[1],
      displayMode: false
    }
  }

  return null
}

var MATH_WRAPPER_OPEN_TAG = /^<([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?>$/

export function extractMathRawBlockExpression(text: string): string | null {
  var lines = normalizeNewlines(text).split("\n")
  var start = 0
  var end = lines.length
  while (start < end) {
    var openMatch = String(lines[start] || "").trim().match(MATH_WRAPPER_OPEN_TAG)
    if (!openMatch || end - start < 2) {
      break
    }
    var closeTag = "</" + openMatch[1].toLowerCase() + ">"
    if (String(lines[end - 1] || "").trim().toLowerCase() !== closeTag) {
      break
    }
    start += 1
    end -= 1
  }
  var content = lines.slice(start, end)
  if (content.length >= 2) {
    var first = String(content[0] || "").trim()
    var last = String(content[content.length - 1] || "").trim()
    if (first === "$$" && last === "$$") {
      return content.slice(1, content.length - 1).join("\n")
    }
  }
  if (content.length === 1) {
    var inlineMatch = String(content[0] || "").trim().match(/^\$\$([\s\S]+)\$\$$/)
    if (inlineMatch) {
      return inlineMatch[1]
    }
  }
  return null
}

export function isIframeRawBlockText(text: string) {
  var trimmed = normalizeNewlines(text).trim()
  if (!trimmed) {
    return false
  }
  return /^<iframe\b/i.test(trimmed) && /<\/iframe>\s*$/i.test(trimmed)
}

export function isSvgRawBlockText(text: string) {
  var trimmed = normalizeNewlines(text).trim()
  if (!trimmed) {
    return false
  }
  return /^<svg\b/i.test(trimmed) && /<\/svg>\s*$/i.test(trimmed)
}

// SVG 块用 DOMParser 以 image/svg+xml 严格解析：语法错误直接 parseError，
// 避免像 HTML 一样宽容地“修复”出预料之外的文档结构。
// 解析成功后仍需 sanitize：SVG 命名空间内嵌 HTML 的能力（foreignObject）与
// script / on* 事件属性 / javascript: 链接都是 XSS 入口，白名单外一律移除。
var SVG_UNSAFE_TAGS: Record<string, boolean> = {
  script: true,
  foreignobject: true,
  iframe: true,
  object: true,
  embed: true
}

function isSvgURLSafe(url: string) {
  var value = String(url == null ? "" : url).trim()
  if (!value) {
    return true
  }
  try {
    var parsed = new URL(value, window.location.origin)
    var protocol = parsed.protocol.toLowerCase()
    return protocol === "http:" || protocol === "https:"
  } catch (error) {
    return false
  }
}

function sanitizeSvgElement(element: Element) {
  var children = Array.prototype.slice.call(element.children)
  for (var i = 0; i < children.length; i += 1) {
    var child = children[i]
    if (SVG_UNSAFE_TAGS[String(child.tagName).toLowerCase()]) {
      element.removeChild(child)
      continue
    }
    sanitizeSvgElement(child)
  }

  var attributes = Array.prototype.slice.call(element.attributes)
  for (var j = 0; j < attributes.length; j += 1) {
    var attr = attributes[j]
    var name = String(attr.name)
    if (/^on/i.test(name)) {
      element.removeAttribute(name)
      continue
    }
    if (name === "href" || name === "xlink:href") {
      if (!isSvgURLSafe(String(attr.value || ""))) {
        element.removeAttribute(name)
      }
    }
  }
}

// 解析并 sanitize 纯 SVG 源码，返回安全的 <svg> 元素；
// 语法非法、多根、含危险内容且清洗后仍可用时返回清洗结果，
// 结构完全不可用时返回 null（由调用方展示错误态）。
export function parseSvgRawBlockSource(text: string): SVGElement | null {
  var source = normalizeNewlines(text).trim()
  if (!isSvgRawBlockText(source)) {
    return null
  }

  var parsed = new DOMParser().parseFromString(source, "image/svg+xml")
  if (parsed.getElementsByTagName("parsererror").length > 0) {
    return null
  }
  var root = parsed.documentElement as unknown as SVGElement
  if (!root || String(root.tagName).toLowerCase() !== "svg") {
    return null
  }

  sanitizeSvgElement(root)
  return root
}

export function isFrontmatterRawBlockText(text: string) {
  var lines = normalizeNewlines(text).split("\n")
  if (lines.length < 2) {
    return false
  }
  var first = String(lines[0] || "").trim()
  if (first !== "---") {
    return false
  }
  var last = String(lines[lines.length - 1] || "").trim()
  return last === "---" || last === "..."
}

export function parseFrontmatterEntries(text: string): Array<{ key: string; value: string }> {
  var lines = normalizeNewlines(text).split("\n")
  if (lines.length < 2) {
    return []
  }
  var body = lines.slice(1, lines.length - 1)
  var out: Array<{ key: string; value: string }> = []
  for (var i = 0; i < body.length; i += 1) {
    var line = String(body[i] || "")
    if (!line.trim() || /^\s*#/.test(line)) {
      continue
    }
    var match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/)
    if (!match) {
      continue
    }
    out.push({
      key: match[1],
      value: String(match[2] || "").trim()
    })
  }
  return out
}

function isIframePreviewURLSafe(url: string) {
  var value = String(url == null ? "" : url).trim()
  if (!value) {
    return false
  }
  try {
    var parsed = new URL(value, window.location.origin)
    var protocol = parsed.protocol.toLowerCase()
    return protocol === "http:" || protocol === "https:"
  } catch (error) {
    return false
  }
}

export function parseIframeRawBlockSource(text: string) {
  var source = normalizeNewlines(text).trim()
  if (!isIframeRawBlockText(source)) {
    return null
  }

  var wrapper = document.createElement("div")
  wrapper.innerHTML = source
  if (wrapper.childElementCount !== 1) {
    return null
  }

  for (var i = 0; i < wrapper.childNodes.length; i += 1) {
    var child = wrapper.childNodes[i]
    if (child.nodeType === 3 && String(child.textContent || "").trim()) {
      return null
    }
  }

  var iframe = wrapper.firstElementChild
  if (!iframe || iframe.tagName.toLowerCase() !== "iframe") {
    return null
  }

  var src = String(iframe.getAttribute("src") || "").trim()
  if (!isIframePreviewURLSafe(src)) {
    return null
  }

  return {
    src: src,
    width: String(iframe.getAttribute("width") || "").trim(),
    height: String(iframe.getAttribute("height") || "").trim(),
    title: String(iframe.getAttribute("title") || "").trim(),
    loading: String(iframe.getAttribute("loading") || "").trim(),
    referrerpolicy: String(iframe.getAttribute("referrerpolicy") || "").trim(),
    allow: String(iframe.getAttribute("allow") || "").trim(),
    allowfullscreen: iframe.hasAttribute("allowfullscreen")
  }
}

// 预览类节点（$$ 公式 / iframe / frontmatter 的 raw_block，mermaid code_block）
// 在 WYSIWYG 下是只读 NodeView，光标无法进入。相邻文本块边界上删除时须整块删除，
// 否则 joinBackward/joinForward 会把段落合并进预览节点（光标消失、预览损坏）。

export function isPreviewBlock(node: PMNode | null | undefined) {
  if (!node) {
    return false
  }
  if (node.type.name === "raw_block") {
    return getRawBlockKind(node.textContent) !== ""
  }
  return isMermaidCodeBlock(node)
}

// direction: -1 表示 Backspace（光标在文本块开头、检查前一个兄弟块），
// 1 表示 Delete（光标在文本块末尾、检查后一个兄弟块）。
// 命中时整块删除相邻的预览类节点，避免 joinBackward/joinForward
// 把段落合并进只读预览 NodeView。
function deleteAdjacentPreviewBlock(state: EditorState, dispatch: EditorDispatch | undefined, direction: -1 | 1) {
  var selection = state.selection
  if (!selection.empty) {
    return false
  }
  var $from = selection.$from
  if (!$from.parent.isTextblock) {
    return false
  }
  var isBackspace = direction < 0
  if ($from.parentOffset !== (isBackspace ? 0 : $from.parent.content.size)) {
    return false
  }
  var blockBoundary = isBackspace ? $from.before($from.depth) : $from.after($from.depth)
  var $boundary = state.doc.resolve(blockBoundary)
  var previewBlock = isBackspace ? $boundary.nodeBefore : $boundary.nodeAfter
  if (!previewBlock || !isPreviewBlock(previewBlock)) {
    return false
  }
  if (!dispatch) {
    return true
  }
  var deleteFrom = isBackspace ? blockBoundary - previewBlock.nodeSize : blockBoundary
  var deleteTo = isBackspace ? blockBoundary : blockBoundary + previewBlock.nodeSize
  var tr = state.tr.delete(deleteFrom, deleteTo)
  tr = tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map($from.pos)))).scrollIntoView()
  dispatch(tr)
  return true
}

// Backspace：光标在文本块开头、前一个兄弟块是预览类节点时整块删除。
export function deletePreviewRawBlockOnBackspace(state: EditorState, dispatch?: EditorDispatch) {
  return deleteAdjacentPreviewBlock(state, dispatch, -1)
}

// Delete：光标在文本块末尾、后一个兄弟块是预览类节点时整块删除。
export function deletePreviewRawBlockOnDelete(state: EditorState, dispatch?: EditorDispatch) {
  return deleteAdjacentPreviewBlock(state, dispatch, 1)
}