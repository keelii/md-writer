// 预览块源码编辑弹窗：CodeMirror 编辑器展示并回写源文本（$$ 公式 / iframe /
// frontmatter / svg 的 raw_block、mermaid code_block 均为 text* 内容）。
// 走 runManagedDialog 通用事件流（Escape / 遮罩点击 / 关闭按钮）；
// CodeMirror 容器无 .value，值经 options.getValue 从编辑器适配器读取。
// Enter 不触发确认（dialog 基建只对 INPUT 生效），多行源码可自由换行，
// 确认靠 footer 按钮——这与源码多行编辑的语义一致。
import { runManagedDialog } from "./dialog"
import { h } from "../jsx"
import { MDWriterInitOptions, MermaidRenderResult } from "../types"
import { createCodeMirrorSourceEditor, SourceEditorAdapter } from "../codemirror/source-editor"
import { extractMathRawBlockExpression, parseSvgRawBlockSource } from "./nodeviews/kinds"
import { loadKatexPreviewRuntime, loadMermaidPreviewRuntime, removeMermaidRenderArtifacts } from "./nodeviews/assets"
import "./dialog.css"

var SOURCE_DIALOG_ID = "md-editor-source-dialog"

export interface SourceEditResult {
  action: "confirm" | "cancel"
  source: string
}

export type SourcePreviewKind = "math" | "mermaid" | "svg" | null

// CodeMirror 编辑器工厂：包一层可变对象（模块导出绑定只读），测试注入桩实现用
export var sourceEditorFactory = {
  create: createCodeMirrorSourceEditor
}

var nextPreviewId = 0

export function requestSourceByDialog(title: string, currentSource: string, opener: Element | null, kind: SourcePreviewKind = null, opts?: MDWriterInitOptions): Promise<SourceEditResult> {
  var previewId = "md-editor-source-mermaid-" + (++nextPreviewId)
  var renderSeq = 0
  var active = true
  var editor: SourceEditorAdapter | null = null
  var preview: HTMLElement | null = null
  function renderPreview(source: string) {
    if (!preview) return
    var target = preview
    var seq = ++renderSeq
    target.textContent = ""
    if (kind === "svg") {
      var svg = parseSvgRawBlockSource(source)
      if (svg) target.appendChild(svg)
      else target.textContent = "SVG 预览不可用"
    } else if (kind === "math") {
      var expression = extractMathRawBlockExpression(source)
      if (expression === null) {
        target.textContent = "公式预览不可用"
        return
      }
      // 闭包内 TS 不保留 null 收窄，落到局部常量再传入异步回调
      var mathExpression: string = expression
      target.textContent = "正在渲染…"
      loadKatexPreviewRuntime(opts).then(function (katex) {
        if (!active || seq !== renderSeq) return
        target.textContent = ""
        katex.render(mathExpression, target, { displayMode: true, throwOnError: false, strict: "warn", trust: false })
      }).catch(function (error) {
        if (active && seq === renderSeq) target.textContent = error && error.message ? error.message : "公式预览不可用"
      })
    } else if (kind === "mermaid") {
      target.textContent = "正在渲染…"
      loadMermaidPreviewRuntime(opts).then(function () {
        if (!active || seq !== renderSeq) return null
        return window.mermaid.render(previewId + "-" + seq, source)
      }).then(function (result: MermaidRenderResult | null) {
        if (!active || seq !== renderSeq || !result) return
        target.innerHTML = result.svg || ""
      }).catch(function (error) {
        // 弹窗的每次渲染用独立 id（previewId-seq），失败后没有下一次 render 来
        // 复用同 id 顺带清理，必须在此主动清扫 mermaid 残留的临时元素
        removeMermaidRenderArtifacts(previewId + "-" + seq)
        if (active && seq === renderSeq) target.textContent = error && error.message ? error.message : "Mermaid 预览不可用"
      })
    }
  }
  var promise = runManagedDialog({
    id: SOURCE_DIALOG_ID,
    title: title,
    confirmLabel: "保存",
    opener: opener || null,
    focusSelector: ".cm-editor .cm-content",
    bodyElement: (
      <div className="md-editor-source-layout">
        <label className="ui-field-label" htmlFor="md-editor-source-editor">源码</label>
        <div
          id="md-editor-source-editor"
          className="md-editor-source-editor"
          data-role="md-editor-source-editor"
        />
        <div className="md-editor-source-preview-section" data-role="md-editor-source-preview-section">
          <div className="ui-field-label">预览</div>
          <div className="md-editor-source-preview" data-role="md-editor-source-preview" aria-live="polite" />
        </div>
      </div>
    ),
    getValue: function () {
      return editor ? editor.getValue() : ""
    },
    onOpen: function (backdrop) {
      var host = backdrop.querySelector('[data-role~="md-editor-source-editor"]') as HTMLElement | null
      preview = backdrop.querySelector('[data-role~="md-editor-source-preview"]') as HTMLElement | null
      var previewSection = backdrop.querySelector('[data-role~="md-editor-source-preview-section"]') as HTMLElement | null
      if (previewSection) previewSection.hidden = !kind
      if (preview) preview.textContent = ""
      if (host) {
        // onOpen 时弹窗仍隐藏（display:none），CodeMirror 在隐藏容器中创建后
        // 需在显示后重测量；打开同 tick 的 setTimeout 里 refresh 一次兜底
        editor = sourceEditorFactory.create(host, currentSource, function (value: string) {
          renderPreview(value)
        })
        window.setTimeout(function () {
          if (editor) editor.refresh()
        }, 0)
        if (kind && preview) renderPreview(currentSource)
      }
    },
    onClose: function () {
      active = false
      renderSeq += 1
      if (editor) editor.destroy()
      editor = null
      preview = null
    }
  })

  return promise.then(function (result): SourceEditResult {
    if (!result) {
      return { action: "cancel", source: "" }
    }
    return {
      action: result.action === "confirm" ? "confirm" : "cancel",
      // dialog 基建对值统一 trim：源码首尾空白不参与语义（mermaid / $$ /
      // frontmatter / iframe 均如此），丢弃无损
      source: result.value
    }
  })
}