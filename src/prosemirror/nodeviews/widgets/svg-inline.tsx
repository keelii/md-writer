// Widget NodeView：行内 SVG（raw_inline 中文本为单个 <svg>...</svg>，出现在段落文本中间）。
// inline Widget：span 容器 + sanitize 后的 svg（复用块级的 parseSvgRawBlockSource，
// 同一套 DOMParser 严格解析 + 白名单清洗）；解析失败时回退显示源码文本（error 态）。
// 选中交互：raw_inline 是 atom，点击应产生 NodeSelection（同脚注引用），
// 由 NodeView 自行在 mousedown 中定位 getPos 并 dispatch，同时暴露
// selectNode / deselectNode 挂 ProseMirror-selectednode 选中态类。
// ignoreMutation 仍全拦；stopEvent 保持全拦（点击由 mousedown 自接管）。
// 尺寸由 formula.css 的 .md-editor-raw-inline-svg svg 约束（按字高量级封顶，
// 避免无尺寸声明的 svg 以默认 300x150 撑爆行内排版）。
import { Node as PMNode } from "prosemirror-model"
import { NodeSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { h } from "../../../jsx"
import { setClass } from "../../../utils"
import { returnTrue } from "../types"
import { isSvgRawBlockText, parseSvgRawBlockSource } from "../kinds"

export function createRawInlineSvgNodeView(node: PMNode, view?: EditorView, getPos?: () => number) {
  if (node.type.name !== "raw_inline") {
    return null
  }
  if (!isSvgRawBlockText(node.textContent)) {
    return null
  }

  var dom = <span className="md-editor-raw-inline-preview md-editor-raw-inline-svg" contenteditable="false" />

  function render(nextNode: PMNode) {
    var svg = parseSvgRawBlockSource(nextNode.textContent)
    if (!svg) {
      setClass(dom, "md-editor-raw-inline-preview md-editor-raw-inline-preview-error")
      dom.textContent = nextNode.textContent
      return
    }
    setClass(dom, "md-editor-raw-inline-preview md-editor-raw-inline-svg")
    dom.textContent = ""
    dom.appendChild(svg)
  }

  // 点击选中本节点：svg 元素内部无文本锚点，PM 的 posFromDOM 在 <svg> 内取不到
  // 位置，须由 NodeView 在 mousedown 时主动 dispatch NodeSelection；
  // preventDefault 阻止 PM 把光标摆到节点前后。
  function handleMousedown(event: MouseEvent) {
    if (!view || !getPos) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    var pos = getPos()
    if (typeof pos !== "number" || pos < 0) {
      return
    }
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
    view.focus()
  }

  if (view) {
    dom.addEventListener("mousedown", handleMousedown)
  }

  render(node)

  return {
    dom: dom,
    update: function (nextNode: PMNode) {
      if (nextNode.type.name !== "raw_inline") {
        return false
      }
      // 非 svg 文本交回分派器（脚注/公式），同 svg 内文本变化原地重渲染
      if (!isSvgRawBlockText(nextNode.textContent)) {
        return false
      }
      if (nextNode.textContent !== node.textContent) {
        render(nextNode)
      }
      node = nextNode
      return true
    },
    ignoreMutation: returnTrue,
    stopEvent: returnTrue,
    selectNode: function () {
      dom.classList.add("ProseMirror-selectednode")
    },
    deselectNode: function () {
      dom.classList.remove("ProseMirror-selectednode")
    }
  }
}