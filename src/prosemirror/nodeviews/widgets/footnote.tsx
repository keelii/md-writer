// Widget NodeView：脚注。
// 定义块（[^label]: …，含 4 空格 / Tab 缩进续行）渲染为只读卡片：
// label 徽标 + 定义文本；行内引用（raw_inline `[^label]`）渲染为 sup 上标。
// 渲染来源是 markdown DSL → 自建 renderer 产出只读 DOM，无外部交互内容；
// 不设 stopEvent，点击放行 PM 原生 selectClickedLeaf（raw_block / raw_inline
// 为 atom）产生 NodeSelection，选中后可直接 Backspace 删除。
import { Node as PMNode } from "prosemirror-model"
import { h } from "../../../jsx"
import { returnTrue } from "../types"
import { getRawBlockKind, parseFootnoteRawBlockSource, parseFootnoteRawInlineSource } from "../kinds"
import { createRawBlockShell } from "../raw-block-shell"
import "./footnote.css"

export function createFootnoteRawBlockNodeView(node: PMNode) {
  if (node.type.name !== "raw_block") {
    return null
  }
  if (getRawBlockKind(node.textContent) !== "footnote") {
    return null
  }

  var shell = createRawBlockShell()
  var dom = shell.dom

  function renderFootnote(source: string) {
    var parsed = parseFootnoteRawBlockSource(source)
    if (!parsed) {
      shell.renderError("脚注预览不可用，请切换源码模式修改。")
      return
    }
    shell.setBodyClass("md-editor-raw-footnote-preview")
    shell.body.textContent = ""
    shell.body.appendChild(
      <span className="md-editor-footnote-label">{parsed.label}</span>
    )
    shell.body.appendChild(
      <div className="md-editor-footnote-text">{parsed.lines.join("\n")}</div>
    )
  }

  renderFootnote(node.textContent)

  return {
    dom: dom,
    update: function (nextNode: PMNode) {
      if (nextNode.type.name !== "raw_block") {
        return false
      }
      if (nextNode.textContent !== node.textContent) {
        // 跨 kind 变化交回分派器，同 kind 内文本变化原地重渲染
        if (getRawBlockKind(nextNode.textContent) !== "footnote") {
          return false
        }
        renderFootnote(nextNode.textContent)
      }
      node = nextNode
      return true
    },
    ignoreMutation: returnTrue
  }
}

// 行内脚注引用（raw_inline `[^label]`）：inline Widget，渲染为 sup 上标。
export function createFootnoteRefRawInlineNodeView(node: PMNode) {
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

  return {
    dom: dom,
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
        dom.textContent = nextParsed.label
      }
      node = nextNode
      return true
    },
    ignoreMutation: returnTrue
  }
}