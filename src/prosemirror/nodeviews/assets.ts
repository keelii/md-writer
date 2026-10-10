import { MDWriterInitOptions, SvgPanZoomInstance } from "../../types"
import { loadStyle, loadScript } from "../../utils"

function loadResource(resource: string): Promise<void> {
  if (!resource) {
    return Promise.resolve();
  }
  if (/\.css(?:[?#]|$)/i.test(resource)) {
    return loadStyle(resource);
  }
  return loadScript(resource);
}

function loadResources(resources: string[]): Promise<void> {
  if (!Array.isArray(resources) || resources.length === 0) {
    return Promise.resolve();
  }
  return resources.reduce<Promise<void>>(function(chain, resource) {
    return chain.then(function() {
      return loadResource(resource);
    });
  }, Promise.resolve());
}

export function loadMermaidPreviewRuntime(opts: Pick<MDWriterInitOptions, "mermaidAssets"> = {}) {
  opts.mermaidAssets = opts.mermaidAssets || [
    "./static/mermaid/mermaid.tiny.js",
    "./static/svg-pan-zoom/svg-pan-zoom.min.js"
  ]
  return loadResources(opts.mermaidAssets).then(function () {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict"
    })
  })
}

// mermaid v11 的 render() 失败路径在 throw 之前不清理临时元素（成功路径 return
// 前才 removeTempElements）：解析失败时挂在 document.body 的
// <div id="d<renderID>">（内含 id 为 renderID 的 error SVG）会残留为孤儿节点，
// 块删除后仍留在页面里。按 mermaid 的 id 约定主动清扫：
// securityLevel 非 sandbox 时残留 #<id> / #d<id>，sandbox 模式残留 #i<id>，
// 三种 id 一并防御性移除。widget（widgets/mermaid.tsx）与源码编辑弹窗
// （source-edit-dialog.tsx）的失败路径都需要调用。
export function removeMermaidRenderArtifacts(renderID: string) {
  var ids = [renderID, "d" + renderID, "i" + renderID]
  for (var i = 0; i < ids.length; i += 1) {
    var element = document.getElementById(ids[i])
    if (element && element.parentElement) {
      element.parentElement.removeChild(element)
    }
  }
}

// SVG 块只依赖 svg-pan-zoom（不含 mermaid）。
// 资源路径与 mermaid 预览共用 mermaidAssets 配置：默认指向同一份
// static/svg-pan-zoom/svg-pan-zoom.min.js，自定义时需自行包含 pan-zoom 脚本。
export function loadSvgPanZoomRuntime(opts: Pick<MDWriterInitOptions, "mermaidAssets"> = {}) {
  opts.mermaidAssets = opts.mermaidAssets || ["./static/svg-pan-zoom/svg-pan-zoom.min.js"]
  return loadResources(opts.mermaidAssets).then(function () {
    if (!window.svgPanZoom) {
      throw new Error("svgPanZoom runtime unavailable")
    }
  })
}

var katexPreviewRuntimePromise: Promise<NonNullable<Window["katex"]>> | null = null

export function loadKatexPreviewRuntime(opts: Pick<MDWriterInitOptions, "katexAssets"> = {}) {
  if (katexPreviewRuntimePromise && !opts) {
    return katexPreviewRuntimePromise
  }

  opts.katexAssets = opts.katexAssets || ["./static/katex/katex.min.css", "./static/katex/katex.min.js"]

  var loadPromise = loadResources(opts.katexAssets).then(function () {
    if (!window.katex || typeof window.katex.render !== "function") {
      throw new Error("KaTeX runtime unavailable")
    }
    return window.katex
  }).catch(function (error: unknown) {
    if (!opts) {
      katexPreviewRuntimePromise = null
    }
    throw error
  })

  if (!opts) {
    katexPreviewRuntimePromise = loadPromise
  }

  return loadPromise
}

export type { SvgPanZoomInstance }
