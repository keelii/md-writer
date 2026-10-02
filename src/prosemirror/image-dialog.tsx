import { DialogAction, MDWriterInitOptions } from "../types";
import { runManagedDialog } from "./dialog";
import { getImageUploadInput, resolveImageAttrs } from "./image-upload";
import { SvgIcon } from "../icons";
import { h, Fragment } from "../jsx";

export type ImageDialogResult = {
  action: "confirm" | "cancel";
  src: string;
  alt: string;
  title: string | null;
};

var IMAGE_DIALOG_ID = "md-editor-image-dialog"

export function requestImageByDialog(opener: Element | null, opts: MDWriterInitOptions): Promise<ImageDialogResult> {
  var promise = runManagedDialog({
    id: IMAGE_DIALOG_ID,
    title: "插入图片",
    opener: opener || null,
    focusSelector: '[data-role~="md-editor-image-input"]',
    bodyElement: (
      <>
        <button type="button" className="ui-file-pick" data-role="md-editor-image-pick" innerHTML={SvgIcon.upload}>从电脑选择</button>
        <input id="md-editor-image-input" className="ui-input" data-role="md-editor-image-input md-editor-dialog-value" type="url" inputmode="url" placeholder="https://" autocomplete="off" />
      </>
    ),
    customButtons: [
      {
        selector: '[data-role~="md-editor-image-pick"]',
        handler: function (backdrop, finish) {
          pickImageFromComputer(finish, opts)
        }
      }
    ],
    onOpen: function (backdrop) {
      var input = backdrop.querySelector('[data-role~="md-editor-image-input"]') as HTMLInputElement | null
      if (input) {
        input.value = ""
      }
    }
  })

  return promise.then(function (result): ImageDialogResult {
    if (!result || result.action !== "confirm" || !result.value) {
      return { action: "cancel", src: "", alt: "", title: null }
    }
    return { action: "confirm", src: result.value, alt: "", title: null }
  })
}

// 在 dialog 打开状态下触发文件选择：选中后经 onImageUpload（或 dataURL）解析出 src，直接确认
export function pickImageFromComputer(finish: (action: DialogAction, value: string) => void, opts: MDWriterInitOptions) {
  var input = getImageUploadInput()
  input.value = ""
  input.onchange = function () {
    var file = input.files && input.files.length > 0 ? input.files[0] : null
    if (!file) {
      return
    }
    resolveImageAttrs(file, opts).then(function (attrs) {
      if (!attrs || !attrs.src) {
        return
      }
      finish("confirm", attrs.src)
    }).catch(function (error) {
      console.warn("image selection failed", error)
    })
  }
  input.click()
}