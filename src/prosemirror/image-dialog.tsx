import { MDWriterInitOptions } from "../types";
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
  // backdrop DOM 按 id 复用，alt 输入框的引用在 onOpen 时刷新，confirm 后仍然有效
  var altInput: HTMLInputElement | null = null
  var promise = runManagedDialog({
    id: IMAGE_DIALOG_ID,
    title: "插入图片",
    opener: opener || null,
    focusSelector: '[data-role~="md-editor-image-input"]',
    bodyElement: (
      <>
        <button type="button" className="ui-file-pick" data-role="md-editor-image-pick" innerHTML={SvgIcon.upload}>从电脑选择</button>
        <p><input id="md-editor-image-input" className="ui-input" data-role="md-editor-image-input md-editor-dialog-value" type="url" inputmode="url" placeholder="图片地址 https://" autocomplete="off" /></p>
        <p><input id="md-editor-image-alt" className="ui-input" data-role="md-editor-image-alt" type="text" placeholder="描述文本（可选）" autocomplete="off" /></p>
      </>
    ),
    customButtons: [
      {
        selector: '[data-role~="md-editor-image-pick"]',
        handler: function (backdrop) {
          pickImageFromComputer(backdrop, opts)
        }
      }
    ],
    onOpen: function (backdrop) {
      var input = backdrop.querySelector('[data-role~="md-editor-image-input"]') as HTMLInputElement | null
      if (input) {
        input.value = ""
      }
      altInput = backdrop.querySelector('[data-role~="md-editor-image-alt"]') as HTMLInputElement | null
      if (altInput) {
        altInput.value = ""
      }
    }
  })

  return promise.then(function (result): ImageDialogResult {
    if (!result || result.action !== "confirm" || !result.value) {
      return { action: "cancel", src: "", alt: "", title: null }
    }
    var alt = altInput && altInput.value ? altInput.value.trim() : ""
    return { action: "confirm", src: result.value, alt: alt, title: null }
  })
}

// 在 dialog 打开状态下触发文件选择：选中后经 onImageUpload（或 dataURL）解析出 src/alt，
// 回填到弹窗输入框（不自动确认，用户可补充修改替代文本后再确认）
export function pickImageFromComputer(backdrop: Element, opts: MDWriterInitOptions) {
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
      var srcInput = backdrop.querySelector('[data-role~="md-editor-image-input"]') as HTMLInputElement | null
      var altField = backdrop.querySelector('[data-role~="md-editor-image-alt"]') as HTMLInputElement | null
      if (srcInput) {
        srcInput.value = attrs.src
      }
      if (altField) {
        altField.value = attrs.alt
        altField.focus()
        altField.select()
      }
    }).catch(function (error) {
      console.warn("image selection failed", error)
    })
  }
  input.click()
}
