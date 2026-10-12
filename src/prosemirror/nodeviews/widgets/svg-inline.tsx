// Widget NodeView：行内 SVG（raw_inline 中文本为单个 <svg>...</svg>，出现在段落文本中间）。
// inline Widget：span 容器 + sanitize 后的 svg（复用块级的 parseSvgRawBlockSource，
// 同一套 DOMParser 严格解析 + 白名单清洗）；解析失败时回退显示源码文本（error 态）。
// 交互与行内公式一致：ignoreMutation / stopEvent 全拦，无块级选中。
// 尺寸由 formula.css 的 .md-editor-raw-inline-svg svg 约束（按字高量级封顶，
// 避免无尺寸声明的 svg 以默认 300x150 撑爆行内排版）。
import { Node as PMNode } from "prosemirror-model"
import { h } from "../../../jsx"
import { setClass } from "../../../utils"
import { returnTrue } from "../types"
import { isSvgRawBlockText, parseSvgRawBlockSource } from "../kinds"

export function createRawInlineSvgNodeView(node: PMNode) {
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
    stopEvent: returnTrue
  }
}