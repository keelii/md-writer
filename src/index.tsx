import { Node as PMNode } from "prosemirror-model"
import { EditorState } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { MDWriterInitOptions, MDWriterInstance } from "./types"
import { resolveElement, setElementVisible, addClass, removeClass, toggleClass } from "./utils"
import { buildSchema } from "./prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, parseMarkdown } from "./prosemirror/markdown"
import { buildPlugins, createMarkdownPastePlugin } from "./prosemirror/plugins"
import { renderCommandButtons, bindCommandButtons, renderViewButtons, bindViewButtons } from "./prosemirror/buttons"
import { isMermaidCodeBlock, getRawBlockKind } from "./prosemirror/nodeviews/kinds"
import { createCodeBlockCopyNodeView } from "./prosemirror/nodeviews/content/code-block-copy"
import { createIframeRawBlockNodeView } from "./prosemirror/nodeviews/raw/iframe-block"
import { createMermaidNodeView } from "./prosemirror/nodeviews/widgets/mermaid"
import { createSvgBlockNodeView } from "./prosemirror/nodeviews/widgets/svg-block"
import { createMathRawBlockNodeView, createRawInlineMathNodeView } from "./prosemirror/nodeviews/widgets/formula"
import { createFrontmatterRawBlockNodeView } from "./prosemirror/nodeviews/widgets/frontmatter"
import { createImageBlockNodeView } from "./prosemirror/image-rhythm"
import { createHandleAwareCellNodeView, createTableHandlesNodeView, createTableCoordsPlugin } from "./prosemirror/table-handles"
import { createCodeMirrorSourceEditor, SourceEditorAdapter } from "./codemirror/source-editor"
import { bindTocPanel } from "./prosemirror/toc"
import {
  StorageBackend,
  MDWriterViewState,
  readStoredContent,
  writeStoredContent,
  readStoredState,
  writeStoredState
} from "./storage"
import { h } from "./jsx"

// @ts-ignore
import "./styles/reset.css"
// @ts-ignore
import "./styles/layout.css"
// @ts-ignore
import "./styles/toolbar.css"
// @ts-ignore
import "./styles/themes/default.css"
// @ts-ignore
import "./styles/themes/classic.css"
// @ts-ignore
import "./styles/toc.css"
// @ts-ignore
import "./styles/print.css"

export function init(options?: MDWriterInitOptions): MDWriterInstance {
  var opts: MDWriterInitOptions = options || ({} as MDWriterInitOptions)
  var mountResolved = resolveElement(opts.mount)
  if (!mountResolved) {
    throw new Error("MDWriter.init: mount element is required")
  }
  var mount: Element = mountResolved

  addClass(mount, "md-editor-root")
  mount.innerHTML = ""

  // formatBarRoot / viewBarRoot 提前解析：决定按钮渲染位置（外部元素或库内工具栏容器）
  var formatBarRoot: Element | null = null
  if (opts.formatBarRoot) {
    formatBarRoot = resolveElement(opts.formatBarRoot)
    if (!formatBarRoot) {
      throw new Error("MDWriter.init: formatBarRoot element is required when formatBarRoot is set")
    }
  }
  var viewBarRoot: Element | null = null
  if (opts.viewBarRoot) {
    viewBarRoot = resolveElement(opts.viewBarRoot)
    if (!viewBarRoot) {
      throw new Error("MDWriter.init: viewBarRoot element is required when viewBarRoot is set")
    }
  }

  // 工具栏（sticky 顶栏）由库渲染为 mount 首个子元素：
  //   - formatBarRoot / viewBarRoot 未传时，按钮渲染进库内容器
  //   - 两者均由宿主外部提供时不创建，避免渲染出空栏
  var commandBarHost: HTMLElement | null = null
  var viewBarHost: HTMLElement | null = null
  var controlsRoot: HTMLElement | null = null
  if (!formatBarRoot || !viewBarRoot) {
    commandBarHost = formatBarRoot ? null : <div className="buttons md-editor-cmd" />
    viewBarHost = viewBarRoot ? null : <div className="buttons md-editor-view" />
    controlsRoot = (
      <div className="md-controls">
        <div className="inner">
          <div className="left">
            {commandBarHost}
          </div>
          {viewBarHost}
        </div>
      </div>
    )
    mount.appendChild(controlsRoot)
  }

  var sourceHost = <div className="md-editor-source-host" style="display: none" />
  mount.appendChild(sourceHost)

  var schema = buildSchema()
  var markdownParser = buildMarkdownParser(schema)
  var serializer = buildMarkdownSerializer(schema)
  var plugins = buildPlugins(schema, opts)
  // markdown 粘贴插件置于最前，保证 handlePaste 优先于默认行为
  plugins.unshift(createMarkdownPastePlugin(schema, markdownParser))
  // 表格行列坐标（tr[data-row] / td[data-col]）：node 装饰由 PM 自身应用，
  // 直接 setAttribute 会触发 attribute mutation 重绘把手
  plugins.push(createTableCoordsPlugin())

  // 持久存储（storage: 'localStorage'）：恢复时存储内容优先，initialMarkdown 仅在无存储时兜底
  var storageBackend: StorageBackend | null = opts.storage === "localStorage" ? "localStorage" : null
  var storedViewState: Partial<MDWriterViewState> | null = storageBackend ? readStoredState(storageBackend) : null
  var initialMarkdown: string | null = storageBackend ? readStoredContent(storageBackend) : null
  if (initialMarkdown === null && typeof opts.initialMarkdown === "string") {
    initialMarkdown = opts.initialMarkdown
  }
  if (initialMarkdown === null) {
    initialMarkdown = ""
  }

  var doc = parseMarkdown(schema, markdownParser, initialMarkdown)
  var state = EditorState.create({schema: schema, doc: doc, plugins: plugins})

  var view: EditorView

  function applyMarkdownToEditor(markdown: string) {
    var nextDoc = parseMarkdown(schema, markdownParser, markdown)
    var nextState = EditorState.create({ schema: schema, doc: nextDoc, plugins: plugins })
    view.updateState(nextState)
    sync(nextState)
    refreshControls()
  }

  // 内容持久化：sync() 已完成 serialize，这里只做 debounce 落盘（高频输入不逐笔写 localStorage）。
  // pagehide / destroy 时强制 flush，避免 300ms 窗口内关闭页面丢最后一次编辑。
  var pendingStoredMarkdown: string | null = null
  var persistContentTimer: ReturnType<typeof setTimeout> | null = null

  function schedulePersistContent(markdown: string) {
    if (!storageBackend) {
      return
    }
    pendingStoredMarkdown = markdown
    if (persistContentTimer !== null) {
      clearTimeout(persistContentTimer)
    }
    persistContentTimer = setTimeout(function () {
      persistContentTimer = null
      flushPersistContent()
    }, 300)
  }

  function flushPersistContent() {
    if (persistContentTimer !== null) {
      clearTimeout(persistContentTimer)
      persistContentTimer = null
    }
    if (pendingStoredMarkdown !== null) {
      writeStoredContent(storageBackend || "localStorage", pendingStoredMarkdown)
      pendingStoredMarkdown = null
    }
  }

  // 视图状态持久化：三处切换（源码态 / 目录 / 韵律网格）后写整份状态
  function persistViewState() {
    if (!storageBackend) {
      return
    }
    writeStoredState(storageBackend, {
      sourceMode: isSourceModeActive(),
      showToc: tocVisible,
      showRhythmGrid: rhythmVisible
    })
  }

  function sync(nextState: EditorState) {
    var markdown = serializer.serialize(nextState.doc)
    if (storageBackend) {
      schedulePersistContent(markdown)
    }
    if (typeof opts.onChange === "function") {
      opts.onChange(markdown)
    }
    return markdown
  }

  var commandControls: { refresh: () => void } | null = null
  var viewControls: { refresh: () => void } | null = null
  var tocControls: { refresh: () => void; destroy: () => void } | null = null
  var mermaidPreviewRefreshers: Array<() => void> = []
  var lifecycleListeners: Array<() => void> = []
  var sourceModePending = false
  var sourceEditor: SourceEditorAdapter | null = null
  var sourceEditorReady: Promise<SourceEditorAdapter> | null = null

  function isSourceModeActive() {
    return sourceHost.style.display !== "none"
  }

  function refreshControls() {
    if (commandControls) {
      commandControls.refresh()
    }
    if (viewControls) {
      viewControls.refresh()
    }
    if (tocControls) {
      tocControls.refresh()
    }
  }


  function ensureSourceEditorReady() {
    if (sourceEditor) {
      return Promise.resolve(sourceEditor)
    }
    if (sourceEditorReady) {
      return sourceEditorReady
    }
    sourceEditorReady = Promise.resolve().then(function () {
      var editor = createCodeMirrorSourceEditor(
        sourceHost,
        serializer.serialize(view.state.doc),
        // 源码态的输入不经过 PM dispatchTransaction：由 CodeMirror 透传给持久层
        function (value: string) {
          schedulePersistContent(value)
        }
      )
      return editor
    }).then(function (editor) {
      sourceEditor = editor
      setElementVisible(sourceHost, false)
      return editor
    }).catch(function (error: unknown) {
      sourceEditorReady = null
      throw error
    })
    return sourceEditorReady
  }

  function enterSourceMode() {
    if (isSourceModeActive() || sourceModePending) {
      return
    }
    sourceModePending = true
    var markdown = serializer.serialize(view.state.doc)
    ensureSourceEditorReady().then(function (editor) {
      editor.setValue(markdown)
      setElementVisible(sourceHost, true)
      setElementVisible(view.dom, false)
      sourceModePending = false
      editor.refresh()
      editor.focus()
      refreshControls()
    }).catch(function (error) {
      sourceModePending = false
      console.warn("init source editor failed", error)
    })
  }

  function exitSourceMode() {
    if (!isSourceModeActive() || sourceModePending) {
      return
    }
    var markdown = sourceEditor ? sourceEditor.getValue() : serializer.serialize(view.state.doc)
    try {
      applyMarkdownToEditor(markdown)
    } catch (error) {
      console.warn("apply markdown from source failed", error)
    } finally {
      setElementVisible(sourceHost, false)
      setElementVisible(view.dom, true)
    }
    view.focus()
    refreshControls()
  }

  function toggleSourceMode() {
    if (isSourceModeActive()) {
      exitSourceMode()
    } else {
      enterSourceMode()
    }
    persistViewState()
  }

  function refreshMermaidPreviews() {
    mermaidPreviewRefreshers.slice().forEach(function (refresh) {
      refresh()
    })
  }

  // 预览类 NodeView（mermaid / svg）统一挂入 refresh 列表：
  // 对外 refreshMermaidPreviews() 一次刷新全部预览（含全屏态 pan/zoom 视口）
  function trackPreviewNodeView(nodeView: any) {
    if (!nodeView) {
      return null
    }
    mermaidPreviewRefreshers.push(nodeView.refresh)
    var destroy = nodeView.destroy
    nodeView.destroy = function() {
      var index = mermaidPreviewRefreshers.indexOf(nodeView.refresh)
      if (index !== -1) {
        mermaidPreviewRefreshers.splice(index, 1)
      }
      destroy()
    }
    return nodeView
  }

  view = new EditorView(mount, {
    state: state,
    // NodeView 注册表：按渲染来源分类（见 src/prosemirror/nodeviews/kinds.ts）——
    //   Content：PM 拥有 contentDOM（code_block 复制按钮）
    //   Raw：HTML source → browser DOM，维持交互边界（raw_block iframe）
    //   Widget：DSL → renderer → DOM（mermaid / 公式 / frontmatter）
    nodeViews: (function () {
      var nodeViews: any = {
        // Content / Widget：code_block 按 info 参数分派（mermaid → Widget，其余 → Content）
        code_block: function(node: PMNode, editorView: EditorView, getPos: () => number) {
          var ctx = {opts: opts, view: editorView, getPos: getPos}
          if (isMermaidCodeBlock(node)) {
            return trackPreviewNodeView(createMermaidNodeView(node, {opts: opts, view: editorView, getPos: getPos}))
          }
          return createCodeBlockCopyNodeView(node, ctx)
        },
        // 单图段落渲染为 div（块级图片 + rhythm），其余段落保持 PM 默认 p
        paragraph: function(node: PMNode) {
          return createImageBlockNodeView(node)
        },
        // Content：表格包壳叠加行列把手（拖动移动行/列，+ 按钮末尾追加）
        table: function(node: PMNode, editorView: EditorView, getPos: () => number) {
          return createTableHandlesNodeView(node, {opts: opts, view: editorView, getPos: getPos})
        },
        // Content：cell 级轻量 NodeView——grip 渲染进 td/th 里，mutation/事件
        // 在最近的 desc（cell 级）拦截 handle，table 级 NodeView 收不到询问
        table_cell: function(node: PMNode) {
          return createHandleAwareCellNodeView(node)
        },
        table_header: function(node: PMNode) {
          return createHandleAwareCellNodeView(node)
        }
      }
      if (opts.rawPreview) {
        // Widget：行内公式（raw_inline $…$），无块级选中交互
        nodeViews.raw_inline = function(node: PMNode, editorView: EditorView, getPos: () => number) {
          return createRawInlineMathNodeView(node, {opts: opts, view: editorView, getPos: getPos})
        }
        // raw_block 按文本内容分派 kind：iframe → Raw，math / frontmatter / svg → Widget
        nodeViews.raw_block = function(node: PMNode, editorView: EditorView, getPos: () => number) {
          var ctx = {opts: opts, view: editorView, getPos: getPos}
          var kind = getRawBlockKind(node.textContent)
          if (kind === "iframe") {
            return createIframeRawBlockNodeView(node, ctx)
          }
          if (kind === "math") {
            return createMathRawBlockNodeView(node, ctx)
          }
          if (kind === "frontmatter") {
            return createFrontmatterRawBlockNodeView(node, ctx)
          }
          if (kind === "svg") {
            return trackPreviewNodeView(createSvgBlockNodeView(node, ctx))
          }
          return null
        }
      }
      return nodeViews
    })(),
    // 事务按性质分流，高频事务只做必要的外溢，避免每笔 tr 都全量 serialize（O(文档大小)）：
    //   docChanged → sync()（serialize + onChange）
    //   docChanged 或 selectionChanged → refreshControls()（纯选区变化只刷 UI，不 serialize）
    dispatchTransaction: function(tr) {
      var previousSelection = view.state.selection
      var nextState = view.state.apply(tr)
      view.updateState(nextState)
      var docChanged = tr.docChanged
      var selectionChanged = !nextState.selection.eq(previousSelection)
      if (docChanged) {
        sync(nextState)
      }
      if (docChanged || selectionChanged) {
        refreshControls()
      }
    }
  })

  // 未外部指定时按钮渲染进库内工具栏容器（md-controls 内的 .md-editor-cmd / .md-editor-view）
  if (!formatBarRoot) {
    formatBarRoot = commandBarHost
  }
  if (formatBarRoot) {
    renderCommandButtons(formatBarRoot)
  }
  commandControls = bindCommandButtons(view, schema, formatBarRoot || document, opts, {
    isSourceMode: function () {
      return isSourceModeActive()
    }
  })

  if (!viewBarRoot) {
    viewBarRoot = viewBarHost
  }
  if (viewBarRoot) {
    renderViewButtons(viewBarRoot)
  }
  lifecycleListeners.push(function () {
    if (controlsRoot && controlsRoot.parentElement) {
      controlsRoot.parentElement.removeChild(controlsRoot)
      controlsRoot = null
    }
  })
  var tocRootElement: HTMLElement | null = null
  // 目录初始可见状态由 defaultShowTOC 配置，默认隐藏，工具栏 toggle_toc 按钮切换；
  // 开启 storage 时以存储状态优先
  var tocVisible = storedViewState ? storedViewState.showToc === true : opts.defaultShowTOC === true

  function toggleTocVisibility() {
    if (!tocRootElement) {
      return
    }
    tocVisible = !tocVisible
    setElementVisible(tocRootElement, tocVisible)
    refreshControls()
    persistViewState()
  }

  // 垂直韵律网格（body.rhythm-grid）：初始状态由 defaultShowRhythmGrid 配置，
  // 开启 storage 时以存储状态优先
  var rhythmVisible = storedViewState ? storedViewState.showRhythmGrid === true : opts.defaultShowRhythmGrid === true
  if (rhythmVisible) {
    toggleClass(document.body, "rhythm-grid", true)
  }
  function toggleRhythmGrid() {
    rhythmVisible = !rhythmVisible
    toggleClass(document.body, "rhythm-grid", rhythmVisible)
    refreshControls()
    persistViewState()
  }

  viewControls = bindViewButtons(viewBarRoot || document, {
    toggleSourceMode: toggleSourceMode,
    isSourceMode: function () {
      return isSourceModeActive()
    },
    toggleToc: toggleTocVisibility,
    isTocVisible: function () {
      return tocVisible
    },
    toggleRhythm: toggleRhythmGrid,
    isRhythmVisible: function () {
      return rhythmVisible
    }
  })

  lifecycleListeners.push(function () {
    removeClass(document.body, "rhythm-grid")
  })

  var tocAutoCreated = false
  if (opts.tocRoot) {
    var tocRoot = resolveElement(opts.tocRoot)
    if (!tocRoot) {
      throw new Error("MDWriter.init: tocRoot element is required when tocRoot is set")
    }
    tocRootElement = tocRoot as HTMLElement
  } else {
    // 未显式传入 tocRoot：直接插入到 mount（md-editor）下
    tocRootElement = <div />
    mount.appendChild(tocRootElement)
    tocAutoCreated = true
  }
  tocControls = bindTocPanel(tocRootElement, view, opts, {
    isSourceMode: function () {
      return isSourceModeActive()
    }
  })
  setElementVisible(tocRootElement, tocVisible)
  lifecycleListeners.push(function () {
    if (tocControls) {
      tocControls.destroy()
      tocControls = null
    }
    if (tocAutoCreated && tocRootElement && tocRootElement.parentElement) {
      tocRootElement.parentElement.removeChild(tocRootElement)
    }
    tocRootElement = null
  })

  var onGlobalKeydown = function (event: KeyboardEvent) {
    if (event.defaultPrevented) {
      return
    }
    if (!event.metaKey || event.ctrlKey || event.altKey) {
      return
    }
    if (event.key.toLowerCase() !== "e") {
      return
    }
    var activeElement = document.activeElement as Element | null
    var inEditor = !!(
      (activeElement && mount.contains(activeElement))
      || (formatBarRoot && activeElement && formatBarRoot.contains(activeElement))
      || (viewBarRoot && activeElement && viewBarRoot.contains(activeElement))
    )
    if (!inEditor) {
      return
    }
    event.preventDefault()
    toggleSourceMode()
  }
  document.addEventListener("keydown", onGlobalKeydown, true)
  lifecycleListeners.push(function () {
    document.removeEventListener("keydown", onGlobalKeydown, true)
  })

  sync(state)
  refreshControls()

  // 恢复上次会话的源码态视图（CodeMirror 懒加载完成后进入，内容为已恢复的 doc）
  if (storedViewState && storedViewState.sourceMode === true) {
    enterSourceMode()
  }

  // 关页兜底：debounce 窗口内（300ms）关闭页面也把内容落盘
  function handlePageHide() {
    flushPersistContent()
  }
  window.addEventListener("pagehide", handlePageHide)
  lifecycleListeners.push(function () {
    window.removeEventListener("pagehide", handlePageHide)
  })

  return {
    getMarkdown: function() {
      if (isSourceModeActive() && sourceEditor) {
        return sourceEditor.getValue()
      }
      return serializer.serialize(view.state.doc)
    },
    setMarkdown: function(markdown) {
      var nextMarkdown = String(markdown || "")
      if (isSourceModeActive()) {
        if (sourceEditor) {
          sourceEditor.setValue(nextMarkdown)
        }
      }
      applyMarkdownToEditor(nextMarkdown)
    },
    focus: function() {
      if (isSourceModeActive() && sourceEditor) {
        sourceEditor.focus()
        return
      }
      view.focus()
    },
    refreshMermaidPreviews: refreshMermaidPreviews,
    destroy: function() {
      flushPersistContent()
      lifecycleListeners.forEach(function (cleanup) {
        cleanup()
      })
      lifecycleListeners = []
      if (sourceEditor) {
        sourceEditor.destroy()
      }
      view.destroy()
    }
  }
}