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
          showCopySuccess()
          ctx.view.focus()
        }).catch(function (error) {
          console.warn("copy code block failed", error)
        })
      }}
    />
  )
  // 复制成功态：图标换成绿色对勾（CSS pop 动画），短暂展示后恢复剪贴板图标；
  // 重复点击重置计时，destroy 时清掉定时器
  var successTimer: ReturnType<typeof setTimeout> | null = null
  function showCopySuccess() {
    if (successTimer !== null) {
      clearTimeout(successTimer)
    }
    button.classList.add("md-editor-code-block-copy-success")
    button.innerHTML = SvgIcon.clipboardCheck
    successTimer = setTimeout(function () {
      successTimer = null
      button.classList.remove("md-editor-code-block-copy-success")
      button.innerHTML = SvgIcon.clipboard
    }, 1600)
  }
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
    },
    // 复制成功态会改 button 的 innerHTML（对勾图标切换），这发生在 NodeView DOM
    // 内部：不忽略的话 PM 的 DOMObserver 会把该 mutation 当成编辑器内容变化，
    // 触发 NodeView 重建（成功态被初始态按钮替换、恢复 timer 被 destroy 清掉）。
    // code 内的文本 mutation 不经过此分支，编辑照常。
    ignoreMutation: function (mutation: MutationRecord) {
      return button.contains(mutation.target)
    },
    destroy: function () {
      if (successTimer !== null) {
        clearTimeout(successTimer)
        successTimer = null
      }
    }
  }
}