// Raw NodeView：raw_block 中的 iframe HTML。
// 渲染来源是用户书写的 HTML source（结构化解析后按属性白名单重建 iframe），
// DOM 不受编辑器控制。点击不主动整块选中：鼠标事件直达 iframe、
// 可直接与其内容交互（如播放视频）；整块删除两条路：光标移到块前后按 Backspace
// （PM joinBackward 对可选 leaf 节点会先整块选中、再按一次删除），
// 或 hover 块左侧节点操作菜单删除按钮（decoration 菜单是块的前置兄弟，不在 iframe 内）。
import { Node as PMNode } from "prosemirror-model"
import { h } from "../../../jsx"
import { resolveRhythmLineHeight } from "../../../utils"
import { NodeViewContext, returnTrue } from "../types"
import { getRawBlockKind, parseIframeRawBlockSource } from "../kinds"
import { createRawBlockShell } from "../raw-block-shell"
import "./iframe-block.css"

export function createIframeRawBlockNodeView(node: PMNode, ctx: NodeViewContext) {
  if (node.type.name !== "raw_block") {
    return null
  }
  if (getRawBlockKind(node.textContent) !== "iframe") {
    return null
  }

  var shell = createRawBlockShell()
  var dom = shell.dom

  // 解析失败时保留 NodeView 并显示错误文案（源码模式可改），不让 PM 回落默认渲染
  function renderIframe(source: string) {
    var parsed = parseIframeRawBlockSource(source)
    if (!parsed) {
      shell.renderError("iframe 预览不可用，请切换源码模式修改。")
      return
    }

    shell.setBodyClass("md-editor-raw-iframe-preview")
    shell.body.textContent = ""
    var frame = (
      <iframe
        src={parsed.src}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
        tabindex="-1"
        width={parsed.width || null}
        title={parsed.title || null}
        loading={parsed.loading || null}
        referrerpolicy={parsed.referrerpolicy || null}
        allow={parsed.allow || null}
        allowfullscreen={parsed.allowfullscreen ? true : null}
      />
    )
    var rhythmUnit = resolveRhythmLineHeight(shell.body)
    if (parsed.height) {
      // 显式高度对齐到韵律行高整数倍（百分比等非数值原样保留）
      var explicitHeight = parseFloat(parsed.height)
      if (explicitHeight > 0) {
        frame.style.height = Math.ceil(explicitHeight / rhythmUnit) * rhythmUnit + "px"
      } else {
        frame.setAttribute("height", parsed.height)
      }
    } else {
      // 默认宽度为 100%，未显式指定高度时按 16:9 自适应高度；
      // 进入文档布局完成后测量实际高度，同样对齐到行高整数倍
      frame.style.aspectRatio = "16 / 9"
      window.requestAnimationFrame(function () {
        var height = frame.offsetHeight
        if (height > 0) {
          frame.style.aspectRatio = ""
          frame.style.height = Math.ceil(height / rhythmUnit) * rhythmUnit + "px"
        }
      })
    }
    shell.body.appendChild(frame)
  }

  renderIframe(node.textContent)

  return {
    dom: dom,
    update: function (nextNode: PMNode) {
      if (nextNode.type.name !== "raw_block") {
        return false
      }
      if (nextNode.textContent !== node.textContent) {
        // 跨 kind 变化交回分派器（nodeviews 注册入口按新 kind 重建），
        // 同 kind 内文本变化原地重渲染
        if (getRawBlockKind(nextNode.textContent) !== "iframe") {
          return false
        }
        renderIframe(nextNode.textContent)
      }
      node = nextNode
      return true
    },
    ignoreMutation: returnTrue,
    stopEvent: returnTrue
  }
}