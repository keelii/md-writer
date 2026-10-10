import { DialogAction, DialogResult } from "../types"
import { SvgIcon } from "../icons"
import { h } from "../jsx"
import "./dialog.css"

export interface DialogCustomButton {
  selector: string;
  handler: (backdrop: HTMLElement, finish: (action: DialogAction, value: string) => void) => void;
}

export interface RunDialogOptions {
  id: string;
  title: string;
  bodyElement: Node;
  ariaLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  buttonExtra?: Element;
  // 弹窗内容宽度（如 "640px"），以 max-width 应用：视口更窄时自动收缩
  width?: string;
  opener?: Element | null;
  focusSelector?: string;
  // 取值注入：默认经 data-role~="md-editor-dialog-value" 取 .value（input/textarea），
  // 非 input 控件（如 CodeMirror 容器）无 .value，由调用方提供本函数读取
  getValue?: (backdrop: HTMLElement) => string;
  onOpen?: (backdrop: HTMLElement) => void;
  onClose?: (backdrop: HTMLElement) => void;
  customButtons?: DialogCustomButton[];
}

var activeDialogFinish: ((action: DialogAction, value: string) => void) | null = null

function buildDialogDom(options: RunDialogOptions): HTMLElement {
  var ariaLabel = options.ariaLabel || options.title
  var confirmLabel = options.confirmLabel || "确定"
  var cancelLabel = options.cancelLabel || "取消"
  var bodyEl = <div className="ui-dialog-body">{options.bodyElement}</div>
  var buttonExtra = options.buttonExtra || ""
  return (
    <div
      className="ui-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      style={options.width ? { maxWidth: options.width } : undefined}
    >
      <div className="ui-dialog-header">
        <div className="ui-dialog-title">{options.title}</div>
        <button
          type="button"
          className="ui-icon-btn"
          data-role="ui-dialog-close"
          aria-label="关闭"
          data-title="关闭"
          innerHTML={SvgIcon.x}
        />
      </div>
      {bodyEl}
      <div className="ui-dialog-footer">
        <div className="ui-dialog-button-extra">{buttonExtra}</div>
        <div className="ui-dialog-button">
          <button type="button" className="ui-btn outline" data-role="md-editor-dialog-cancel ui-dialog-cancel">{cancelLabel}</button>
          <button type="button" className="ui-btn primary" data-role="md-editor-dialog-confirm">{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

function ensureDialogBackdrop(options: RunDialogOptions): HTMLElement {
  var backdrop = document.getElementById(options.id)
  if (backdrop) {
    return backdrop
  }

  backdrop = (
    <div
      id={options.id}
      className="md-editor-dialog ui-dialog-backdrop"
      data-role="ui-dialog-backdrop"
      data-dialog-id={options.id}
      role="presentation"
      hidden=""
    />
  )
  backdrop.appendChild(buildDialogDom(options))
  document.body.appendChild(backdrop)
  return backdrop
}

export function openManagedDialog(dialogID: string, opener: Element | null) {
  var backdrop = document.getElementById(dialogID)
  if (!backdrop) {
    return false
  }
  backdrop.removeAttribute("hidden")
  return true
}

export function closeManagedDialog(dialogID: string) {
  var backdrop = document.getElementById(dialogID)
  if (!backdrop) {
    return false
  }
  backdrop.setAttribute("hidden", "")
  return true
}

export function runManagedDialog(options: RunDialogOptions): Promise<DialogResult | null> {
  var backdrop = ensureDialogBackdrop(options)
  var customButtons = options.customButtons || []

  return new Promise(function (resolve) {
    if (typeof activeDialogFinish === "function") {
      activeDialogFinish("cancel", "")
    }

    var done = false

    function getDialogValue(): string {
      if (typeof options.getValue === "function") {
        return String(options.getValue(backdrop))
      }
      var input = backdrop.querySelector('[data-role~="md-editor-dialog-value"]') as HTMLInputElement | null
      return input && typeof input.value === "string" ? input.value : ""
    }

    function cleanup() {
      backdrop.removeEventListener("click", onBackdropClick, true)
      document.removeEventListener("keydown", onBackdropKeydown, true)
      if (activeDialogFinish === finish) {
        activeDialogFinish = null
      }
    }

    function finish(action: DialogAction, value: string) {
      if (done) {
        return
      }
      done = true
      cleanup()
      if (options.onClose) options.onClose(backdrop)
      closeManagedDialog(options.id)
      resolve({ action: action, value: value.trim() })
    }

    function onBackdropClick(event: MouseEvent) {
      var target = event.target as HTMLElement | null
      if (!target || !target.closest) {
        return
      }

      for (var index = 0; index < customButtons.length; index += 1) {
        var customBtn = target.closest(customButtons[index].selector)
        if (customBtn && backdrop.contains(customBtn)) {
          event.preventDefault()
          customButtons[index].handler(backdrop, finish)
          return
        }
      }

      var okBtn = target.closest('[data-role~="md-editor-dialog-confirm"]')
      if (okBtn && backdrop.contains(okBtn)) {
        event.preventDefault()
        finish("confirm", getDialogValue())
        return
      }

      var cancelBtn = target.closest('[data-role~="md-editor-dialog-cancel"], [data-role~="ui-dialog-close"], [data-role~="ui-dialog-cancel"]')
      if (cancelBtn && backdrop.contains(cancelBtn)) {
        event.preventDefault()
        finish("cancel", "")
        return
      }

      if (target === backdrop) {
        event.preventDefault()
        finish("cancel", "")
      }
    }

    function onBackdropKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        finish("cancel", "")
        return
      }
      if (event.key === "Enter") {
        var target = event.target as HTMLElement | null
        if (target && target.tagName === "INPUT" && backdrop.contains(target)) {
          event.preventDefault()
          finish("confirm", getDialogValue())
        }
      }
    }

    backdrop.addEventListener("click", onBackdropClick, true)
    document.addEventListener("keydown", onBackdropKeydown, true)
    activeDialogFinish = finish

    if (typeof options.onOpen === "function") {
      options.onOpen(backdrop)
    }

    if (!openManagedDialog(options.id, options.opener || null)) {
      cleanup()
      if (options.onClose) options.onClose(backdrop)
      resolve(null)
      return
    }

    window.setTimeout(function () {
      var focusTarget = options.focusSelector
        ? backdrop.querySelector(options.focusSelector) as HTMLElement | null
        : null
      if (focusTarget && typeof focusTarget.focus === "function") {
        focusTarget.focus()
        if (typeof (focusTarget as HTMLInputElement).select === "function") {
          (focusTarget as HTMLInputElement).select()
        }
      }
    }, 0)
  })
}