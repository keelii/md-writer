// Content NodeView：代码块复制按钮。
// PM 拥有 contentDOM（code 元素），内容编辑/选区/撤销完全由 PM 原生管理，
// NodeView 只叠加右上角复制 OpButton，stopEvent 仅隔离按钮点击。
// 语言切换与删除已迁至 DecoMenu（code-block-menu.tsx）；语法高亮由
// code-highlight.ts 的 Decoration 叠加，不在此处。
import { Node as PMNode } from "prosemirror-model"
import { h } from "../../../jsx"
import { copyTextToClipboard, stopEvent } from "../../../utils"
import { SvgIcon } from "../../../icons"
import { NodeViewContext } from "../types"
import { isMermaidCodeBlock } from "../kinds"
import "./code-block-copy.css"
import "../overlay-button.css"

export function createCodeBlockCopyNodeView(node: PMNode, ctx: NodeViewContext) {
  if (node.type.name !== "code_block" || isMermaidCodeBlock(node)) {
    return null
  }
  var button = (
    <button
      type="button"
      className="md-editor-overlay-button md-editor-code-block-copy"
      innerHTML={SvgIcon.clipboard}
      aria-label="复制代码到剪贴板"
      title="复制代码到剪贴板"
      contenteditable="false"
      onClick={function (event: MouseEvent) {
        stopEvent(event)
        copyTextToClipboard(node.textContent).then(function () {
          ctx.view.focus()
        }).catch(function (error) {
          console.warn("copy code block failed", error)
        })
      }}
    />
  )
  var code = <code />
  var dom = (
    <div className="md-editor-code-block-wrap">
      {button}
      <pre>{code}</pre>
    </div>
  )

  return {
    dom: dom,
    contentDOM: code,
    update: function (nextNode: PMNode) {
      if (nextNode.type.name !== "code_block" || isMermaidCodeBlock(nextNode)) {
        return false
      }
      node = nextNode
      return true
    },
    stopEvent: function (event: Event) {
      var target = event.target as Node | null
      if (target && button.contains(target)) {
        return true
      }
      return false
    }
  }
}