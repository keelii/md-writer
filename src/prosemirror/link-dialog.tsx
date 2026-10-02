import { LinkDialogResult } from "../types";
import { runManagedDialog } from "./dialog";
import { h } from "../jsx";

var LINK_DIALOG_ID = "md-editor-link-dialog"

export function requestHrefByDialog(currentHref: string, opener: Element | null, isEditing: boolean): Promise<LinkDialogResult> {
  var presetValue = currentHref ? String(currentHref).trim() : "https://"
  var promise = runManagedDialog({
    id: LINK_DIALOG_ID,
    title: "插入链接",
    cancelLabel: isEditing ? "删除链接" : "取消",
    opener: opener || null,
    focusSelector: '[data-role~="md-editor-link-input"]',
    bodyElement: (
      <input id="md-editor-link-input" className="ui-input" data-role="md-editor-link-input md-editor-dialog-value" type="url" inputmode="url" placeholder="https://" autocomplete="off" />
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
        input.value = presetValue
      }
    }
  })

  return promise.then(function (result): LinkDialogResult {
    if (!result) {
      return { action: "cancel", href: "" }
    }
    return {
      action: result.action,
      href: result.value
    }
  })
}