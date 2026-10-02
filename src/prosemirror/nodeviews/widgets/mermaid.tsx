// Widget NodeView：Mermaid 图表。
// 渲染来源是 DSL（```mermaid 代码）→ mermaid renderer 产出 SVG，
// 全屏态由 svg-pan-zoom 提供交互（全屏/pan/zoom 能力见公共模块 preview-zoom）；
// renderer 产出不承载 HTML 交互，点击不主动整块选中、放行原生事件；
// 整块删除两条路：光标移到块前后按 Backspace
// （PM joinBackward 对可选 leaf 节点会先整块选中、再按一次删除），
// 或 hover 块左侧节点操作菜单删除按钮（见 node-op-menu）。
import { Node as PMNode } from "prosemirror-model"
import { MermaidRenderResult } from "../../../types"
import { loadMermaidPreviewRuntime, removeMermaidRenderArtifacts } from "../assets"
import { snapMinHeightToRhythm, setClass } from "../../../utils"
import { h } from "../../../jsx"
import { NodeViewContext, returnTrue } from "../types"
import { isMermaidCodeBlock } from "../kinds"
import {
  buildPreviewZoomButton,
  isPreviewFullscreen,
  togglePreviewFullscreen,
  exitPreviewFullscreen,
  installPreviewFullscreenEvents,
  createPreviewPanZoomController
} from "./preview-zoom"
import "./preview-zoom.css"
import "../overlay-button.css"

var nextMermaidPreviewID = 1

export function createMermaidNodeView(node: PMNode, ctx: NodeViewContext) {
  if (!isMermaidCodeBlock(node)) {
    return null
  }

  var button = buildPreviewZoomButton()
  var diagram = <div className="md-editor-preview-diagram" />
  var dom = (
    <div className="md-editor-preview-shell" contenteditable="false">
      {diagram}
      {button}
    </div>
  )
  var panZoomController = createPreviewPanZoomController(dom, diagram, button)
  button.hidden = true
  installPreviewFullscreenEvents()

  var previewID = "md-editor-mermaid-preview-" + nextMermaidPreviewID
  nextMermaidPreviewID += 1
  var renderSeq = 0

  function render(nextNode: PMNode) {
    var source = nextNode.textContent
    var seq = renderSeq + 1
    renderSeq = seq

    panZoomController.reset()
    diagram.removeAttribute("data-processed")
    setClass(diagram, "md-editor-preview-diagram")
    diagram.textContent = source
    button.hidden = true

    loadMermaidPreviewRuntime(ctx.opts).then(function () {
      return window.mermaid.render(previewID, source)
    }).then(function (result: MermaidRenderResult) {
      if (seq !== renderSeq) {
        return
      }
      diagram.innerHTML = result.svg || ""
      if (typeof result.bindFunctions === "function") {
        result.bindFunctions(diagram)
      }
      // 展示态：高度自适应（不启用 pan/zoom），并按韵律行高倍数取整；
      // 全屏态：固定视口高度（calc），启用 pan/zoom，无需取整
      if (isPreviewFullscreen(dom)) {
        panZoomController.enable()
        panZoomController.scheduleRefresh()
      } else {
        panZoomController.disable()
        button.hidden = false
        snapMinHeightToRhythm(diagram)
      }
    }).catch(function (error) {
      // 无论渲染是否过期，mermaid 的临时元素都已创建，先清扫残留再按 seq 决定
      // 是否更新 DOM（过期渲染也要负责清掉自己留下的孤儿节点）
      removeMermaidRenderArtifacts(previewID)
      if (seq !== renderSeq) {
        return
      }
      panZoomController.reset()
      setClass(diagram, "md-editor-preview-diagram md-editor-preview-error")
      diagram.textContent = error && error.message ? error.message : "Mermaid render failed."
      button.hidden = true
    })
  }

  button.addEventListener("click", function (event) {
    event.preventDefault()
    togglePreviewFullscreen(dom, {
      enter: function () {
        panZoomController.enable()
        panZoomController.scheduleRefresh()
      },
      exit: panZoomController.disable
    })
  })

  render(node)

  return {
    dom: dom,
    update: function (nextNode: PMNode) {
      if (!isMermaidCodeBlock(nextNode)) {
        return false
      }
      if (nextNode.textContent !== node.textContent || nextNode.attrs.params !== node.attrs.params) {
        node = nextNode
        render(nextNode)
      } else {
        node = nextNode
      }
      return true
    },
    ignoreMutation: returnTrue,
    stopEvent: returnTrue,
    refresh: function () {
      // 展示态为自适应布局无需处理；全屏态刷新 pan/zoom 视口
      if (isPreviewFullscreen(dom)) {
        panZoomController.scheduleRefresh()
      }
    },
    destroy: function () {
      // 兜底：块删除时若在途渲染尚未 reject，其临时元素由 catch 清扫；
      // 这里再清一次已失败渲染残留的孤儿节点（如尚未被下一次 render 复用同 id 覆盖的情况）
      removeMermaidRenderArtifacts(previewID)
      exitPreviewFullscreen(dom)
      panZoomController.destroy()
    }
  }
}