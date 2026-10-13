import { LinkDialogResult } from "../types";
import { runManagedDialog } from "./dialog";
import { h, Fragment } from "../jsx";

var LINK_DIALOG_ID = "md-editor-link-dialog"

// 链接弹窗：链接文本与链接地址两个字段始终展示。
// - 编辑既有链接：currentText 回填当前链接文本，确认后若文本变化则替换文档中的文本
// - 新建链接：currentText 为选中文本（有选区时），空串表示以 href 作为链接文本
export function requestHrefByDialog(currentHref: string, currentText: string, opener: Element | null, isEditing: boolean): Promise<LinkDialogResult> {
  var presetHref = currentHref || "https://"
  // backdrop DOM 按 id 复用，文本输入框的引用在 onOpen 时刷新，confirm 后仍然有效（同 image-dialog alt）
  var textInput: HTMLInputElement | null = null
  var promise = runManagedDialog({
    id: LINK_DIALOG_ID,
    title: "插入链接",
    cancelLabel: isEditing ? "删除链接" : "取消",
    opener: opener || null,
    focusSelector: '[data-role~="md-editor-link-input"]',
    bodyElement: (
      <>
        <p><input id="md-editor-link-input" className="ui-input" data-role="md-editor-link-input md-editor-dialog-value" type="url" inputmode="url" placeholder="https://" autocomplete="off" /></p>
        <p><input id="md-editor-link-text" className="ui-input" data-role="md-editor-link-text" type="text" placeholder="链接文本（可选，留空以地址为文本）" autocomplete="off" /></p>
      </>
    ),
    customButtons: [
      {
        selector: '[data-role~="md-editor-dialog-cancel"]',
        handler: function (backdrop, finish) {
          finish(isEditing ? "remove" : "cancel", "")
        }
      }
    ],
    onOpen: function (backdrop) {
      var input = backdrop.querySelector('[data-role~="md-editor-link-input"]') as HTMLInputElement | null
      if (input) {
        input.value = presetHref
      }
      textInput = backdrop.querySelector('[data-role~="md-editor-link-text"]') as HTMLInputElement | null
      if (textInput) {
        textInput.value = currentText
      }
    }
  })

  return promise.then(function (result): LinkDialogResult {
    if (!result) {
      return { action: "cancel", href: "", text: "" }
    }
    var text = textInput && textInput.value ? textInput.value.trim() : ""
    return {
      action: result.action,
      href: result.value,
      text: text
    }
  })
}