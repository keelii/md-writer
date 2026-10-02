// Action 层：产品交互编排（UI → Action → Dialog → Command → Transaction）
// Action 允许异步（打开 Dialog、等待 Promise），完成后用最新的 view.state 调用纯 Command；
// Command 保持 (state, dispatch?) => boolean 的同步契约，见 commands.ts
import { MarkType, Schema } from "prosemirror-model"
import { EditorView } from "prosemirror-view"
import { EditorAction, MDWriterInitOptions } from "../types"
import { requestHrefByDialog } from "./link-dialog"
import { requestImageByDialog } from "./image-dialog"
import { requestSourceByDialog } from "./source-edit-dialog"
import { createImageInsertCommand, createLinkApplyCommand, createLinkEditCommand, createLinkRemoveCommand, createPreviewSourceReplaceCommand, getActiveLinkMark, getLinkMarkRangeAtCursor } from "./commands"
import { getRawBlockKind, isPreviewBlock } from "./nodeviews/kinds"

// 链接 Action：光标在链接内或选区包含链接时进入编辑弹窗（可改可删），否则新建链接
function createLinkAction(link: MarkType): EditorAction {
  return function (view) {
    var state = view.state
    var cursorRange = state.selection.empty ? getLinkMarkRangeAtCursor(state, link) : null
    var activeLink = getActiveLinkMark(state, link)

    // 光标在链接内或选区包含链接时，进入编辑模式：弹 dialog 修改/删除链接
    if (activeLink || cursorRange) {
      var currentHref = activeLink ? String(activeLink.attrs.href || "") : ""
      requestHrefByDialog(currentHref, view.dom, true).then(function (result) {
        // dialog 打开期间 state 可能已变化，用最新的 view.state 重新解析作用范围
        var nextState = view.state
        var nextSelection = nextState.selection
        var nextCursorRange = nextSelection.empty ? getLinkMarkRangeAtCursor(nextState, link) : null
        var range = nextCursorRange || {from: nextSelection.from, to: nextSelection.to}

        if (result.action === "remove") {
          createLinkRemoveCommand(link, range)(nextState, view.dispatch)
          view.focus()
          return
        }
        if (result.action === "cancel" || !result.href) {
          view.focus()
          return
        }
        createLinkEditCommand(link, range, result.href)(nextState, view.dispatch)
        view.focus()
      })
      return
    }

    // 无链接上下文时，新建链接：空选区插入 href 文本，非空选区对选区应用 mark
    requestHrefByDialog("", view.dom, false).then(function (result) {
      if (result.action !== "confirm" || !result.href) {
        return
      }
      var nextState = view.state
      var nextSelection = nextState.selection
      createLinkApplyCommand(link, nextSelection.from, nextSelection.to, result.href)(nextState, view.dispatch)
      view.focus()
    })
  }
}

// 图片上传 Action：弹窗收集 src（本地文件经 onImageUpload 解析或直接填 URL），再走纯命令插入图片节点
function createImageUploadAction(schema: Schema, opts: MDWriterInitOptions): EditorAction {
  return function (view) {
    requestImageByDialog(view.dom, opts).then(function (result) {
      if (result.action !== "confirm" || !result.src) {
        view.focus()
        return
      }
      createImageInsertCommand(schema, { src: result.src, alt: result.alt, title: result.title })(view.state, view.dispatch)
      view.focus()
    })
  }
}

// 预览块源码编辑 Action：弹 dialog 编辑源文本，confirm 后走纯命令替换内容。
// pos 来自 DecoMenu 的 decoration 重算，dialog 打开期间文档可能已变化，
// 由命令按最新 view.state 重读校验。内容替换后 NodeView update 比对 textContent
// 自动重渲染（公式 / mermaid 重算，iframe / frontmatter / svg 重建）；
// 源码改到不再匹配预览形态时 update 返回 false、PM 重建为普通节点。
export function editPreviewBlockSource(view: EditorView, pos: number, opener: Element | null, opts?: MDWriterInitOptions) {
  var node = view.state.doc.nodeAt(pos)
  if (!node || !isPreviewBlock(node)) {
    return
  }
  var kind = node.type.name === "code_block" ? "mermaid" : getRawBlockKind(node.textContent)
  requestSourceByDialog("编辑源码", node.textContent, opener, kind === "math" || kind === "svg" || kind === "mermaid" ? kind : null, opts).then(function (result) {
    if (result.action !== "confirm") {
      view.focus()
      return
    }
    createPreviewSourceReplaceCommand(pos, result.source)(view.state, view.dispatch)
    view.focus()
  })
}

// Action 注册表：与 commandByName 同名空间分流，带 Dialog 的命令在这里以 Action 形式提供
export function actionByName(schema: Schema, name: string | null | undefined, opts: MDWriterInitOptions): EditorAction | null {
  var actionName = (name || "").trim()
  switch (actionName) {
    case "link":
      return schema.marks.link ? createLinkAction(schema.marks.link) : null
    case "image_upload":
      return createImageUploadAction(schema, opts)
    default:
      return null
  }
}