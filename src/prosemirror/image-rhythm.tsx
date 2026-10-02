// 图片高度按韵律行高倍数对齐：
// 图片按固有宽高比等比缩放，显示高度向上取整到行高（兜底值见 utils.RHYTHM_UNIT_FALLBACK）整数倍；
// 若取整放大后宽度超出容器（宽图顶满内容宽度时），回退为向下取整（缩小），
// 保证任何情况下不超出内容宽度。
import { Plugin } from "prosemirror-state"
import { Node as PMNode, Schema } from "prosemirror-model"
import { EditorView } from "prosemirror-view"
import { SvgIcon } from "../icons"
import { BlockMenuRegistration } from "./block-menu"
import { buildBlockOpMenuDom } from "./block-op-menu"
import { deleteBlockAt } from "./prosemirror-helpers"
import { resolveRhythmLineHeight } from "../utils"
import { h } from "../jsx"

// 仅含一张图片的段落：WYSIWYG 下渲染为块级 div（而非 p），
// 文档模型仍是 paragraph，markdown 序列化往返不受影响。
export function isImageOnlyParagraph(node: PMNode): boolean {
  if (!node || node.type.name !== "paragraph" || node.childCount !== 1) {
    return false
  }
  var first = node.firstChild
  return !!first && first.type.name === "image"
}

// 单图段落只提供删除入口，不进入标题/正文类型切换菜单。
export function createImageMenuRegistration(schema: Schema): BlockMenuRegistration | null {
  if (!schema.nodes.paragraph || !schema.nodes.image) return null
  return {
    anchorInside: true,
    matches: function (node, parent) {
      return parent.type.name === "doc" && isImageOnlyParagraph(node)
    },
    buildMenu: function (ctx) {
      return buildBlockOpMenuDom("md-editor-image-menu", [{
        label: "删除图片",
        icon: SvgIcon.trash,
        run: function () {
          // 删除整块：重读时校验仍是同一单图段落（防重绘后内容已变）
          deleteBlockAt(ctx, function (current: PMNode) {
            return isImageOnlyParagraph(current) && current.eq(ctx.node)
          }, schema)
        }
      }])
    }
  }
}

// 块级图片段落 NodeView：div.md-editor-image-block 取代默认的 p 输出。
// 内容（img 及可能的光标位置）由 contentDOM 承载，编辑行为与普通段落一致；
// 一旦段落不再是"仅一张图片"（如光标处输入文字），update 返回 false 交回默认 p 渲染。
export function createImageBlockNodeView(node: PMNode): { dom: HTMLElement; contentDOM: HTMLElement; update: (nextNode: PMNode) => boolean } | null {
  if (!isImageOnlyParagraph(node)) {
    return null
  }
  var dom = <div className="md-editor-image-block" />
  return {
    dom: dom,
    contentDOM: dom,
    update: function (nextNode: PMNode) {
      return isImageOnlyParagraph(nextNode)
    }
  }
}

// 计算对齐韵律后的图片显示高度；无法取整（如不足一行）时返回 null。
export function computeImageRhythmHeight(
  naturalWidth: number,
  naturalHeight: number,
  containerWidth: number,
  unit: number
): number | null {
  if (!(naturalWidth > 0) || !(naturalHeight > 0) || !(containerWidth > 0) || !(unit > 0)) {
    return null
  }
  var ratio = naturalWidth / naturalHeight
  // 无约束时的显示尺寸：按固有尺寸，超容器宽则缩到容器宽
  var displayWidth = Math.min(naturalWidth, containerWidth)
  var displayHeight = displayWidth / ratio
  var ceilHeight = Math.ceil(displayHeight / unit) * unit
  if (ceilHeight * ratio <= containerWidth + 0.5) {
    return ceilHeight
  }
  // 放大会超宽：缩小到下一档
  var floorHeight = Math.floor(displayHeight / unit) * unit
  return floorHeight >= unit ? floorHeight : null
}

// 图片可用内容宽度：包含块 clientWidth 去掉左右 padding（图片 max-width: 100% 相对 content box）
function getImageContainerWidth(img: HTMLImageElement): number {
  var parent = img.parentElement
  if (!parent) {
    return 0
  }
  var width = parent.clientWidth
  var computed = window.getComputedStyle(parent)
  var paddingLeft = parseFloat(computed.paddingLeft)
  var paddingRight = parseFloat(computed.paddingRight)
  if (paddingLeft > 0) {
    width -= paddingLeft
  }
  if (paddingRight > 0) {
    width -= paddingRight
  }
  return width > 0 ? width : 0
}

function snapImageToRhythm(img: HTMLImageElement, unit: number) {
  if (!img.complete) {
    return
  }
  var height = computeImageRhythmHeight(
    img.naturalWidth,
    img.naturalHeight,
    getImageContainerWidth(img),
    unit
  )
  // 高度取整按等比缩放宽随之变化；仅设 height，width 保持 auto
  img.style.height = height == null ? "" : height + "px"
}

export function createImageRhythmPlugin(): Plugin {
  return new Plugin({
    view: function (editorView: EditorView) {
      var dom = editorView.dom

      function snapAll() {
        var unit = resolveRhythmLineHeight(dom)
        var imgs = dom.querySelectorAll("img")
        for (var i = 0; i < imgs.length; i += 1) {
          snapImageToRhythm(imgs[i], unit)
        }
      }

      // load 不冒泡：capture 委托捕获编辑器内所有图片加载完成
      function onLoad(event: Event) {
        var target = event.target
        if (target instanceof HTMLImageElement) {
          snapImageToRhythm(target, resolveRhythmLineHeight(dom))
        }
      }

      dom.addEventListener("load", onLoad, true)
      var observer: ResizeObserver | null = null
      if (typeof ResizeObserver === "function") {
        // 容器宽度变化（窗口缩放/侧栏开合）时重新对齐
        observer = new ResizeObserver(function () {
          snapAll()
        })
        observer.observe(dom)
      }
      // 首次快照（缓存图片已 complete）
      snapAll()

      return {
        update: function () {
          // 撤销/重绘会重建 img 元素（style 丢失），每次事务后重新对齐（幂等）
          snapAll()
        },
        destroy: function () {
          dom.removeEventListener("load", onLoad, true)
          if (observer) {
            observer.disconnect()
          }
        }
      }
    }
  })
}