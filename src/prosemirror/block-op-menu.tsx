// 块操作菜单通用构建器（BlockOpMenu）：dropdown 的公共实现，宿主无关——
// DecoMenu（block-menu 的 Decoration.widget）与 OpButton（NodeView 内角标）共用。
// DecoMenu 形态约定：
// - 至少含一个删除操作（唯一例外：文档仅剩一个段落时省略删除项，见 paragraph-menu）；
// - 操作多于一项时以 dropdown 呈现（主按钮 + 下拉面板），单项时直接渲染为图标按钮；
// - 面板行统一样式，不为个别操作单独配色：通用操作用 icon（必须带 title），
//   icon 表达不准确时用文字（语言候选等列表选择项除外）。
// 主按钮默认为 ⋯；需要"默认显示当前值"的菜单（如代码块语言）可传 toggleLabel 渲染文字，
// 需要"默认显示块类型"的菜单（如列表/引用）可传 toggleIcon 渲染图标。
// 定位/显隐/外部点击关闭由宿主提供（DecoMenu 侧为 block-menu.ts 核心），
// 面板互斥用 closeAllOpenBlockMenus，此处只负责菜单内容与操作分发。
import { h } from "../jsx"
import { removeClass, stopEvent, toggleClass } from "../utils"
import { SvgIcon } from "../icons"
import { closeAllOpenBlockMenus } from "./block-menu"
import "./block-op-menu.css"

export interface BlockOpMenuItem {
  // icon 项的 title/aria-label；无 icon 时的可见文字（操作项最多两个字）
  label: string
  // 可选图标（SvgIcon 中的内联 SVG）
  icon?: string
  // 带图标时是否同时显示可见文字；默认仅显示图标
  showLabel?: boolean
  // 该项前渲染分隔线（如语言候选列表与删除操作之间的分组）
  divider?: boolean
  // 列表选择项的当前值（如当前语言），面板行高亮标识
  active?: boolean
  run: () => void
}

export interface BlockOpMenuOptions {
  // 主按钮显示自定义文字（如当前语言），传入即强制 dropdown 形态
  toggleLabel?: string
  // 主按钮显示自定义图标（如当前列表类型 icon），传入即强制 dropdown 形态
  toggleIcon?: string
  // 主按钮的 title/aria-label，默认用 toggleLabel
  toggleTitle?: string
}

// menuClass：具体菜单的补充类名（如 md-editor-node-op-menu，供特异性样式/隐藏规则用）；
// options.toggleLabel：主按钮显示自定义文字（强制 dropdown 形态），options.toggleTitle 为其 title；
// options.toggleIcon：主按钮显示自定义图标（强制 dropdown 形态），如当前列表类型的 icon。
export function buildBlockOpMenuDom(menuClass: string, items: BlockOpMenuItem[], options?: BlockOpMenuOptions): HTMLElement {
  if (items.length === 1 && !(options && (options.toggleLabel || options.toggleIcon))) {
    var single = items[0]
    // 块前 widget 可能在 mousedown 后被编辑器重绘，导致 click 落不到原按钮。
    // 鼠标按下即执行；键盘合成 click 则仍由 click 处理。
    var handledOnMouseDown = false
    return (
      <span className={"md-editor-block-menu md-editor-block-op-menu " + menuClass}>
        <button
          type="button"
          className="md-editor-block-op-menu-button"
          aria-label={single.label}
          title={single.label}
          innerHTML={single.icon || ""}
          onMouseDown={function (event: MouseEvent) {
            stopEvent(event)
            if (event.button !== 0) return
            handledOnMouseDown = true
            single.run()
          }}
          onClick={function (event: MouseEvent) {
            stopEvent(event)
            if (handledOnMouseDown) {
              handledOnMouseDown = false
              return
            }
            if (event.detail === 0) single.run()
          }}
        />
      </span>
    )
  }

  var toggleLabel = options && options.toggleLabel ? options.toggleLabel : ""
  var toggleIcon = options && options.toggleIcon ? options.toggleIcon : ""
  var toggleTitle = options && options.toggleTitle ? options.toggleTitle : (toggleLabel || "块操作")
  var host = (
    <span className={"md-editor-block-menu md-editor-block-op-menu " + menuClass}>
      {toggleLabel ? (
        <button
          type="button"
          className="md-editor-block-op-menu-button md-editor-block-op-menu-toggle-text"
          aria-label={toggleTitle}
          aria-haspopup="true"
          title={toggleTitle}
          onMouseDown={stopEvent}
          onClick={function (event: MouseEvent) {
            stopEvent(event)
            closeAllOpenBlockMenus(host)
            toggleClass(host, "md-editor-block-menu-open")
          }}
        >{toggleLabel}</button>
      ) : (
        <button
          type="button"
          className="md-editor-block-op-menu-button"
          aria-label={toggleTitle}
          aria-haspopup="true"
          title={toggleTitle}
          innerHTML={toggleIcon || SvgIcon.ellipsis}
          onMouseDown={stopEvent}
          onClick={function (event: MouseEvent) {
            stopEvent(event)
            closeAllOpenBlockMenus(host)
            toggleClass(host, "md-editor-block-menu-open")
          }}
        />
      )}
      <div className="md-editor-block-op-menu-panel">
        {items.map(function (item) {
          return [
            item.divider ? <div className="md-editor-block-op-menu-divider" /> : null,
            <button
              type="button"
              className={"md-editor-block-op-menu-item" + (item.active ? " md-editor-block-op-menu-item-active" : "")}
              title={item.label}
              aria-label={item.label}
              onMouseDown={stopEvent}
              onClick={function (event: MouseEvent) {
                stopEvent(event)
                removeClass(host, "md-editor-block-menu-open")
                item.run()
              }}
            >
              {item.icon ? <span className="md-editor-block-op-menu-icon" innerHTML={item.icon} /> : null}
              {(!item.icon || item.showLabel) ? item.label : null}
            </button>
          ]
        })}
      </div>
    </span>
  )
  return host
}