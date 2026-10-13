import { Schema } from "prosemirror-model"
import { EditorView } from "prosemirror-view"
import { CommandButtonConfig, CommandRuntimeState, EditorAction, EditorCommand, MDWriterInitOptions, ViewButtonConfig } from "../types"
import { commandByName, isCommandActive, normalizeCommandName } from "./commands"
import { actionByName } from "./actions"
import { getTableContext } from "./table"
import { SvgIcon } from "../icons"
import { removeClass, toggleClass, hasClass, isFunction } from "../utils"
import { h, JSXChild } from "../jsx"
import { openHelpDialog } from "./help-dialog"

const commandButtons: Record<string, CommandButtonConfig> = {
  bold: {
    name: "加粗",
    code: "bold",
    shortcut: "Meta+B",
    svg: SvgIcon.bold
  },
  italic: {
    name: "斜体",
    code: "italic",
    shortcut: "Meta+I",
    svg: SvgIcon.italic
  },
  strike: {
    name: "删除线",
    code: "strike",
    svg: SvgIcon.strikethrough
  },
  inline_code: {
    name: "行内代码",
    code: "inline_code",
    svg: SvgIcon.code
  },
  blockquote: {
    name: "引用",
    code: "blockquote",
    svg: SvgIcon.quote
  },
  link: {
    name: "链接",
    code: "link",
    svg: SvgIcon.link
  },
  image_upload: {
    name: "图片上传",
    code: "image_upload",
    svg: SvgIcon.image
  },
  bullet_list: {
    name: "无序列表",
    code: "bullet_list",
    svg: SvgIcon.list
  },
  ordered_list: {
    name: "有序列表",
    code: "ordered_list",
    svg: SvgIcon.listOrdered
  },
  table_insert: {
    name: "插入 2x3 表格",
    code: "table_insert",
    svg: SvgIcon.table
  },
  table_add_row: {
    name: "添加行",
    code: "table_add_row",
    visibleWhen: "table",
    disabled: true,
    svg: SvgIcon.betweenHorizontalStart
  },
  table_add_column: {
    name: "添加列",
    code: "table_add_column",
    visibleWhen: "table",
    disabled: true,
    svg: SvgIcon.betweenVerticalStart
  },
  table_delete_row: {
    name: "删除行",
    code: "table_delete_row",
    visibleWhen: "table",
    disabled: true,
    svg: SvgIcon.listX
  },
  table_delete_column: {
    name: "删除列",
    code: "table_delete_column",
    visibleWhen: "table",
    disabled: true,
    svg: SvgIcon.listXRotateNeg90
  },
  table_move_column_left: {
    name: "左移列",
    code: "table_move_column_left",
    visibleWhen: "table",
    disabled: true,
    svg: SvgIcon.chevronFirst
  },
  table_move_column_right: {
    name: "右移列",
    code: "table_move_column_right",
    visibleWhen: "table",
    disabled: true,
    svg: SvgIcon.chevronLast
  },
  table_move_row_up: {
    name: "上移行",
    code: "table_move_row_up",
    visibleWhen: "table",
    disabled: true,
    svg: SvgIcon.chevronFirstRotate90
  },
  table_move_row_down: {
    name: "下移行",
    code: "table_move_row_down",
    visibleWhen: "table",
    disabled: true,
    svg: SvgIcon.chevronFirstRotateNeg90
  }
}

const viewButtons: Array<ViewButtonConfig> = [
  {
    name: "切换源码",
    code: "toggle_source",
    shortcut: "Meta+E",
    svg: SvgIcon.codeXml
  },
  {
    name: "切换目录",
    code: "toggle_toc",
    svg: SvgIcon.squareText
  },
  {
    name: "快捷键帮助",
    code: "show_help",
    svg: SvgIcon.circleHelp
  }
]

// devOnly 调试按钮：仅在 dev 构建（esbuild --define:APP_ENV="dev"）动态注册，固定倒数第 2 位。
// 宏直接内联在 if 条件中（不落中间变量），也不与运行时字段/过滤逻辑耦合——
// prod 构建下条件为常量 false，整个语句块编译期即被消除，按钮定义完全不进产物。
if (APP_ENV === "dev") {
  viewButtons.splice(viewButtons.length - 1, 0, {
    name: "切换韵律网格",
    code: "toggle_rhythm",
    svg: SvgIcon.grid3x3
  })
}

export function renderCommandButtons(root: Element) {
  var keys = Object.keys(commandButtons)
  // 窄屏收纳分界：图片上传（含）之后的命令收进「更多操作 ⋯」分组；
  // 宽屏下面板平铺（CSS display:contents），≤480px 收进下拉面板
  var collapsedFrom = keys.indexOf("image_upload")
  var plainButtons: Array<JSXChild> = []
  var collapsedButtons: Array<JSXChild> = []
  keys.forEach(function (key, index) {
    var item = commandButtons[key]
    var title = item.shortcut ? item.name + " (" + item.shortcut + ")" : item.name
    var button = (
      <button
        type="button"
        className="ui-icon-btn"
        aria-label={item.name}
        title={title}
        data-title={title}
        data-md-editor-command={item.code}
        data-md-editor-visible-when={item.visibleWhen || false}
        disabled={item.disabled || false}
        innerHTML={item.svg}
      />
    )
    if (index >= collapsedFrom) {
      collapsedButtons.push(button)
    } else {
      plainButtons.push(button)
    }
  })
  var moreGroup = (
    <span className="md-editor-more-group">
      <button
        type="button"
        className="ui-icon-btn md-editor-more-toggle"
        aria-label="更多操作"
        title="更多操作"
        aria-haspopup="true"
        aria-expanded="false"
        data-md-editor-more-toggle=""
        innerHTML={SvgIcon.ellipsis}
      />
      <span className="md-editor-more-panel" role="group" aria-label="更多操作">
        {collapsedButtons}
      </span>
    </span>
  )
  root.replaceChildren.apply(root, plainButtons.concat([moreGroup]) as Array<Node | string>)
  bindMoreGroupToggle(root)
}

/* 更多操作分组 ⋯ 按钮的展开/收起：宽屏下按钮平铺，toggle 不渲染显示，此绑定无副作用 */
function bindMoreGroupToggle(root: Element) {
  var groupFound = root.querySelector(".md-editor-more-group")
  var toggleFound = root.querySelector("[data-md-editor-more-toggle]")
  if (!(groupFound instanceof Element) || !(toggleFound instanceof Element)) {
    return
  }
  // narrowing 后再落到局部变量，避免闭包内类型收窄失效
  var group: Element = groupFound
  var toggle: Element = toggleFound
  function setOpen(open: boolean) {
    toggleClass(group, "md-editor-more-open", open)
    toggle.setAttribute("aria-expanded", open ? "true" : "false")
  }
  toggle.addEventListener("click", function (e) {
    e.preventDefault()
    e.stopPropagation()
    setOpen(!hasClass(group, "md-editor-more-open"))
  })
  // 面板内点命令按钮后收起（命令自身的 click 监听先于本委托触发，互不影响）
  group.addEventListener("click", function (e) {
    var target = e.target
    if (target instanceof Element && target.closest("[data-md-editor-command]")) {
      setOpen(false)
    }
  })
  // 点击分组外任意位置收起
  document.addEventListener("pointerdown", function (e) {
    var target = e.target
    if (target instanceof Node && !group.contains(target)) {
      setOpen(false)
    }
  })
}


export function bindCommandButtons(
  view: EditorView,
  schema: Schema,
  root: ParentNode | null,
  opts: MDWriterInitOptions,
  runtime?: CommandRuntimeState
): { refresh: () => void } {
  if (!root || !root.querySelectorAll) {
    return {
      refresh: function () {
      }
    }
  }

  var toggleCommands: Record<string, boolean> = {
    bold: true,
    italic: true,
    strike: true,
    inline_code: true,
    link: true,
    blockquote: true,
    bullet_list: true,
    ordered_list: true
  }
  var tableCommands: Record<string, boolean> = {
    table_add_row: true,
    table_add_column: true,
    table_delete_row: true,
    table_delete_column: true,
    table_move_row_up: true,
    table_move_row_down: true,
    table_move_column_left: true,
    table_move_column_right: true
  }
  var bindings: Array<{ el: HTMLButtonElement; name: string | null; command: EditorCommand | null; action: EditorAction | null; visibleWhen: string }> = []
  var els = root.querySelectorAll("[data-md-editor-command]") as NodeListOf<HTMLButtonElement>
  for (var i = 0; i < els.length; i += 1) {
    (function () {
      var el = els[i]
      var name = el.getAttribute("data-md-editor-command")
      // 纯 Command 优先；带 Dialog 的命令（link/image_upload）由 Action 层承接
      var command = commandByName(schema, name)
      var action = command ? null : actionByName(schema, name, opts)
      if (!command && !action) {
        return
      }
      var normalizedName = normalizeCommandName(name)
      var visibleWhen = String(el.getAttribute("data-md-editor-visible-when") || "").trim()
      bindings.push({el: el, name: name, command: command, action: action, visibleWhen: visibleWhen})
      if (toggleCommands[normalizedName]) {
        el.setAttribute("aria-pressed", "false")
      }
      el.addEventListener("click", function (e) {
        e.preventDefault()
        if (el.disabled || el.hidden) {
          return
        }
        try {
          view.focus()
        } catch (error) {
          console.warn("focus editor failed", error)
        }
        if (action) {
          action(view)
          return
        }
        if (command) {
          command(view.state, view.dispatch, view)
        }
      })
    })()
  }

  function refresh() {
    var sourceMode = !!(runtime && runtime.isSourceMode && runtime.isSourceMode())
    if (root instanceof Element) {
      toggleClass(root, "disabled", sourceMode)
      root.setAttribute("aria-disabled", sourceMode ? "true" : "false")
    }

    var inTable = !!getTableContext(view.state)
    // 同步「更多操作」分组禁用态：仅源码模式下 ⋯ 主按钮置灰——
    // 分组里图片/列表/插入表格在表外仍可用，表格操作按钮已逐个 disabled
    var moreGroup = root instanceof Element ? root.querySelector(".md-editor-more-group") : null
    if (moreGroup) {
      toggleClass(moreGroup, "md-editor-more-disabled", sourceMode)
    }
    for (var bi = 0; bi < bindings.length; bi += 1) {
      var binding = bindings[bi]
      var commandName = String(binding.name || "").trim()

      if (sourceMode) {
        binding.el.disabled = true
        removeClass(binding.el, "selected")
        binding.el.setAttribute("aria-pressed", "false")
        continue
      }

      binding.el.disabled = false
      if (binding.visibleWhen === "table") {
        binding.el.hidden = false
        if (!inTable) {
          binding.el.disabled = true
          continue
        }
      }
      if (!toggleCommands[commandName]) {
        if (tableCommands[commandName] && binding.command) {
          var enabled = binding.command(view.state, undefined, view)
          binding.el.disabled = !enabled
        }
        continue
      }
      var active = isCommandActive(schema, commandName, view.state)
      toggleClass(binding.el, "selected", active)
      binding.el.setAttribute("aria-pressed", active ? "true" : "false")
    }
  }

  refresh()
  return {refresh: refresh}
}

export function bindViewButtons(
  root: ParentNode | null,
  runtime?: CommandRuntimeState
): { refresh: () => void } {
  if (!root || !root.querySelectorAll) {
    return {
      refresh: function () {
      }
    }
  }

  var bindings: Array<{ el: HTMLButtonElement; name: string }> = []
  var els = root.querySelectorAll("[data-md-editor-view]") as NodeListOf<HTMLButtonElement>
  for (var i = 0; i < els.length; i += 1) {
    var el = els[i]
    var name = String(el.getAttribute("data-md-editor-view") || "").trim()
    if (!name) {
      continue
    }
    bindings.push({ el: el, name: name })
    el.addEventListener("click", function (event) {
      event.preventDefault()
      var target = event.currentTarget as HTMLButtonElement | null
      if (!target) {
        return
      }
      var action = String(target.getAttribute("data-md-editor-view") || "").trim()
      if (action === "toggle_source" && runtime && isFunction(runtime.toggleSourceMode)) {
        runtime.toggleSourceMode()
      }
      if (action === "toggle_toc" && runtime && isFunction(runtime.toggleToc)) {
        runtime.toggleToc()
      }
      if (action === "toggle_rhythm" && runtime && isFunction(runtime.toggleRhythm)) {
        runtime.toggleRhythm()
      }
      if (action === "show_help") {
        openHelpDialog(el)
      }
    })
  }

  function refresh() {
    for (var bi = 0; bi < bindings.length; bi += 1) {
      var binding = bindings[bi]
      if (binding.name === "toggle_source") {
        var sourceMode = !!(runtime && runtime.isSourceMode && runtime.isSourceMode())
        toggleClass(binding.el, "selected", sourceMode)
        binding.el.setAttribute("aria-pressed", sourceMode ? "true" : "false")
        continue
      }
      if (binding.name === "toggle_toc") {
        var tocVisible = !!(runtime && runtime.isTocVisible && runtime.isTocVisible())
        toggleClass(binding.el, "selected", tocVisible)
        binding.el.setAttribute("aria-pressed", tocVisible ? "true" : "false")
      }
      if (binding.name === "toggle_rhythm") {
        var rhythmVisible = !!(runtime && runtime.isRhythmVisible && runtime.isRhythmVisible())
        toggleClass(binding.el, "selected", rhythmVisible)
        binding.el.setAttribute("aria-pressed", rhythmVisible ? "true" : "false")
      }
    }
  }

  refresh()
  return { refresh: refresh }
}

export function renderViewButtons(root: Element) {
  // toggle_rhythm 由模块顶部 APP_ENV 宏 if 注册，prod 构建下不在数组中
  var buttons = viewButtons.map(function (item) {
    var title = item.shortcut ? item.name + " (" + item.shortcut + ")" : item.name
    return (
      <button
        type="button"
        className="ui-icon-btn"
        aria-label={item.name}
        title={title}
        data-title={title}
        data-md-editor-view={item.code}
        aria-pressed="false"
        innerHTML={item.svg}
      />
    )
  })
  root.replaceChildren.apply(root, buttons)
}