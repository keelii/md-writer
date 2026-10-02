// Widget NodeView：纯 SVG 块（raw_block 中文本为单个 <svg>...</svg>）。
// 与 mermaid 不同，源本身就是合法 SVG，无需 renderer——
// 解析 + sanitize（见 kinds.parseSvgRawBlockSource）后直接渲染；
// 全屏/pan/zoom 复用公共模块 preview-zoom，svg-pan-zoom 运行时按需懒加载。
// 整块删除两条路与 mermaid 一致：块前后 Backspace / 左侧节点操作菜单。
import { Node as PMNode } from "prosemirror-model"
import { loadSvgPanZoomRuntime } from "../assets"
import { snapMinHeightToRhythm, setClass } from "../../../utils"
import { h } from "../../../jsx"
import { NodeViewContext, returnTrue } from "../types"
import { isSvgRawBlockText, parseSvgRawBlockSource } from "../kinds"
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

export function createSvgBlockNodeView(node: PMNode, ctx: NodeViewContext) {
  if (!isSvgRawBlockText(node.textContent)) {
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

  function showError() {
    panZoomController.reset()
    setClass(diagram, "md-editor-preview-diagram md-editor-preview-error")
    diagram.textContent = "SVG 预览不可用，请切换源码模式修改。"
    button.hidden = true
  }

  function render(nextNode: PMNode) {
    var svg = parseSvgRawBlockSource(nextNode.textContent)
    if (!svg) {
      showError()
      return
    }

    panZoomController.reset()
    setClass(diagram, "md-editor-preview-diagram")
    diagram.textContent = ""
    diagram.appendChild(svg)

    // 展示态：高度自适应（不启用 pan/zoom），按韵律行高倍数取整；
    // 全屏态：固定视口高度（calc），启用 pan/zoom，无需取整
    if (isPreviewFullscreen(dom)) {
      panZoomController.enable()
      panZoomController.scheduleRefresh()
    } else {
      panZoomController.disable()
      button.hidden = false
      snapMinHeightToRhythm(diagram)
    }
  }

  button.addEventListener("click", function (event) {
    event.preventDefault()
    if (isPreviewFullscreen(dom)) {
      togglePreviewFullscreen(dom, {
        enter: function () {},
        exit: panZoomController.disable
      })
      return
    }
    // 进入全屏前确保 svg-pan-zoom 已加载（已加载时立即返回，失败时降级为无 pan/zoom）
    loadSvgPanZoomRuntime(ctx.opts).catch(function () {}).then(function () {
      togglePreviewFullscreen(dom, {
        enter: function () {
          panZoomController.enable()
          panZoomController.scheduleRefresh()
        },
        exit: panZoomController.disable
      })
    })
  })

  render(node)

  return {
    dom: dom,
    update: function (nextNode: PMNode) {
      if (!isSvgRawBlockText(nextNode.textContent)) {
        return false
      }
      if (nextNode.textContent !== node.textContent) {
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
      exitPreviewFullscreen(dom)
      panZoomController.destroy()
    }
  }
}