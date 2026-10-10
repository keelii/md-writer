import {
  MarkdownParser,
  MarkdownSerializer,
  MarkdownSerializerState,
  defaultMarkdownParser,
  defaultMarkdownSerializer
} from "prosemirror-markdown";
import { Node as PMNode, Schema } from "prosemirror-model";
import MarkdownIt from "markdown-it";
import type { Token as MarkdownItToken } from "markdown-it";
import {
  JSONMark,
  JSONNodeData,
  RawBlockSegment,
  RawInlinePlaceholder,
  RawInlineSegment
} from "../types";
import { normalizeNewlines } from "../utils";

type MarkdownParserTokenState = {
  addNode: (nodeType: unknown) => void;
  addText: (text: string) => void;
};
type MarkdownTokenCtor = new (type: string, tag: string, nesting: number) => MarkdownItToken;
type MarkdownItStateCore = {
  tokens: MarkdownItToken[];
};
type MarkdownItCoreRuler = {
  push: (name: string, rule: (state: MarkdownItStateCore) => void) => void;
};
type MarkdownItWithCoreRuler = MarkdownIt & {
  core: { ruler: MarkdownItCoreRuler };
};
type MarkdownParserWithTokenHandlers = MarkdownParser & {
  tokenHandlers: Record<string, (state: MarkdownParserTokenState) => void>;
};
type MarkdownSerializerStateCompat = MarkdownSerializerState & {
  out: string;
  nodes: unknown;
  marks: unknown;
  options: unknown;
  renderInline: (node: PMNode, parent?: boolean) => void;
  render: (node: PMNode, parent?: PMNode, index?: number) => void;
};
type MarkdownSerializerStateCompatConstructor = new (nodes: unknown, marks: unknown, options: unknown) => MarkdownSerializerStateCompat;

// markdown-it 表格规则把列对齐（GFM 分隔行 :--- / :---: / ---:）以
// text-align 写进该列每个 th/td open token 的 attrs，这里提取成 cell 的
// align attr（left/center/right，null 为默认）。
function tableAlignFromToken(token: MarkdownItToken): {align: string | null} {
  var attrs = token.attrs
  if (!attrs) {
    return {align: null}
  }
  for (var i = 0; i < attrs.length; i += 1) {
    var pair = attrs[i]
    if (!pair || pair[0] !== "style") {
      continue
    }
    var match = /text-align\s*:\s*(left|center|right)\s*(?:;|$)/i.exec(String(pair[1]))
    if (match) {
      return {align: match[1].toLowerCase()}
    }
  }
  return {align: null}
}

export function buildMarkdownParser(schema: Schema): MarkdownParser {
  var tableTokens = {
    table: {block: "table"},
    thead: {block: "table_head"},
    tbody: {block: "table_body"},
    tfoot: {block: "table_body"},
    tr: {block: "table_row"},
    th: {block: "table_header", getAttrs: tableAlignFromToken},
    td: {block: "table_cell", getAttrs: tableAlignFromToken}
  }
  var tokens = Object.assign({}, defaultMarkdownParser.tokens, tableTokens, {
    s: {mark: "strike"}
  })
  var tokenizer = new MarkdownIt("default", {
    html: false,
    linkify: false,
    typographer: false
  })
  // markdown-it 默认 validateLink 只放行 data:image/(gif|png|jpeg|webp)，
  // 其余图片 mime（svg+xml/jpg/heic/avif/bmp…）的 data URL 会被拒绝，
  // ![alt](data:...) 随即退化为纯文本——本地图片切源码再切回
  // 可视模式就直接展示 base64 源码。编辑器的图片来源是用户本地文件，
  // 这里放行所有 data:image/* 前缀，其余协议仍走默认安全校验。
  var defaultValidateLink = tokenizer.validateLink
  tokenizer.validateLink = function (url: string) {
    if (/^\s*data:image\//i.test(url)) {
      return true
    }
    return defaultValidateLink.call(tokenizer, url)
  }
  registerTableCellBrRule(tokenizer as MarkdownItWithCoreRuler)
  var parser = new MarkdownParser(schema, tokenizer, tokens)
  var parserWithTokenHandlers = parser as MarkdownParserWithTokenHandlers
  parserWithTokenHandlers.tokenHandlers.softbreak = function (state: MarkdownParserTokenState) {
    if (schema.nodes.hard_break) {
      state.addNode(schema.nodes.hard_break)
      return
    }
    state.addText("\n")
  }
  return parser
}

var TABLE_CELL_BR_PATTERN = /<br\s*\/?>/gi

function splitTableCellBrTokens(children: MarkdownItToken[]): MarkdownItToken[] {
  var next: MarkdownItToken[] = []
  for (var i = 0; i < children.length; i += 1) {
    var token = children[i]
    if (token.type !== "text" || !TABLE_CELL_BR_PATTERN.test(token.content)) {
      TABLE_CELL_BR_PATTERN.lastIndex = 0
      next.push(token)
      continue
    }
    TABLE_CELL_BR_PATTERN.lastIndex = 0
    var parts = String(token.content).split(TABLE_CELL_BR_PATTERN)
    var TokenCtor = token.constructor as MarkdownTokenCtor
    for (var partIndex = 0; partIndex < parts.length; partIndex += 1) {
      if (partIndex > 0) {
        next.push(new TokenCtor("softbreak", "br", 0))
      }
      if (parts[partIndex]) {
        var textToken = new TokenCtor("text", "", 0)
        textToken.content = parts[partIndex]
        next.push(textToken)
      }
    }
  }
  return next
}

function registerTableCellBrRule(tokenizer: MarkdownItWithCoreRuler) {
  tokenizer.core.ruler.push("md_editor_table_cell_br", function (state) {
    var tokens = state.tokens
    var inTableCell = false
    for (var i = 0; i < tokens.length; i += 1) {
      var token = tokens[i]
      if (token.type === "td_open" || token.type === "th_open") {
        inTableCell = true
        continue
      }
      if (token.type === "td_close" || token.type === "th_close") {
        inTableCell = false
        continue
      }
      if (token.type === "inline" && inTableCell && token.children && token.children.length) {
        token.children = splitTableCellBrTokens(token.children)
      }
    }
  })
}

function escapeTableCellContent(raw: string) {
  return String(raw == null ? "" : raw)
    .replace(/\r\n?/g, "\n")
    .replace(/\n+/g, "<br>")
    .replace(/\|/g, "\\|")
    .trim()
}

function escapeMarkdownLabelText(raw: string) {
  return String(raw == null ? "" : raw)
    .replace(/\r\n?/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
}

function serializeTableCell(state: MarkdownSerializerState, cell: PMNode) {
  var serializerState = state as unknown as MarkdownSerializerStateCompat
  var StateCtor = MarkdownSerializerState as unknown as MarkdownSerializerStateCompatConstructor
  var tempState = new StateCtor(serializerState.nodes, serializerState.marks, serializerState.options)
  tempState.renderInline(cell, true)
  return escapeTableCellContent(tempState.out)
}

// 序列化单个块节点为 markdown 源码：MarkdownSerializer.serialize 只会遍历
// content 的子节点逐个渲染（serialize(doc) 即渲染各顶层块），对 table 这类
// 复合块必须自建 state 直接 render 节点本身，才能命中 nodes.table 序列化器。
// options 传 {} 与 serialize() 内部默认一致（本项目序列化器未定制 options）。
// 供 DecoMenu「复制源码」等单块导出场景使用，不产生任何文档变更。
export function serializeNodeMarkdown(serializer: MarkdownSerializer, node: PMNode): string {
  // d.ts 未暴露构造签名（render 的 parent/index 可省略），
  // 与 serializeTableCell 同样走 Compat 构造类型转换
  var StateCtor = MarkdownSerializerState as unknown as MarkdownSerializerStateCompatConstructor
  var state = new StateCtor(serializer.nodes, serializer.marks, {})
  state.render(node)
  return state.out
}

// GFM 分隔符按列对齐还原：left → :---，center → :---:，right → ---:，默认 ---。
function serializeTableDelimiter(align: string | null): string {
  if (align === "left") {
    return ":---"
  }
  if (align === "center") {
    return ":---:"
  }
  if (align === "right") {
    return "---:"
  }
  return "---"
}

export function buildMarkdownSerializer(_schema: Schema): MarkdownSerializer {
  var nodes = Object.assign({}, defaultMarkdownSerializer.nodes)
  nodes.table = function (state, node) {
    state.ensureNewLine()

    var rows: PMNode[] = []
    node.forEach(function (child) {
      var childName = child && child.type ? child.type.name : ""
      if (childName === "table_head" || childName === "table_body") {
        child.forEach(function (row) {
          rows.push(row)
        })
        return
      }
      if (childName === "table_row") {
        rows.push(child)
      }
    })
    if (rows.length === 0) {
      state.write("|  |")
      state.write("\n| --- |")
      state.closeBlock(node)
      return
    }

    var rowValues = rows.map(function (row) {
      var values: string[] = []
      row.forEach(function (cell) {
        values.push(serializeTableCell(state, cell))
      })
      return values
    })

    var colCount = 0
    for (var i = 0; i < rowValues.length; i += 1) {
      if (rowValues[i].length > colCount) {
        colCount = rowValues[i].length
      }
    }
    if (colCount < 1) {
      colCount = 1
    }

    for (var rowIndex = 0; rowIndex < rowValues.length; rowIndex += 1) {
      while (rowValues[rowIndex].length < colCount) {
        rowValues[rowIndex].push("")
      }
    }

    var headerRow = rowValues[0]
    // 分隔行按列还原 GFM 对齐：对齐以表头行（rows[0]）各列 cell 的 align 为准，
    // 与解析端“markdown-it 逐 cell 写 style”互为镜像；表头缺列时补位列为默认 ---。
    var alignByCol: Array<string | null> = []
    var headerNode = rows[0]
    if (headerNode) {
      headerNode.forEach(function (cell, _offset, index) {
        alignByCol[index] = cell.attrs && cell.attrs.align ? String(cell.attrs.align) : null
      })
    }
    var delimiterRow: string[] = []
    for (var colIndex = 0; colIndex < colCount; colIndex += 1) {
      delimiterRow.push(serializeTableDelimiter(alignByCol[colIndex]))
    }

    state.write("| " + headerRow.join(" | ") + " |")
    state.write("\n| " + delimiterRow.join(" | ") + " |")

    for (var bodyIndex = 1; bodyIndex < rowValues.length; bodyIndex += 1) {
      state.write("\n| " + rowValues[bodyIndex].join(" | ") + " |")
    }
    state.closeBlock(node)
  }
  nodes.image = function (state, node) {
    var alt = escapeMarkdownLabelText(node.attrs && node.attrs.alt ? node.attrs.alt : "")
    var src = String(node.attrs && node.attrs.src ? node.attrs.src : "").replace(/[\(\)]/g, "\\$&")
    var title = node.attrs && node.attrs.title ? " \"" + String(node.attrs.title).replace(/"/g, "\\\"") + "\"" : ""
    state.write("![" + alt + "](" + src + title + ")")
  }
  nodes.hard_break = function (state) {
    // Keep single-line markdown breaks as plain "\n" to avoid adding trailing backslashes.
    state.write("\n")
  }
  nodes.raw_inline = function (state, node) {
    // Important: raw content must not be escaped.
    state.text(node.textContent, false)
  }
  nodes.raw_block = function (state, node) {
    // Important: raw content must not be escaped or normalized.
    state.write(node.textContent)
    state.closeBlock(node)
  }

  var marks = Object.assign({}, defaultMarkdownSerializer.marks, {
    strike: {
      open: "~~",
      close: "~~",
      mixable: true,
      expelEnclosingWhitespace: true
    },
    underline: {
      open: "<u>",
      close: "</u>",
      mixable: true
    },
    highlight: {
      open: "<mark>",
      close: "</mark>",
      mixable: true
    },
    subscript: {
      open: "<sub>",
      close: "</sub>",
      mixable: true
    },
    superscript: {
      open: "<sup>",
      close: "</sup>",
      mixable: true
    },
    kbd: {
      open: "<kbd>",
      close: "</kbd>",
      mixable: true
    },
    abbreviation: {
      open: function (state: MarkdownSerializerState, mark: any): string {
        var title = mark.attrs && mark.attrs.title ? String(mark.attrs.title) : ""
        if (title) {
          return '<abbr title="' + title.replace(/"/g, "&quot;") + '">'
        }
        return "<abbr>"
      },
      close: "</abbr>",
      mixable: true
    }
  })
  return new MarkdownSerializer(nodes, marks)
}

var RAW_BLOCK_HTML_TAGS = /^<(?:div|section|article|aside|header|footer|nav|main|figure|details|dl|form|fieldset|video|audio|picture|canvas|svg|style|script)\b/i

function countHtmlTagBalance(line: string, tagName: string) {
  var openPattern = new RegExp("<" + tagName + "(?:\\s[^>]*?)?/?>", "gi")
  var closePattern = new RegExp("</" + tagName + "\\s*>", "gi")
  var balance = 0
  var match
  while ((match = openPattern.exec(line))) {
    if (/\/>\s*$/.test(match[0])) {
      continue
    }
    balance += 1
  }
  while ((match = closePattern.exec(line))) {
    balance -= 1
  }
  return balance
}

function splitIntoRawBlockSegments(markdown: string): RawBlockSegment[] {
  var lines = normalizeNewlines(markdown).split("\n")
  var segments: RawBlockSegment[] = []
  var mdBuffer: string[] = []
  var frontmatterHandled = false

  function flushMarkdown() {
    if (mdBuffer.length === 0) {
      return
    }
    segments.push({kind: "markdown", text: mdBuffer.join("\n")})
    mdBuffer = []
  }

  // 跟踪 ``` / ~~~ 代码围栏状态：围栏内的行一律进 mdBuffer，
  // 否则围栏中夹的 HTML 文档/标签行会被 raw block 分支抽走，破坏围栏结构。
  var inFence = false
  var fenceClosePattern: RegExp | null = null

  for (var i = 0; i < lines.length;) {
    var line = lines[i]
    var trimmed = line.trim()
    var isDocStart = !frontmatterHandled
    frontmatterHandled = true

    if (inFence) {
      mdBuffer.push(line)
      if (fenceClosePattern && fenceClosePattern.test(trimmed)) {
        inFence = false
        fenceClosePattern = null
      }
      i += 1
      continue
    }

    var fenceOpenMatch = trimmed.match(/^(`{3,}|~{3,})/)
    if (fenceOpenMatch) {
      var fenceMarker = fenceOpenMatch[1]
      inFence = true
      fenceClosePattern = new RegExp("^" + fenceMarker.charAt(0) + "{" + fenceMarker.length + ",}\\s*$")
      mdBuffer.push(line)
      i += 1
      continue
    }

    if (isDocStart && trimmed === "---") {
      flushMarkdown()
      var frontmatterLines = [line]
      i += 1
      for (; i < lines.length; i += 1) {
        frontmatterLines.push(lines[i])
        var endLine = lines[i].trim()
        if (endLine === "---" || endLine === "...") {
          i += 1
          break
        }
      }
      segments.push({ kind: "raw_block", text: frontmatterLines.join("\n") })
      continue
    }

    // 完整 HTML 文档（以 <!DOCTYPE html> 或 <html> 开头）整体收集为一个 raw_block，
    // 避免 html/head/body/meta 等行落入 markdown-it（html: false）被转义成段落文本。
    if (/^<!doctype\b/i.test(trimmed) || /^<html\b/i.test(trimmed)) {
      flushMarkdown()
      var docLines = [line]
      var docOpened = /^<html\b/i.test(trimmed)
      var docDepth = countHtmlTagBalance(line, "html")
      i += 1
      while (i < lines.length && (docDepth > 0 || !docOpened)) {
        docLines.push(lines[i])
        docDepth += countHtmlTagBalance(lines[i], "html")
        if (!docOpened && /^<html\b/i.test(lines[i].trim())) {
          docOpened = true
        }
        i += 1
      }
      segments.push({kind: "raw_block", text: docLines.join("\n")})
      continue
    }

    if (trimmed === "$$") {
      flushMarkdown()
      var blockLines = [line]
      i += 1
      for (; i < lines.length; i += 1) {
        blockLines.push(lines[i])
        if (lines[i].trim() === "$$") {
          i += 1
          break
        }
      }
      segments.push({kind: "raw_block", text: blockLines.join("\n")})
      continue
    }

    if (/^\[\^[^]]+\]:/.test(line)) {
      flushMarkdown()
      var footnoteLines = [line]
      i += 1
      for (; i < lines.length; i += 1) {
        var next = lines[i]
        if (next.trim() === "") {
          break
        }
        if (/^(?: {4}|\t)/.test(next)) {
          footnoteLines.push(next)
          continue
        }
        break
      }
      segments.push({kind: "raw_block", text: footnoteLines.join("\n")})
      continue
    }

    if (/^<iframe\b/i.test(trimmed)) {
      flushMarkdown()
      var iframeLines = [line]
      var iframeClosed = /<\/iframe>\s*$/i.test(line)
      i += 1
      for (; i < lines.length && !iframeClosed; i += 1) {
        iframeLines.push(lines[i])
        if (/<\/iframe>\s*$/i.test(lines[i])) {
          iframeClosed = true
          i += 1
          break
        }
      }
      segments.push({kind: "raw_block", text: iframeLines.join("\n")})
      continue
    }

    if (RAW_BLOCK_HTML_TAGS.test(trimmed)) {
      var tagMatch = trimmed.match(/^<([a-zA-Z][a-zA-Z0-9-]*)/)
      var htmlTagName = tagMatch ? tagMatch[1].toLowerCase() : ""
      if (htmlTagName) {
        flushMarkdown()
        var htmlLines = [line]
        var htmlDepth = countHtmlTagBalance(line, htmlTagName)
        i += 1
        while (i < lines.length && htmlDepth > 0) {
          htmlLines.push(lines[i])
          htmlDepth += countHtmlTagBalance(lines[i], htmlTagName)
          i += 1
        }
        segments.push({kind: "raw_block", text: htmlLines.join("\n")})
        continue
      }
    }

    mdBuffer.push(line)
    i += 1
  }

  flushMarkdown()
  return segments
}

function splitRawInlineText(text: string): RawInlineSegment[] {
  var input = String(text == null ? "" : text)
  if (!input) {
    return [{kind: "text", text: ""}]
  }

  var pattern = /\[\^[^]]+\]|\$\$[^\n]+?\$\$|\$(?!\$)[^\n]+?\$(?!\$)/g
  var out: RawInlineSegment[] = []
  var last = 0
  var match
  while ((match = pattern.exec(input))) {
    if (match.index > last) {
      out.push({kind: "text", text: input.slice(last, match.index)})
    }
    out.push({kind: "raw_inline", text: match[0]})
    last = match.index + match[0].length
  }
  if (last < input.length) {
    out.push({kind: "text", text: input.slice(last)})
  }
  return out.length ? out : [{kind: "text", text: input}]
}

var HTML_INLINE_TAG_TO_MARK: Record<string, string> = {
  u: "underline",
  mark: "highlight",
  sub: "subscript",
  sup: "superscript",
  kbd: "kbd",
  abbr: "abbreviation"
}

// 标签列表统一从 HTML_INLINE_TAG_TO_MARK 派生，避免多处硬编码漂移。
var HTML_INLINE_TAG_ALT = Object.keys(HTML_INLINE_TAG_TO_MARK).join("|")

function parseAbbrTitleAttrs(attrText: string): string | null {
  var match = attrText.match(/\btitle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i)
  if (!match) {
    return null
  }
  return match[1] != null ? match[1] : (match[2] != null ? match[2] : match[3])
}

function hasHtmlInlineTag(text: string) {
  return new RegExp("<(?:" + HTML_INLINE_TAG_ALT + ")\\b", "i").test(text)
}

// 把 text 切分为带行内 HTML mark 的节点序列。
// 纯文本段沿用 splitRawInlineText 的 raw_inline 行为（$$、脚注），
// 标签段的内容递归处理以支持嵌套（如 <u>H<sub>2</sub>O</u>）。
function splitHtmlInlineTags(
  text: string,
  marks: JSONMark[] | undefined,
  out: JSONNodeData[]
): boolean {
  var input = String(text == null ? "" : text)
  if (!input || !hasHtmlInlineTag(input)) {
    return false
  }

  function emitPlain(plain: string) {
    if (!plain) {
      return
    }
    var parts = splitRawInlineText(plain)
    for (var i = 0; i < parts.length; i += 1) {
      if (!parts[i].text) {
        continue
      }
      if (parts[i].kind === "raw_inline") {
        out.push({type: "raw_inline", content: [{type: "text", text: parts[i].text}]})
        continue
      }
      var textNode: JSONNodeData = {type: "text", text: parts[i].text}
      if (marks) {
        textNode.marks = marks
      }
      out.push(textNode)
    }
  }

  var matched = false
  var last = 0
  var match
  // 注意：必须使用局部正则。共享 /g 正则在递归调用中会被重置 lastIndex，
  // 导致外层 exec 循环重复匹配同一位置，引发死循环。
  var pattern = new RegExp("<(" + HTML_INLINE_TAG_ALT + ")((?:\\s[^>]*)?)>([\\s\\S]*?)<\\/\\1\\s*>", "gi")
  while ((match = pattern.exec(input))) {
    emitPlain(input.slice(last, match.index))

    var markType = HTML_INLINE_TAG_TO_MARK[match[1].toLowerCase()]
    if (markType) {
      matched = true
      var markJSON: JSONMark = {type: markType}
      if (markType === "abbreviation") {
        var title = parseAbbrTitleAttrs(match[2] || "")
        markJSON.attrs = {title: title}
      }
      var innerMarks = (marks || []).concat([markJSON])
      var innerOut: JSONNodeData[] = []
      if (splitHtmlInlineTags(match[3], innerMarks, innerOut)) {
        for (var j = 0; j < innerOut.length; j += 1) {
          out.push(innerOut[j])
        }
      } else if (match[3]) {
        var plainParts = splitRawInlineText(match[3])
        for (var k = 0; k < plainParts.length; k += 1) {
          if (!plainParts[k].text) {
            continue
          }
          if (plainParts[k].kind === "raw_inline") {
            out.push({type: "raw_inline", content: [{type: "text", text: plainParts[k].text}]})
            continue
          }
          var plainNode: JSONNodeData = {type: "text", text: plainParts[k].text, marks: innerMarks}
          out.push(plainNode)
        }
      }
    } else {
      // 未映射的标签原样输出
      emitPlain(match[0])
    }
    last = match.index + match[0].length
  }
  if (last < input.length) {
    emitPlain(input.slice(last))
  }
  return matched
}

function protectRawInlinePlaceholders(text: string): { text: string; placeholders: RawInlinePlaceholder[] } {
  var input = String(text == null ? "" : text)
  if (!input) {
    return {text: "", placeholders: []}
  }

  var pattern = /\[\^[^]]+\]|\$\$[^\n]+?\$\$|\$(?!\$)[^\n]+?\$(?!\$)/g
  var placeholders: RawInlinePlaceholder[] = []
  var out = ""
  var last = 0
  var match

  while ((match = pattern.exec(input))) {
    out += input.slice(last, match.index)
    var token: string = "\uE000SEDITOR_RAW_INLINE_" + placeholders.length + "\uE001"
    placeholders.push({token: token, raw: match[0]})
    out += token
    last = match.index + match[0].length
  }

  out += input.slice(last)
  return {text: out, placeholders: placeholders}
}

function escapeRegExp(text: string) {
  return String(text == null ? "" : text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function replaceRawInlinePlaceholdersInDoc(schema: Schema, doc: PMNode, placeholders: RawInlinePlaceholder[]): PMNode {
  if (!placeholders || placeholders.length < 1) {
    return doc
  }

  var byToken: Record<string, string> = {}
  var parts: string[] = []
  for (var i = 0; i < placeholders.length; i += 1) {
    var item = placeholders[i]
    if (!item || !item.token) {
      continue
    }
    byToken[item.token] = item.raw || ""
    parts.push(escapeRegExp(item.token))
  }
  if (parts.length < 1) {
    return doc
  }

  var tokenPattern = new RegExp(parts.join("|"), "g")

  function splitTextByToken(text: string, marks?: JSONMark[]) {
    tokenPattern.lastIndex = 0
    var out: JSONNodeData[] = []
    var last = 0
    var match

    while ((match = tokenPattern.exec(text))) {
      if (match.index > last) {
        var beforeText: JSONNodeData = {type: "text", text: text.slice(last, match.index)}
        if (marks) {
          beforeText.marks = marks
        }
        out.push(beforeText)
      }

      var raw = byToken[match[0]]
      if (raw) {
        out.push({type: "raw_inline", content: [{type: "text", text: raw}]})
      } else {
        var tokenText: JSONNodeData = {type: "text", text: match[0]}
        if (marks) {
          tokenText.marks = marks
        }
        out.push(tokenText)
      }
      last = match.index + match[0].length
    }

    if (last < text.length) {
      var tailText: JSONNodeData = {type: "text", text: text.slice(last)}
      if (marks) {
        tailText.marks = marks
      }
      out.push(tailText)
    }

    if (out.length < 1) {
      var original: JSONNodeData = {type: "text", text: text}
      if (marks) {
        original.marks = marks
      }
      out.push(original)
    }
    return out
  }

  function walk(nodeJSON: any): any {
    if (!nodeJSON || typeof nodeJSON !== "object") {
      return nodeJSON
    }
    if (nodeJSON.type === "raw_block" || nodeJSON.type === "raw_inline" || nodeJSON.type === "code_block") {
      return nodeJSON
    }
    if (nodeJSON.content && Array.isArray(nodeJSON.content)) {
      nodeJSON.content = nodeJSON.content.map(walk)
    }
    if (nodeJSON.type === "text" && typeof nodeJSON.text === "string") {
      if (nodeJSON.marks && Array.isArray(nodeJSON.marks)) {
        for (var mi = 0; mi < nodeJSON.marks.length; mi += 1) {
          if (nodeJSON.marks[mi] && nodeJSON.marks[mi].type === "code") {
            return nodeJSON
          }
        }
      }
      return splitTextByToken(nodeJSON.text, nodeJSON.marks)
    }
    return nodeJSON
  }

  function flatten(nodeJSON: any): any[] {
    if (Array.isArray(nodeJSON)) {
      var out: JSONNodeData[] = []
      for (var i = 0; i < nodeJSON.length; i += 1) {
        var flat = flatten(nodeJSON[i])
        for (var j = 0; j < flat.length; j += 1) {
          out.push(flat[j])
        }
      }
      return out
    }
    if (nodeJSON && nodeJSON.content && Array.isArray(nodeJSON.content)) {
      var nextContent: any[] = []
      for (var k = 0; k < nodeJSON.content.length; k += 1) {
        var next = flatten(nodeJSON.content[k])
        for (var m = 0; m < next.length; m += 1) {
          nextContent.push(next[m])
        }
      }
      nodeJSON.content = nextContent
    }
    return [nodeJSON]
  }

  var walked = walk(doc.toJSON())
  var flattened = flatten(walked)[0]
  return schema.nodeFromJSON(flattened)
}

function replaceRawInlineInDoc(schema: Schema, doc: PMNode): PMNode {
  // Keep the transformation simple and explicit: rebuild via JSON.
  var json = doc.toJSON()

  function walk(nodeJSON: any): any {
    if (!nodeJSON || typeof nodeJSON !== "object") {
      return nodeJSON
    }
    if (nodeJSON.type === "raw_block" || nodeJSON.type === "raw_inline" || nodeJSON.type === "code_block") {
      return nodeJSON
    }
    if (nodeJSON.content && Array.isArray(nodeJSON.content)) {
      nodeJSON.content = nodeJSON.content.map(walk)
    }
    if (nodeJSON.type === "text" && typeof nodeJSON.text === "string") {
      if (nodeJSON.marks && Array.isArray(nodeJSON.marks)) {
        for (var mi = 0; mi < nodeJSON.marks.length; mi += 1) {
          if (nodeJSON.marks[mi] && nodeJSON.marks[mi].type === "code") {
            return nodeJSON
          }
        }
      }
      var htmlOut: JSONNodeData[] = []
      if (splitHtmlInlineTags(nodeJSON.text, nodeJSON.marks, htmlOut)) {
        return htmlOut.length ? htmlOut : nodeJSON
      }
      var parts = splitRawInlineText(nodeJSON.text)
      if (parts.length === 1 && parts[0].kind === "text") {
        return nodeJSON
      }
      var marks = nodeJSON.marks
      var out: JSONNodeData[] = []
      for (var i = 0; i < parts.length; i += 1) {
        var p = parts[i]
        if (!p.text) {
          continue
        }
        if (p.kind === "raw_inline") {
          out.push({type: "raw_inline", content: [{type: "text", text: p.text}]})
          continue
        }
        var textNode: JSONNodeData = {type: "text", text: p.text}
        if (marks) {
          textNode.marks = marks
        }
        out.push(textNode)
      }
      return out
    }
    return nodeJSON
  }

  function flatten(nodeJSON: any): any[] {
    if (Array.isArray(nodeJSON)) {
      var out: JSONNodeData[] = []
      for (var i = 0; i < nodeJSON.length; i += 1) {
        var flat = flatten(nodeJSON[i])
        for (var j = 0; j < flat.length; j += 1) {
          out.push(flat[j])
        }
      }
      return out
    }
    if (nodeJSON && nodeJSON.content && Array.isArray(nodeJSON.content)) {
      var nextContent: any[] = []
      for (var k = 0; k < nodeJSON.content.length; k += 1) {
        var next = flatten(nodeJSON.content[k])
        for (var m = 0; m < next.length; m += 1) {
          nextContent.push(next[m])
        }
      }
      nodeJSON.content = nextContent
    }
    return [nodeJSON]
  }

  var walked = walk(json)
  var flattened = flatten(walked)[0]
  return schema.nodeFromJSON(flattened)
}

export function parseMarkdown(schema: Schema, parser: MarkdownParser, markdown: string): PMNode {
  var segments = splitIntoRawBlockSegments(markdown)
  var blocks: PMNode[] = []

  for (var idx = 0; idx < segments.length; idx += 1) {
    var seg = segments[idx]
    if (seg.kind === "raw_block") {
      var rawText = seg.text
      var rawContent = rawText ? schema.text(rawText) : null
      blocks.push(schema.nodes.raw_block.create(null, rawContent))
      continue
    }

    var protectedMarkdown = protectRawInlinePlaceholders(seg.text || "")
    var parsed = parser.parse(protectedMarkdown.text || "")
    var converted = schema.nodeFromJSON(parsed.toJSON())
    converted = replaceRawInlinePlaceholdersInDoc(schema, converted, protectedMarkdown.placeholders)
    converted.content.forEach(function (child) {
      blocks.push(child)
    })
  }

  if (blocks.length === 0) {
    blocks.push(schema.nodes.paragraph.create())
  }

  var doc = schema.nodes.doc.create(null, blocks)
  return replaceRawInlineInDoc(schema, doc)
}
