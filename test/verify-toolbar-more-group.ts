// 窄屏工具栏「更多操作 ⋯ 分组」验证：
// 1. renderCommandButtons DOM 结构：图片上传（含）之后的 12 个命令收进 .md-editor-more-group
//    的 .md-editor-more-panel，其余 6 个按钮平铺在 root；toggle 带 aria-haspopup/expanded。
// 2. ⋯ toggle 开合：md-editor-more-open 类与 aria-expanded 同步。
// 3. 面板内点命令按钮后收起；点击分组外（document pointerdown）收起；分组内按下不收起。
// 4. bindCommandButtons.refresh：非表格光标分组不加禁用类（图片/列表/插入表格仍可用）、
//    表格操作按钮逐个 disabled；源码模式下分组加 md-editor-more-disabled。
// 5. dist/index.css 产物包含 .md-editor-more-panel、480px media query、5em 窄屏边距
//    与 tooltip 子编辑器的 :not 排除。
import { readFileSync } from "fs"
import { EditorState, TextSelection } from "prosemirror-state"
import { Node as PMNode } from "prosemirror-model"
import { SvgIcon } from "../src/icons"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, parseMarkdown } from "../src/prosemirror/markdown"
import { renderCommandButtons, bindCommandButtons } from "../src/prosemirror/buttons"

class FakeElement {
  tagName: string
  nodeType: number
  attrs: Record<string, string>
  children: FakeElement[]
  text: string
  listeners: Record<string, Array<(event: any) => void>>
  classSet: Set<string>
  parent: FakeElement | null
  disabled: boolean
  hidden: boolean

  constructor(tagName: string, nodeType: number, text?: string) {
    this.tagName = tagName
    this.nodeType = nodeType
    this.attrs = {}
    this.children = []
    this.text = text == null ? "" : text
    this.listeners = {}
    this.classSet = new Set()
    this.parent = null
    this.disabled = false
    this.hidden = false
  }

  setAttribute(name: string, value: string) {
    this.attrs[name] = String(value)
    if (name === "class") {
      this.classSet = new Set(String(value).split(/\s+/).filter(Boolean))
    }
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
  }

  get className(): string {
    return Array.from(this.classSet).join(" ")
  }

  get classList() {
    var self = this
    return {
      add: function (c: string) { self.classSet.add(c) },
      remove: function (c: string) { self.classSet.delete(c) },
      contains: function (c: string) { return self.classSet.has(c) },
      toggle: function (c: string, force?: boolean) {
        var on = force == null ? !self.classSet.has(c) : !!force
        if (on) {
          self.classSet.add(c)
        } else {
          self.classSet.delete(c)
        }
        return on
      }
    }
  }

  set innerHTML(value: string) {
    this.attrs["innerHTML"] = String(value)
  }

  get innerHTML(): string {
    return this.attrs["innerHTML"] || ""
  }

  appendChild(child: FakeElement) {
    this.children.push(child)
    child.parent = this
    return child
  }

  replaceChildren() {
    var self = this
    this.children = []
    for (var i = 0; i < arguments.length; i += 1) {
      var arg = arguments[i]
      if (arg && typeof (arg as any).nodeType === "number") {
        self.children.push(arg as FakeElement)
        ;(arg as FakeElement).parent = self
      }
    }
  }

  // 极简 selector：tag / .class / [attr] / [attr="value"] 序列
  matches(selector: string): boolean {
    var self = this
    var rest = selector.trim()
    var tagMatch = /^([a-zA-Z][\w-]*)/.exec(rest)
    if (tagMatch) {
      if (self.tagName !== tagMatch[1].toLowerCase()) {
        return false
      }
      rest = rest.slice(tagMatch[0].length)
    }
    var classMatch: RegExpExecArray | null
    while ((classMatch = /^\.([\w-]+)/.exec(rest))) {
      if (!self.classSet.has(classMatch[1])) {
        return false
      }
      rest = rest.slice(classMatch[0].length)
    }
    var attrMatch: RegExpExecArray | null
    while ((attrMatch = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest))) {
      if (attrMatch[2] === undefined) {
        if (!Object.prototype.hasOwnProperty.call(self.attrs, attrMatch[1])) {
          return false
        }
      } else if (self.attrs[attrMatch[1]] !== attrMatch[2]) {
        return false
      }
      rest = rest.slice(attrMatch[0].length)
    }
    return rest.length === 0
  }

  querySelectorAll(selector: string): FakeElement[] {
    var out: FakeElement[] = []
    function walk(el: FakeElement) {
      for (var i = 0; i < el.children.length; i += 1) {
        var child = el.children[i]
        if (child.nodeType === 1) {
          if (child.matches(selector)) {
            out.push(child)
          }
          walk(child)
        }
      }
    }
    walk(this)
    return out
  }

  querySelector(selector: string): FakeElement | null {
    var all = this.querySelectorAll(selector)
    return all.length > 0 ? all[0] : null
  }

  contains(node: FakeElement): boolean {
    var cur: FakeElement | null = node
    while (cur) {
      if (cur === this) {
        return true
      }
      cur = cur.parent
    }
    return false
  }

  closest(selector: string): FakeElement | null {
    var cur: FakeElement | null = this
    while (cur) {
      if (cur.matches(selector)) {
        return cur
      }
      cur = cur.parent
    }
    return null
  }

  addEventListener(type: string, fn: (event: any) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = []
    }
    this.listeners[type].push(fn)
  }
}

var documentListeners: Record<string, Array<(event: any) => void>> = {}

;(globalThis as any).Element = FakeElement
;(globalThis as any).Node = FakeElement
;(globalThis as any).document = {
  createElement: function (tag: string) { return new FakeElement(tag, 1) },
  createTextNode: function (text: string) { return new FakeElement("#text", 3, text) },
  createDocumentFragment: function () { return new FakeElement("#fragment", 11) },
  querySelectorAll: function () { return [] as FakeElement[] },
  addEventListener: function (type: string, fn: (event: any) => void) {
    if (!documentListeners[type]) {
      documentListeners[type] = []
    }
    documentListeners[type].push(fn)
  }
}

// ---- helpers ----

var passed = 0
var failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed += 1
    console.log("PASS " + passed + ": " + msg)
  } else {
    failed += 1
    console.log("FAIL " + failed + ": " + msg)
  }
}

function dispatch(el: FakeElement, type: string, event: any) {
  var list = el.listeners[type]
  if (list) {
    for (var i = 0; i < list.length; i += 1) {
      list[i](event)
    }
  }
}

function dispatchDocument(type: string, event: any) {
  var list = documentListeners[type]
  if (list) {
    for (var i = 0; i < list.length; i += 1) {
      list[i](event)
    }
  }
}

// ---- 构造编辑器 state / fake view ----

var schema = buildSchema()
var parser = buildMarkdownParser(schema)

// 假 view：dispatch 即 state.apply，focus 为空操作
function fakeViewFromDoc(doc: PMNode) {
  var state = EditorState.create({ schema: schema, doc: doc })
  var view: any = {
    state: state,
    dispatch: function (tr: any) {
      view.state = view.state.apply(tr)
    },
    focus: function () {}
  }
  return view
}

var plainView = fakeViewFromDoc(parseMarkdown(schema, parser, "hello\n") as PMNode)

// ---- 渲染 ----

var root = new FakeElement("div", 1)
root.setAttribute("class", "md-editor-commands")
renderCommandButtons(root)

// 1. root 结构：6 个平铺命令按钮 + 1 个 more-group
var flatButtons = Array.prototype.filter.call(
  root.querySelectorAll("button[data-md-editor-command]"),
  function (btn: any) { return btn.parent === root }
)
var moreGroup = root.querySelector(".md-editor-more-group")
assert(moreGroup != null, "root 存在 .md-editor-more-group")
assert(root.children.length === 7, "root 子节点 7 个（6 平铺按钮 + more-group），实际 " + root.children.length)
assert(flatButtons.length === 6, "平铺命令按钮 6 个，实际 " + flatButtons.length)
assert(moreGroup != null && moreGroup.children.length === 2, "more-group 含 toggle + panel 两个子节点")

var allButtons = root.querySelectorAll("button")
assert(allButtons.length === 19, "命令按钮总数 18 + 1 toggle = 19，实际 " + allButtons.length)

// 2. panel 内容：12 个按钮
var panel = moreGroup ? moreGroup.querySelector(".md-editor-more-panel") : null
assert(panel != null, "存在 .md-editor-more-panel")
var panelButtons = panel ? panel.querySelectorAll("button[data-md-editor-command]") : []
assert(panelButtons.length === 12, "panel 内 12 个命令按钮，实际 " + panelButtons.length)

var expectedPanelKeys = [
  "image_upload", "bullet_list", "ordered_list", "table_insert",
  "table_add_row", "table_add_column",
  "table_delete_row", "table_delete_column",
  "table_move_column_left", "table_move_column_right",
  "table_move_row_up", "table_move_row_down"
]
if (panel) {
  for (var pi = 0; pi < expectedPanelKeys.length; pi += 1) {
    var key = expectedPanelKeys[pi]
    var btn = panel.querySelector('button[data-md-editor-command="' + key + '"]')
    assert(btn != null, "panel 含命令 " + key)
  }
  var flatKeys = ["bold", "italic", "strike", "inline_code", "blockquote", "link"]
  for (var fi = 0; fi < flatKeys.length; fi += 1) {
    var fkey = flatKeys[fi]
    assert(panel.querySelector('button[data-md-editor-command="' + fkey + '"]') == null,
      "panel 不含平铺命令 " + fkey)
    assert(root.querySelector('button[data-md-editor-command="' + fkey + '"]') != null,
      "平铺命令 " + fkey + " 挂在 root")
  }
}

// 3. toggle / panel 属性
var toggle = moreGroup ? moreGroup.querySelector(".md-editor-more-toggle") : null
assert(toggle != null, "存在 .md-editor-more-toggle")
if (toggle) {
  assert(toggle.getAttribute("aria-haspopup") === "true", "toggle aria-haspopup=true")
  assert(toggle.getAttribute("aria-expanded") === "false", "toggle 初始 aria-expanded=false")
  assert(toggle.getAttribute("title") === "更多操作", "toggle title=更多操作")
  assert(toggle.getAttribute("aria-label") === "更多操作", "toggle aria-label=更多操作")
  assert(toggle.getAttribute("data-md-editor-more-toggle") === "", "toggle 带 data-md-editor-more-toggle 标记")
  assert(toggle.innerHTML === SvgIcon.ellipsis, "toggle 图标为 ellipsis")
  assert(toggle.classList.contains("ui-icon-btn"), "toggle 保留 ui-icon-btn 类")
  assert(panel != null && panel.getAttribute("role") === "group", "panel role=group")
  assert(panel != null && panel.getAttribute("aria-label") === "更多操作", "panel aria-label=更多操作")
}

// 4. 开合逻辑
if (toggle && moreGroup) {
  dispatch(toggle, "click", { preventDefault: function () {}, stopPropagation: function () {} })
  assert(moreGroup.classList.contains("md-editor-more-open"), "点击 toggle 后分组加 md-editor-more-open")
  assert(toggle.getAttribute("aria-expanded") === "true", "展开后 aria-expanded=true")

  // 组内命令按钮点击后收起（bindMoreGroupToggle 在 group 上委托）
  var panelBtn = moreGroup.querySelector('button[data-md-editor-command="image_upload"]')
  assert(panelBtn != null, "image_upload 按钮在 more-group 内")
  if (panelBtn) {
    dispatch(moreGroup, "click", { preventDefault: function () {}, stopPropagation: function () {}, target: panelBtn })
    assert(!moreGroup.classList.contains("md-editor-more-open"), "点击组内命令按钮后面板收起")
    assert(toggle.getAttribute("aria-expanded") === "false", "收起后 aria-expanded=false")
  }

  // 重新展开，组外 document pointerdown 收起
  dispatch(toggle, "click", { preventDefault: function () {}, stopPropagation: function () {} })
  assert(moreGroup.classList.contains("md-editor-more-open"), "再次点击 toggle 展开")
  var outsideEl = new FakeElement("div", 1)
  dispatchDocument("pointerdown", { target: outsideEl })
  assert(!moreGroup.classList.contains("md-editor-more-open"), "分组外 pointerdown 面板收起")

  // 组内 pointerdown 不收起
  dispatch(toggle, "click", { preventDefault: function () {}, stopPropagation: function () {} })
  assert(moreGroup.classList.contains("md-editor-more-open"), "第三次点击 toggle 展开")
  if (panel) {
    dispatchDocument("pointerdown", { target: panel })
    assert(moreGroup.classList.contains("md-editor-more-open"), "分组内 pointerdown 面板不收起")
  }
  dispatch(toggle, "click", { preventDefault: function () {}, stopPropagation: function () {} })
  assert(!moreGroup.classList.contains("md-editor-more-open"), "收起恢复初始")
}

// 5. bindCommandButtons / refresh 行为
var sourceMode = false
var runtime = {
  isSourceMode: function () { return sourceMode }
}
var bind = bindCommandButtons(plainView, schema, root, {} as any, runtime as any)

// 5a. 非表格光标：分组不加禁用类，表格命令逐个 disabled，图片/列表/插入表格可用
assert(moreGroup != null && !moreGroup.classList.contains("md-editor-more-disabled"),
  "非表格光标：分组无 md-editor-more-disabled")
if (panel) {
  var tableInsert = panel.querySelector('button[data-md-editor-command="table_insert"]')
  assert(tableInsert != null && !tableInsert.disabled && !tableInsert.hidden,
    "非表格光标：table_insert 可用")
  var tableCmds = [
    "table_add_row", "table_add_column", "table_delete_row", "table_delete_column",
    "table_move_column_left", "table_move_column_right", "table_move_row_up", "table_move_row_down"
  ]
  for (var ti = 0; ti < tableCmds.length; ti += 1) {
    var tb = panel.querySelector('button[data-md-editor-command="' + tableCmds[ti] + '"]')
    assert(tb != null && tb.disabled && !tb.hidden,
      "非表格光标：" + tableCmds[ti] + " disabled 且不 hidden")
    assert(tb != null && tb.getAttribute("data-md-editor-visible-when") === "table",
      "非表格光标：" + tableCmds[ti] + " visible-when=table")
  }
  var imgBtn = panel.querySelector('button[data-md-editor-command="image_upload"]')
  assert(imgBtn != null && !imgBtn.disabled, "非表格光标：image_upload 可用")
  var listBtn = panel.querySelector('button[data-md-editor-command="bullet_list"]')
  assert(listBtn != null && !listBtn.disabled, "非表格光标：bullet_list 可用")
}

// 5b. 表格内光标：表格命令启用
// 文档结构：table(0) > row(1) > header cell(2) > paragraph(3) > text @4
var tableView = fakeViewFromDoc(parseMarkdown(schema, parser, "| a | b |\n| --- | --- |\n| c | d |\n") as PMNode)
tableView.state = tableView.state.apply(
  tableView.state.tr.setSelection(TextSelection.create(tableView.state.doc, 4))
)
bind = bindCommandButtons(tableView, schema, root, {} as any, runtime as any)
if (panel) {
  var tb2 = panel.querySelector('button[data-md-editor-command="table_add_row"]')
  assert(tb2 != null && !tb2.disabled, "表格内光标：table_add_row 启用")
  var tb3 = panel.querySelector('button[data-md-editor-command="table_delete_column"]')
  assert(tb3 != null && !tb3.disabled, "表格内光标：table_delete_column 启用")
}

// 5c. 源码模式：分组禁用；退出后恢复
sourceMode = true
bind.refresh()
assert(moreGroup != null && moreGroup.classList.contains("md-editor-more-disabled"),
  "源码模式：分组加 md-editor-more-disabled")
sourceMode = false
bind.refresh()
assert(moreGroup != null && !moreGroup.classList.contains("md-editor-more-disabled"),
  "退出源码模式：移除禁用类")

// 6. dist/index.css 产物断言
try {
  var css = readFileSync("dist/index.css", "utf-8")
  assert(css.indexOf(".md-editor-more-panel") !== -1, "dist/index.css 含 .md-editor-more-panel")
  assert(css.indexOf(".md-editor-more-toggle") !== -1, "dist/index.css 含 .md-editor-more-toggle")
  assert(css.indexOf("button.md-editor-more-toggle") !== -1, "dist/index.css 宽屏隐藏 ⋯ 的规则带 button. 前缀（特异度需压过 .md-controls button）")
  assert(css.indexOf(".md-editor-more-open") !== -1, "dist/index.css 含 .md-editor-more-open")
  assert(css.indexOf(".md-editor-more-disabled") !== -1, "dist/index.css 含 .md-editor-more-disabled")
  assert(css.indexOf("480px") !== -1, "dist/index.css 含 480px media query")
  assert(css.indexOf("5em") !== -1, "dist/index.css 含 5em 窄屏 padding")
  assert(css.indexOf(".ProseMirror:not(.md-editor-tooltip .ProseMirror)") !== -1,
    "dist/index.css 窄屏规则排除 tooltip 子编辑器")
  assert(css.indexOf(".md-editor-table-group") === -1, "dist/index.css 不再含旧 .md-editor-table-group")
} catch (e) {
  assert(false, "读取 dist/index.css 失败: " + String(e))
}

console.log("")
console.log("passed=" + passed + " failed=" + failed)
if (failed > 0) {
  process.exit(1)
}
