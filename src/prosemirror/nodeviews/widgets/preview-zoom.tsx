// 全屏互斥单例：同一时刻只允许一个预览块全屏
// 预览块公共全屏 + pan/zoom 模块：mermaid 图表与纯 SVG 块共用。
// 职责：右上角全屏按钮、全屏互斥管理（Esc 退出）、svg-pan-zoom 控制器。
// 类名约定（对应 preview-zoom.css）：
//   md-editor-preview-shell                  预览块外层容器
//   md-editor-preview-diagram                图形容器（flex 居中）
//   md-editor-preview-diagram-panzoom        pan/zoom 态（固定视口高度）
//   md-editor-preview-fullscreen             全屏态（加在 shell 上）
//   md-editor-preview-fullscreen-active      全屏态标记（加在 documentElement 上）
//   md-editor-preview-button                 右上角全屏按钮
import { SvgPanZoomInstance } from "../../../types"
import { SvgIcon } from "../../../icons"
import { hasClass, addClass, removeClass } from "../../../utils"
import { h } from "../../../jsx"

// 全屏互斥单例：同一时刻只允许一个预览块全屏
var activePreview: HTMLElement | null = null
// 全屏回调：enter 在进入全屏后调用（启用 pan/zoom），exit 在退出后调用（还原自适应）
var activePreviewCallbacks: { enter: () => void, exit: () => void } | null = null
var previewFullscreenEventsReady = false

export function buildPreviewZoomButton() {
  return (
    <button
      type="button"
      className="md-editor-overlay-button md-editor-preview-button"
      aria-label="最大化图表"
      title="最大化图表"
      aria-pressed="false"
      innerHTML={SvgIcon.maximize}
    />
  )
}

function setPreviewZoomButtonState(button: Element | null, fullscreen: boolean) {
  if (!button) {
    return
  }
  var label = fullscreen ? "退出最大化" : "最大化图表"
  button.setAttribute("aria-label", label)
  button.setAttribute("title", label)
  button.setAttribute("aria-pressed", fullscreen ? "true" : "false")
  button.innerHTML = fullscreen ? SvgIcon.minimize : SvgIcon.maximize
}

function findPreviewZoomButton(shell: Element | null) {
  return shell ? shell.querySelector(".md-editor-preview-button") : null
}

export function isPreviewFullscreen(shell: HTMLElement | null) {
  return !!(shell && hasClass(shell, "md-editor-preview-fullscreen"))
}

export function exitPreviewFullscreen(shell: HTMLElement | null) {
  if (!shell || !hasClass(shell, "md-editor-preview-fullscreen")) {
    return
  }
  removeClass(shell, "md-editor-preview-fullscreen")
  removeClass(document.documentElement, "md-editor-preview-fullscreen-active")
  if (activePreview === shell) {
    activePreview = null
    var callbacks = activePreviewCallbacks
    activePreviewCallbacks = null
    if (callbacks && callbacks.exit) {
      window.setTimeout(callbacks.exit, 0)
    }
  }
  setPreviewZoomButtonState(findPreviewZoomButton(shell), false)
}

export function enterPreviewFullscreen(
  shell: HTMLElement | null,
  callbacks: { enter: () => void, exit: () => void }
) {
  if (!shell || hasClass(shell, "md-editor-preview-fullscreen")) {
    return
  }
  if (activePreview) {
    exitPreviewFullscreen(activePreview)
  }
  addClass(shell, "md-editor-preview-fullscreen")
  addClass(document.documentElement, "md-editor-preview-fullscreen-active")
  activePreview = shell
  activePreviewCallbacks = callbacks
  setPreviewZoomButtonState(findPreviewZoomButton(shell), true)
  if (callbacks.enter) {
    window.setTimeout(callbacks.enter, 0)
  }
}

export function togglePreviewFullscreen(
  shell: HTMLElement,
  callbacks: { enter: () => void, exit: () => void }
) {
  if (hasClass(shell, "md-editor-preview-fullscreen")) {
    exitPreviewFullscreen(shell)
    return
  }
  enterPreviewFullscreen(shell, callbacks)
}

// 全局 Esc 退出全屏（document 级单次安装）
export function installPreviewFullscreenEvents() {
  if (previewFullscreenEventsReady) {
    return
  }
  previewFullscreenEventsReady = true
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && activePreview) {
      exitPreviewFullscreen(activePreview)
    }
  })
}

export function createPreviewPanZoomController(dom: HTMLElement, diagram: HTMLElement, button: HTMLElement) {
  var panZoom: SvgPanZoomInstance | null = null
  var wheelZoomScaleBase = 0.0025
  // enable 前的 svg 原始 HTML 快照：svg-pan-zoom 的 destroy 只解绑事件，
  // 且会把 svg 子元素包进自建的 viewport wrapper 写 transform，
  // 属性级还原不可靠——退出时整体还原快照，彻底回到自适应展示原状
  var savedSvgHTML: string | null = null

  function destroyPanZoom() {
    if (!panZoom) {
      return
    }
    try {
      if (!panZoom.destroy) {
        return
      }
      panZoom.destroy()
    } catch (error) {
      console.warn("destroy preview pan/zoom failed", error)
    }
    panZoom = null
  }

  function isReady(svg: SVGSVGElement | null) {
    if (!svg || !dom.isConnected) {
      return false
    }
    var diagramRect = diagram.getBoundingClientRect()
    var svgRect = svg.getBoundingClientRect()
    if (diagramRect.width <= 0 || diagramRect.height <= 0 || svgRect.width <= 0 || svgRect.height <= 0) {
      return false
    }
    try {
      var matrix = svg.getScreenCTM()
      return !!(matrix && Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) > 0.000001)
    } catch (error) {
      return false
    }
  }

  function resize() {
    if (!panZoom) {
      return
    }
    var svg = diagram.querySelector("svg")
    if (!isReady(svg)) {
      return
    }
    try {
      if (typeof panZoom.resize === "function") {
        panZoom.resize()
      }
      if (typeof panZoom.fit === "function") {
        panZoom.fit()
      }
      if (typeof panZoom.center === "function") {
        panZoom.center()
      }
    } catch (error) {
      console.warn("refresh preview pan/zoom failed", error)
      destroyPanZoom()
    }
  }

  function enable() {
    destroyPanZoom()
    var svg = diagram.querySelector("svg")
    if (!svg) {
      removeClass(diagram, "md-editor-preview-diagram-panzoom")
      button.hidden = true
      return
    }
    if (savedSvgHTML == null) {
      savedSvgHTML = svg.outerHTML
    }
    addClass(diagram, "md-editor-preview-diagram-panzoom")
    svg.style.maxWidth = "none"
    svg.style.width = "100%"
    svg.style.height = "100%"
    if (!isReady(svg)) {
      button.hidden = true
      return
    }
    try {
      panZoom = window.svgPanZoom(svg, {
        controlIconsEnabled: false,
        fit: true,
        center: true,
        mouseWheelZoomEnabled: false,
        minZoom: 0.25,
        maxZoom: 8,
        zoomScaleSensitivity: 0.3
      })
      button.hidden = false
    } catch (error) {
      panZoom = null
      button.hidden = true
      console.warn("init preview pan/zoom failed", error)
    }
  }

  // 退出 pan/zoom 模式：销毁实例后整体还原 svg 快照，
  // 彻底清除 zoom/pan 写入的 transform / width / height / viewport wrapper
  function disable() {
    destroyPanZoom()
    if (savedSvgHTML != null) {
      diagram.innerHTML = savedSvgHTML
      savedSvgHTML = null
    } else {
      var svg = diagram.querySelector("svg")
      if (svg) {
        svg.style.removeProperty("max-width")
        svg.style.removeProperty("width")
        svg.style.removeProperty("height")
      }
    }
    removeClass(diagram, "md-editor-preview-diagram-panzoom")
  }

  function refresh() {
    var svg = diagram.querySelector("svg")
    if (!svg) {
      return
    }
    if (!panZoom) {
      enable()
      return
    }
    resize()
  }

  function scheduleRefresh() {
    window.requestAnimationFrame(function () {
      refresh()
      window.requestAnimationFrame(refresh)
    })
  }

  function onWheel(event: WheelEvent) {
    if (!event.metaKey || !panZoom || typeof panZoom.zoomAtPointBy !== "function") {
      return
    }
    var delta = Number(event.deltaY || 0)
    if (!Number.isFinite(delta) || delta === 0) {
      return
    }
    event.preventDefault()
    var factor = Math.exp(-delta * wheelZoomScaleBase)
    if (!Number.isFinite(factor) || factor <= 0) {
      return
    }
    try {
      panZoom.zoomAtPointBy(factor, {
        x: event.clientX,
        y: event.clientY
      })
    } catch (error) {
      console.warn("preview meta-wheel zoom failed", error)
    }
  }

  dom.addEventListener("wheel", onWheel, {passive: false})

  return {
    enable: enable,
    disable: disable,
    resize: resize,
    reset: disable,
    scheduleRefresh: scheduleRefresh,
    destroy: function () {
      dom.removeEventListener("wheel", onWheel)
      destroyPanZoom()
    }
  }
}

// 预览块 stopEvent 收窄策略（点击整块选中）：
// - 全屏态：pan/zoom 交互占满 shell，事件一律由 NodeView 接管，PM 不处理
// - 非全屏态：仅全屏按钮自身的事件由 NodeView 接管（按钮自带 click 监听），
//   其余点击放行给 PM——svg 块（raw_block atom）由原生 selectClickedLeaf 选中；
//   mermaid（code_block 非 atom）由 handleClickOn 兜底（见 index.tsx nodeViews 注释）
export function createPreviewStopEvent(shell: HTMLElement, button: HTMLElement) {
  return function (event: Event) {
    if (isPreviewFullscreen(shell)) {
      return true
    }
    return button.contains(event.target as Node)
  }
}