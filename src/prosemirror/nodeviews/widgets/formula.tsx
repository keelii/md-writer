// Widget NodeView：公式。
// 渲染来源是 DSL（$…$ / $$…$$ LaTeX）→ KaTeX renderer 产出 DOM，
// 产出内容不承载编辑器交互（无 iframe/脚本）；
// 块级公式不设 stopEvent，点击放行 PM 原生 selectClickedLeaf
// （raw_block 为 atom）产生 NodeSelection，整块选中后可直接 Backspace 删除。
//
// 块级公式高度按韵律行高（兜底值见 utils.RHYTHM_UNIT_FALLBACK）倍数向上取整：
// KaTeX 渲染高度是任意的，纯 CSS 无法对自然高度取整，
// 渲染完成后测量实际高度，把 min-height 对齐到行高整数倍（utils.snapMinHeightToRhythm）
import { Node as PMNode } from "prosemirror-model"
import { h } from "../../../jsx"
import { snapMinHeightToRhythm, setClass } from "../../../utils"
import { NodeViewContext, returnTrue } from "../types"
import { getRawBlockKind, extractMathRawBlockExpression, parseMathRawInlineSource } from "../kinds"
import { createRawBlockShell } from "../raw-block-shell"
import { loadKatexPreviewRuntime } from "../assets"
import "./formula.css"

export function createMathRawBlockNodeView(node: PMNode, ctx: NodeViewContext) {
  if (node.type.name !== "raw_block") {
    return null
  }
  if (getRawBlockKind(node.textContent) !== "math") {
    return null
  }

  var shell = createRawBlockShell()
  var dom = shell.dom
  var renderSeq = 0

  function renderMath(source: string, seq: number) {
    shell.setBodyClass("md-editor-raw-math-preview")
    shell.body.textContent = ""
    var expression = extractMathRawBlockExpression(source)
    if (expression === null) {
      shell.renderError("公式预览不可用，请切换源码模式修改。")
      return
    }
    var latex: string = expression
    loadKatexPreviewRuntime(ctx.opts).then(function (katex: NonNullable<Window["katex"]>) {
      if (seq !== renderSeq) {
        return
      }
      shell.body.textContent = ""
      katex.render(latex, shell.body, {
        displayMode: true,
        throwOnError: false,
        strict: "warn",
        trust: false
      })
      snapMinHeightToRhythm(shell.body)
    }).catch(function (error) {
      if (seq !== renderSeq) {
        return
      }
      shell.renderError(error && error.message ? error.message : "KaTeX render failed.")
    })
  }

  var seq = renderSeq + 1
  renderSeq = seq
  renderMath(node.textContent, seq)

  return {
    dom: dom,
    update: function (nextNode: PMNode) {
      if (nextNode.type.name !== "raw_block") {
        return false
      }
      if (nextNode.textContent !== node.textContent) {
        // 跨 kind 变化交回分派器，同 kind 内文本变化原地重渲染
        if (getRawBlockKind(nextNode.textContent) !== "math") {
          return false
        }
        seq = renderSeq + 1
        renderSeq = seq
        renderMath(nextNode.textContent, seq)
      }
      node = nextNode
      return true
    },
    ignoreMutation: returnTrue
  }
}

// 行内公式（raw_inline $…$）：inline Widget，无块级选中交互
export function createRawInlineMathNodeView(node: PMNode, ctx: NodeViewContext) {
  if (node.type.name !== "raw_inline") {
    return null
  }

  var parsed = parseMathRawInlineSource(node.textContent)
  if (!parsed) {
    return null
  }

  var dom = <span className="md-editor-raw-inline-preview" contenteditable="false" />
  var renderSeq = 0

  function renderError(sourceText: string) {
    setClass(dom, "md-editor-raw-inline-preview md-editor-raw-inline-preview-error")
    dom.textContent = sourceText
  }

  function render(nextNode: PMNode) {
    var sourceText = nextNode.textContent
    var nextParsed = parseMathRawInlineSource(sourceText)
    if (!nextParsed) {
      return false
    }

    renderSeq += 1
    var seq = renderSeq
    setClass(dom, "md-editor-raw-inline-preview")
    dom.textContent = ""
    var parsedValue = nextParsed
    loadKatexPreviewRuntime(ctx.opts).then(function (katex: NonNullable<Window["katex"]>) {
      if (seq !== renderSeq) {
        return
      }
      dom.textContent = ""
      katex.render(parsedValue.expression, dom, {
        displayMode: parsedValue.displayMode,
        throwOnError: false,
        strict: "warn",
        trust: false
      })
    }).catch(function () {
      if (seq !== renderSeq) {
        return
      }
      renderError(sourceText)
    })
    return true
  }

  render(node)

  return {
    dom: dom,
    update: function (nextNode: PMNode) {
      if (nextNode.type.name !== "raw_inline") {
        return false
      }
      if (nextNode.textContent !== node.textContent && !render(nextNode)) {
        return false
      }
      node = nextNode
      return true
    },
    ignoreMutation: returnTrue,
    stopEvent: returnTrue
  }
}