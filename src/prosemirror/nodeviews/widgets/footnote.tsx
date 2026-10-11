// Widget NodeView：脚注。
// 定义块（[^label]: …，含 4 空格 / Tab 缩进续行）不渲染可见内容——定义的查看
// 与编辑只发生在行内引用（raw_inline `[^label]`）选中弹出的 tooltip 里，正文
// 中定义块只留一个 display:none 的占位（raw_block 是 atom 且必须持有 DOM）。
// markdown 保真：节点原文保留在文档中，源码模式可见，序列化原样往返。
// 删除定义块：相邻文本块边界 Backspace 整删（deleteAdjacentPreviewBlock）。
import { Node as PMNode, Schema } from "prosemirror-model"
import { EditorState, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { history, undo, redo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { baseKeymap, toggleMark } from "prosemirror-commands"
import { MarkdownParser, MarkdownSerializer } from "prosemirror-markdown"
import { h } from "../../../jsx"
import { returnTrue } from "../types"
import { buildMarkdownParser, buildMarkdownSerializer, serializeNodeMarkdown } from "../../markdown"
import { getRawBlockKind, parseFootnoteRawBlockSource, parseFootnoteRawInlineSource } from "../kinds"
import { createPreviewSourceReplaceCommand } from "../../commands"
import "./footnote.css"

// 定义块隐藏占位：DOM 必须存在（raw_block 是 atom，prosemirror-view 要求每个
// 节点持有 DOM），但不可见、无交互——hover 菜单、点击选中都天然不会发生。
export function createFootnoteRawBlockNodeView(node: PMNode) {
  if (node.type.name !== "raw_block") {
    return null
  }
  if (getRawBlockKind(node.textContent) !== "footnote") {
    return null
  }

  var dom = <div className="md-editor-raw-footnote-def" contenteditable="false" />

  return {
    dom: dom,
    update: function (nextNode: PMNode) {
      if (nextNode.type.name !== "raw_block") {
        return false
      }
      // 跨 kind 变化交回分派器，同 kind 内文本变化继续隐藏占位
      if (getRawBlockKind(nextNode.textContent) !== "footnote") {
        return false
      }
      node = nextNode
      return true
    },
    ignoreMutation: returnTrue
  }
}

// 行内脚注引用（raw_inline `[^label]`）：inline Widget，渲染为 sup 上标。
// 官方 footnote 例子的结构（prosemirror.net/examples/footnote）适配版：
// 开合由 PM 原生 NodeSelection 驱动——点击 / 方向键移入产生 NodeSelection 触发
// selectNode 打开，选中移走触发 deselectNode 提交收起。tooltip 内是嵌套 PM
// 子编辑器（new EditorView），doc 由定义块文本按行构建；与官方不同的是我们的
// 定义文本在文档另一处的 raw_block（markdown 保真：引用节点内只有 label），
// 展示文本是剥掉 `[^label]: ` 前缀与续行缩进的结果，无法像官方那样用
// StepMap 把子编辑器 steps 偏移映射回外层文档——提交走
// createPreviewSourceReplaceCommand 整块替换（undo 为外层一次原子历史）。
// Esc 丢弃改动静默关闭；找不到定义时只读提示。
// 单行定义文本 → 段落节点：markdown-it 行内语法解析为带 marks 的 inline 内容
// （加粗 / 斜体 / 删除线 / 行内代码 / 链接 / 图片…），提交时按原语法序列化回去。
// 空行或解析撞上块级语法（"- 项"、"# 标题"等会被解析成别的块）时退回纯文本段落，
// 保证打开未编辑的往返保真。
function parseFootnoteLineParagraph(parser: MarkdownParser, schema: Schema, line: string): PMNode {
  if (line === "") {
    return schema.nodes.paragraph.create(null, undefined)
  }
  var parsed: PMNode | null = null
  try {
    parsed = parser.parse(line)
  } catch (error) {
    parsed = null
  }
  if (!parsed || parsed.childCount !== 1 || parsed.child(0).type.name !== "paragraph") {
    return schema.nodes.paragraph.create(null, schema.text(line))
  }
  return parsed.child(0)
}

// 段落节点 → 单行定义文本：走序列化器把 marks 还原为 **/* 等源码语法，
// closeBlock 写入的收尾换行剥掉（一行一段，换行由 buildFootnoteDefinitionSource 补）。
function serializeFootnoteLineParagraph(serializer: MarkdownSerializer, paragraph: PMNode): string {
  var out = serializeNodeMarkdown(serializer, paragraph)
  return out.replace(/\n$/, "")
}

export function createFootnoteRefRawInlineNodeView(node: PMNode, view?: EditorView, getPos?: () => number) {
  if (node.type.name !== "raw_inline") {
    return null
  }
  var parsed = parseFootnoteRawInlineSource(node.textContent)
  if (!parsed) {
    return null
  }

  var label = parsed.label
  var dom = (
    <sup className="md-editor-raw-inline-footnote" contenteditable="false">{label}</sup>
  )
  var tooltip: HTMLElement | null = null
  var innerView: EditorView | null = null
  // 打开时子编辑器内容的序列化文本：提交以此为基线判断是否有编辑，
  // 避免行内语法往返的转义差异在未编辑时产生假变更
  var initialText = ""
  // Esc 关闭时置 true：deselectNode 据此跳过提交，其余关闭路径（点击外部、
  // Ctrl+Enter）均提交
  var discardOnClose = false

  // 按当前 doc 查找同 label 的脚注定义块，返回其在 doc 中的位置与源文本
  function findDefinition(): { pos: number, source: string } | null {
    if (!view) {
      return null
    }
    var found: { pos: number, source: string } | null = null
    view.state.doc.descendants(function (current: PMNode, pos: number) {
      if (found || current.type.name !== "raw_block") {
        return false
      }
      var source = current.textContent
      if (getRawBlockKind(source) === "footnote") {
        var def = parseFootnoteRawBlockSource(source)
        if (def && def.label === label) {
          found = { pos: pos, source: source }
        }
      }
      return false
    })
    return found
  }

  // 子编辑器文本（首行 + 续行）还原为 raw_block 源文本：续行补 4 空格缩进
  function buildFootnoteDefinitionSource(text: string): string {
    var lines = text.replace(/\r\n?/g, "\n").split("\n")
    var out = "[^" + label + "]: " + lines[0]
    for (var i = 1; i < lines.length; i += 1) {
      out += "\n" + (lines[i] === "" ? "" : "    " + lines[i])
    }
    return out
  }

  // 子编辑器 doc → 定义文本：每个顶层段落序列化为一行 markdown 源码
  // （marks 还原为 **/* 等语法），段落本身不产出换行——换行由段落即一行的结构决定
  function serializeInnerDocText(doc: PMNode): string {
    if (!view) {
      return ""
    }
    var serializer = buildMarkdownSerializer(view.state.schema)
    var lines: string[] = []
    doc.forEach(function (child: PMNode) {
      lines.push(child.type.name === "paragraph" ? serializeFootnoteLineParagraph(serializer, child) : child.textContent)
    })
    return lines.join("\n")
  }

  function commitInnerEdit() {
    var def = findDefinition()
    if (!def || !innerView || !view) {
      return
    }
    var text = serializeInnerDocText(innerView.state.doc)
    // 对比打开时的序列化文本而非定义原文：未编辑（含行内语法原样往返）
    // 不触发任何文档变更；编辑过才整块替换写回
    if (text === initialText) {
      return
    }
    var source = buildFootnoteDefinitionSource(text)
    createPreviewSourceReplaceCommand(def.pos, source)(view.state, view.dispatch)
  }

  function closeTooltip() {
    if (innerView) {
      innerView.destroy()
      innerView = null
    }
    if (tooltip && tooltip.parentNode) {
      tooltip.parentNode.removeChild(tooltip)
    }
    tooltip = null
  }

  // 把光标移到引用之后：selection 从 NodeSelection 移走统一触发 deselectNode 收口
  function moveSelectionOut() {
    var pos = typeof getPos === "function" ? getPos() : null
    if (view && typeof pos === "number") {
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + node.nodeSize))
      )
    }
  }

  function openTooltip() {
    if (tooltip || !view) {
      return
    }
    var def = findDefinition()
    if (!def) {
      tooltip = (
        <span className="md-editor-tooltip md-editor-footnote-tooltip md-editor-footnote-tooltip-empty">
          {"未找到 [^" + label + "] 的定义"}
        </span>
      )
      dom.appendChild(tooltip)
      return
    }
    var parsedDef = parseFootnoteRawBlockSource(def.source)
    var lines = parsedDef ? parsedDef.lines : [""]
    tooltip = <span className="md-editor-tooltip md-editor-footnote-tooltip" />
    dom.appendChild(tooltip)
    // 子编辑器：每行一个段落，行内 markdown 语法解析为带 marks 的内容
    // （加粗/斜体等基本编辑能力；见 parseFootnoteLineParagraph）
    var schema = view.state.schema
    var parser = buildMarkdownParser(schema)
    var paragraphs: PMNode[] = []
    for (var i = 0; i < lines.length; i += 1) {
      paragraphs.push(parseFootnoteLineParagraph(parser, schema, lines[i]))
    }
    var innerDoc = schema.topNodeType.create(null, paragraphs)
    // 提交基线：未编辑（序列化文本不变）不产生文档变更
    initialText = serializeInnerDocText(innerDoc)
    // 快捷键：撤销/重做、Esc 丢弃、Cmd+Enter 提交在前，baseKeymap 兜底
    // Enter 分段 / Backspace 合并等；Mod-b / Mod-i 切换加粗斜体
    var innerBindings: Record<string, Command> = {
      "Mod-z": function () {
        if (innerView) {
          undo(innerView.state, innerView.dispatch)
          return true
        }
        return false
      },
      "Shift-Mod-z": function () {
        if (innerView) {
          redo(innerView.state, innerView.dispatch)
          return true
        }
        return false
      },
      "Mod-y": function () {
        if (innerView) {
          redo(innerView.state, innerView.dispatch)
          return true
        }
        return false
      },
      Escape: function () {
        discardOnClose = true
        moveSelectionOut()
        return true
      },
      "Mod-Enter": function () {
        moveSelectionOut()
        return true
      }
    }
    var strongMark = schema.marks.strong
    if (strongMark) {
      innerBindings["Mod-b"] = toggleMark(strongMark)
    }
    var emMark = schema.marks.em
    if (emMark) {
      innerBindings["Mod-i"] = toggleMark(emMark)
    }
    innerView = new EditorView(tooltip, {
      state: EditorState.create({
        doc: innerDoc,
        plugins: [history(), keymap(innerBindings), keymap(baseKeymap)]
      }),
      dispatchTransaction: function (tr) {
        if (!innerView) {
          return
        }
        var pair = innerView.state.applyTransaction(tr)
        innerView.updateState(pair.state)
      },
      handleDOMEvents: {
        // 官方 kludge：引用被 NodeSelection 选中时避免外层 DOM 选中态引发的焦点问题
        mousedown: function () {
          if (innerView && view && view.hasFocus()) {
            innerView.focus()
          }
          return false
        }
      }
    })
    innerView.focus()
  }

  return {
    dom: dom,
    selectNode: function () {
      dom.classList.add("ProseMirror-selectednode")
      openTooltip()
    },
    deselectNode: function () {
      dom.classList.remove("ProseMirror-selectednode")
      if (!discardOnClose) {
        commitInnerEdit()
      }
      discardOnClose = false
      closeTooltip()
    },
    update: function (nextNode: PMNode) {
      if (nextNode.type.name !== "raw_inline") {
        return false
      }
      var nextParsed = parseFootnoteRawInlineSource(nextNode.textContent)
      if (!nextParsed) {
        return false
      }
      if (nextParsed.label !== label) {
        label = nextParsed.label
        // label 已变，旧编辑内容对应旧定义，静默丢弃
        discardOnClose = true
        closeTooltip()
        discardOnClose = false
        dom.textContent = nextParsed.label
      }
      node = nextNode
      return true
    },
    stopEvent: function (event: Event) {
      // 官方同款：只有子编辑器内的事件不交给外层编辑器；tooltip 外（含 sup 本体）
      // 放行 PM 原生处理——sup 是 atom，mousedown 命中 selectClickedLeaf 产生
      // NodeSelection，正是打开 tooltip 的入口
      return !!(innerView && innerView.dom.contains(event.target as Node))
    },
    destroy: function () {
      // 节点被删除：tooltip 内未提交的编辑不写回
      discardOnClose = true
      closeTooltip()
    },
    ignoreMutation: returnTrue
  }
}