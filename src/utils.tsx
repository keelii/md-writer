import { AssetPromiseMap, ElementTarget } from "./types"
import { h } from "./jsx"

// 通用工具函数：与具体编辑器功能无关，可跨模块复用

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
  if (typeof target === "string") {
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
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
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
      resolve(typeof reader.result === "string" ? reader.result : "")
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