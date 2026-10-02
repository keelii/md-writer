import { MDWriterInitOptions, ImageUploadResult } from "../types"
import { readFileAsDataURL } from "../utils"
import { h } from "../jsx"

export function getImageUploadInput(): HTMLInputElement {
  var id = "md-editor-image-upload-input"
  var input = document.getElementById(id) as HTMLInputElement | null
  if (input) {
    return input
  }

  input = (
    <input id={id} type="file" accept="image/*" multiple={true} style="display: none" />
  ) as HTMLInputElement
  document.body.appendChild(input)
  return input
}

export function resolveImageAttrs(file: File, opts?: MDWriterInitOptions) {
  if (opts && typeof opts.onImageUpload === "function") {
    return Promise.resolve(opts.onImageUpload(file)).then(function (result: ImageUploadResult) {
      if (typeof result === "string") {
        return {src: result, alt: file.name || "", title: null}
      }
      if (result && typeof result === "object") {
        var src = result.src || result.url || ""
        var alt = result.alt == null ? (file.name || "") : String(result.alt)
        var title = result.title == null ? null : String(result.title)
        return {src: String(src), alt: alt, title: title}
      }
      return null
    })
  }

  return readFileAsDataURL(file).then(function (dataURL: string) {
    return {src: dataURL, alt: file.name || "", title: null}
  })
}