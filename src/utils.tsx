import { AssetPromiseMap, ElementTarget } from "./types"
import { h } from "./jsx"

// 通用工具函数：与具体编辑器功能无关，可跨模块复用

export function isUndefined(s: unknown): s is undefined {
  return typeof s === "undefined";
}

export function isNull(s: unknown): s is null {
  return s === null;
}

export function isNil(s: unknown): s is null | undefined {
  return isUndefined(s) || isNull(s)
}

export function isString(s: unknown): s is string {
  return typeof s === "string";
}

export function isNumber(s: unknown): s is number {
  return typeof s === "number";
}

export function isBoolean(s: unknown): s is boolean {
  return typeof s === "boolean";
}

export function isSimpleValue(s: any): s is string | number | boolean {
  return typeof s === "string" || typeof s === "number" ||
    typeof s === "boolean";
}

export function isObject(s: any): s is object {
  return typeof s === "object" && s !== null;
}

export function isFunction(s: any): s is Function {
  return typeof s === "function";
}

export function isArray<T = any>(s: any): s is Array<T> {
  return Array.isArray(s);
}

// 韵律行高兜底值（px）：line-height 解析失败（如 "normal"）时使用，
// 需与 styles 中 --rhythm（1.75rem = 28px）对应的正文行高保持一致
export var RHYTHM_UNIT_FALLBACK = 28

// DOM 事件阻断：preventDefault + stopPropagation，用于菜单/按钮点击不落到编辑器
export function stopEvent(event: Event) {
  event.preventDefault()
  event.stopPropagation()
}

// 读取元素的韵律行高：优先取 computed line-height，无法解析时回退兜底值
export function resolveRhythmLineHeight(el: Element): number {
  var lineHeight = parseFloat(window.getComputedStyle(el).lineHeight)
  return lineHeight > 0 ? lineHeight : RHYTHM_UNIT_FALLBACK
}

// 把元素自然高度的 min-height 向上取整到韵律行高整数倍：
// 渲染产物（KaTeX 公式 / mermaid SVG）高度任意，纯 CSS 无法对自然高度取整，
// 故渲染完成后测量实际高度，把 min-height 对齐到行高整数倍
export function snapMinHeightToRhythm(el: HTMLElement) {
  var rhythm = resolveRhythmLineHeight(el)
  // 先清掉上一轮的 min-height，测出自然高度
  el.style.minHeight = ""
  var height = el.offsetHeight
  if (!(height > 0)) {
    return
  }
  el.style.minHeight = Math.ceil(height / rhythm) * rhythm + "px"
}

export function resolveElement(target: ElementTarget): Element | null {
  if (!target) {
    return null
  }
  if (target instanceof Element) {
    return target
  }
  if (isString(target)) {
    return document.querySelector(target)
  }
  return null
}

// className 便捷封装：统一 class 操作入口
export function setClass(el: Element, className: string) {
  el.className = className
}

export function hasClass(el: Element, className: string): boolean {
  return el.classList.contains(className)
}

export function addClass(el: Element, className: string) {
  el.classList.add(className)
}

export function removeClass(el: Element, className: string) {
  el.classList.remove(className)
}

export function toggleClass(el: Element, className: string, force?: boolean) {
  el.classList.toggle(className, force)
}

// tooltip 摆位参数：与视口边缘的最小留白 / 箭头距 tooltip 左右边缘的最小间距
// （避免箭头压到圆角）/ 锚点与浮层的间距（须与 tooltip.css 的 calc(100% + 11px) 一致）
var TOOLTIP_VIEWPORT_MARGIN = 8
var TOOLTIP_ARROW_EDGE = 14
var TOOLTIP_ANCHOR_GAP = 11

// 通用 tooltip 摆位（配合 styles/tooltip.css 的位置变体类）：
// 默认挂在锚点下方居中；下方溢出视口且上方放得下时翻到上方（--above），
// 居中溢出视口左/右边时贴齐锚点左/右缘（--align-start/--end），箭头通过
// --md-tooltip-arrow-x 始终指向锚点中心。调用时机：tooltip 已挂载到锚点下
// 且内容已就绪（尺寸可测量）——位置类名会改变浮层位置，箭头坐标在类名
// 应用后重测换算。
export function placeTooltip(anchor: HTMLElement, tooltip: HTMLElement) {
  var viewportWidth = window.innerWidth
  var viewportHeight = window.innerHeight
  var anchorRect = anchor.getBoundingClientRect()
  var tipRect = tooltip.getBoundingClientRect()
  // 垂直：默认下方，放不下且上方更空时翻转
  var fitsBelow = anchorRect.bottom + TOOLTIP_ANCHOR_GAP + tipRect.height <= viewportHeight - TOOLTIP_VIEWPORT_MARGIN
  var fitsAbove = anchorRect.top - TOOLTIP_ANCHOR_GAP - tipRect.height >= TOOLTIP_VIEWPORT_MARGIN
  if (!fitsBelow && fitsAbove) {
    addClass(tooltip, "md-editor-tooltip--above")
  } else {
    removeClass(tooltip, "md-editor-tooltip--above")
  }
  // 水平：居中位置溢出左/右视口边时贴齐锚点对应边缘（两个方向都溢出时优先贴左）
  var centeredLeft = anchorRect.left + anchorRect.width / 2 - tipRect.width / 2
  var overflowLeft = centeredLeft < TOOLTIP_VIEWPORT_MARGIN
  var overflowRight = centeredLeft + tipRect.width > viewportWidth - TOOLTIP_VIEWPORT_MARGIN
  if (overflowLeft) {
    addClass(tooltip, "md-editor-tooltip--align-start")
  } else {
    removeClass(tooltip, "md-editor-tooltip--align-start")
  }
  if (!overflowLeft && overflowRight) {
    addClass(tooltip, "md-editor-tooltip--align-end")
  } else {
    removeClass(tooltip, "md-editor-tooltip--align-end")
  }
  // 箭头指向锚点中心：换算到 tooltip 坐标系（px），距边缘太近时向内收
  var placedRect = tooltip.getBoundingClientRect()
  var arrowX = anchorRect.left + anchorRect.width / 2 - placedRect.left
  if (arrowX < TOOLTIP_ARROW_EDGE) {
    arrowX = TOOLTIP_ARROW_EDGE
  }
  if (arrowX > placedRect.width - TOOLTIP_ARROW_EDGE) {
    arrowX = placedRect.width - TOOLTIP_ARROW_EDGE
  }
  tooltip.style.setProperty("--md-tooltip-arrow-x", Math.round(arrowX) + "px")
}

export function setElementVisible(el: HTMLElement, visible: boolean) {
  if (visible) {
    el.style.removeProperty("display")
    return
  }
  el.style.display = "none"
}

export function normalizeNewlines(input: string) {
  return String(input == null ? "" : input).replace(/\r\n?/g, "\n")
}

export function copyTextToClipboard(text: string): Promise<void> {
  var input = text == null ? "" : String(text)
  if (navigator.clipboard && isFunction(navigator.clipboard.writeText)) {
    return navigator.clipboard.writeText(input)
  }
  return new Promise<void>(function (resolve, reject) {
    var textarea = (
      <textarea readonly="" style="position: fixed; left: -9999px; top: 0" />
    ) as HTMLTextAreaElement
    textarea.value = input
    document.body.appendChild(textarea)
    textarea.select()
    try {
      var ok = document.execCommand("copy")
      document.body.removeChild(textarea)
      if (!ok) {
        reject(new Error("copy command failed"))
        return
      }
      resolve()
    } catch (error) {
      document.body.removeChild(textarea)
      reject(error)
    }
  })
}

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise<string>(function (resolve, reject) {
    var reader = new FileReader()
    reader.onload = function () {
      resolve(isString(reader.result) ? reader.result : "")
    }
    reader.onerror = function () {
      reject(reader.error || new Error("read file failed"))
    }
    reader.readAsDataURL(file)
  })
}

function assetLoadPromises(): AssetPromiseMap {
  if (!window.__swavesAssetLoadPromises) {
    window.__swavesAssetLoadPromises = {}
  }
  return window.__swavesAssetLoadPromises
}

export function loadStyle(href: string): Promise<void> {
  if (!href) {
    return Promise.resolve()
  }
  var key = "style:" + href
  var promises = assetLoadPromises()
  if (promises[key]) {
    return promises[key]!
  }
  var existingLinks = document.querySelectorAll('link[rel="stylesheet"]')
  for (var linkIndex = 0; linkIndex < existingLinks.length; linkIndex += 1) {
    if (existingLinks[linkIndex].getAttribute("href") === href) {
      return (promises[key] = Promise.resolve())
    }
  }
  promises[key] = new Promise<void>(function(resolve, reject) {
    var link = (
      <link
        rel="stylesheet"
        href={href}
        onLoad={function () { resolve() }}
        onError={function() {
          // 失败不缓存，允许后续调用重试（瞬时网络错误可恢复）
          delete promises[key]
          reject(new Error("failed to load stylesheet: " + href))
        }}
      />
    )
    document.head.appendChild(link)
  })
  return promises[key]!
}

export function loadScript(src: string): Promise<void> {
  if (!src) {
    return Promise.resolve()
  }
  var key = "script:" + src
  var promises = assetLoadPromises()
  if (promises[key]) {
    return promises[key]!
  }
  var existingScripts = document.querySelectorAll("script[src]")
  for (var scriptIndex = 0; scriptIndex < existingScripts.length; scriptIndex += 1) {
    if (existingScripts[scriptIndex].getAttribute("src") === src) {
      return (promises[key] = Promise.resolve())
    }
  }
  promises[key] = new Promise<void>(function(resolve, reject) {
    var script = (
      <script
        async={true}
        src={src}
        onLoad={function () { resolve() }}
        onError={function() {
          // 失败不缓存，允许后续调用重试（瞬时网络错误可恢复）
          delete promises[key]
          reject(new Error("failed to load script: " + src))
        }}
      />
    )
    document.head.appendChild(script)
  })
  return promises[key]!
}
