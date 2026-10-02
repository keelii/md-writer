// 快捷键帮助弹窗内容验证：帮助表格应覆盖全部分组，
// 且必须包含软回车、双空格退出表格、Tab 移格、Meta+滚轮缩放等无按钮的隐形功能。
// buildHelpBody 用 JSX(h) 构建真实 DOM，这里提供最小 DOM stub 驱动构建并断言节点结构。
import { buildHelpBody } from "../src/prosemirror/help-dialog"

class FakeNode {
  tagName: string
  nodeType: number
  attrs: Record<string, string>
  children: FakeNode[]
  text: string

  constructor(tagName: string, nodeType: number, text?: string) {
    this.tagName = tagName
    this.nodeType = nodeType
    this.attrs = {}
    this.children = []
    this.text = text == null ? "" : text
  }

  setAttribute(name: string, value: string) {
    this.attrs[name] = value
  }

  appendChild(child: FakeNode) {
    this.children.push(child)
    return child
  }

  get className(): string {
    return this.attrs["class"] || ""
  }

  get textContent(): string {
    var out = this.text
    for (var i = 0; i < this.children.length; i += 1) {
      out += this.children[i].textContent
    }
    return out
  }
}

function findDescendants(node: FakeNode, tagName: string): FakeNode[] {
  var out: FakeNode[] = []
  for (var i = 0; i < node.children.length; i += 1) {
    var child = node.children[i]
    if (child.nodeType === 1 && child.tagName === tagName) {
      out.push(child)
    }
    out = out.concat(findDescendants(child, tagName))
  }
  return out
}

// 注入最小 document stub，供 h() 使用
;(globalThis as any).document = {
  createElement: function (tag: string) {
    return new FakeNode(tag, 1)
  },
  createTextNode: function (text: string) {
    return new FakeNode("#text", 3, String(text))
  },
  createDocumentFragment: function () {
    return new FakeNode("#fragment", 11)
  }
}

var failures = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log("PASS: " + label)
  } else {
    failures += 1
    console.log("FAIL: " + label)
  }
}

var body = buildHelpBody() as unknown as FakeNode

// 结构：根为 div.ui-shortcut-body，内含 5 个分组标题 + 5 个表格
assert(body.nodeType === 1 && body.tagName === "div", "根节点是元素")
assert(body.className === "ui-shortcut-body", "根节点 class 为 ui-shortcut-body")
var titles = findDescendants(body, "div").filter(function (el) {
  return el.className === "ui-shortcut-section-title"
})
assert(titles.length === 5, "5 个分组标题（实际: " + titles.length + "）")
var tables = findDescendants(body, "table")
assert(tables.length === 5, "5 个分组表格（实际: " + tables.length + "）")
assert(
  tables.every(function (t) {
    return t.className === "ui-shortcut-table theme-default"
  }),
  "表格 class 为 ui-shortcut-table theme-default"
)

// 表格行结构：每行 2 个 td，快捷键格全部子元素均为 kbd
var rows = findDescendants(body, "tr")
assert(rows.length === 19, "共 19 行快捷键（实际: " + rows.length + "）")
function rowTds(row: FakeNode) {
  return row.children.filter(function (c) {
    return c.nodeType === 1 && c.tagName === "td"
  })
}
function rowKeyKbds(row: FakeNode) {
  return rowTds(row)[0].children.filter(function (c) {
    return c.nodeType === 1 && c.tagName === "kbd"
  })
}
assert(
  rows.every(function (row) {
    var tds = rowTds(row)
    return (
      tds.length === 2 &&
      tds[0].className === "ui-shortcut-key" &&
      rowKeyKbds(row).length >= 1 &&
      tds[0].children.every(function (c) {
        return c.nodeType !== 1 || c.tagName === "kbd"
      })
    )
  }),
  "每行 2 个 td，快捷键格子元素均为 kbd"
)
assert(
  rows.every(function (row) {
    return rowKeyKbds(row).every(function (k) {
      return k.children.length === 1 && k.children[0].nodeType === 3
    })
  }),
  "每个 kbd 内是纯文本"
)

// 多键拆分：组合键按 + 拆、备选按 / 拆，分隔符为 " + " / " / " 文本
var redoRow = rows.filter(function (row) {
  return rowTds(row)[0].textContent === "Shift + Meta + Z / Meta + Y"
})[0]
assert(!!redoRow && rowKeyKbds(redoRow).length === 5, "重做行拆为 5 个 kbd（Shift/Meta/Z/Meta/Y）")
var tabRows = rows.filter(function (row) {
  return rowTds(row)[0].textContent === "Tab / Shift + Tab"
})
assert(tabRows.length === 2, "Tab 行共 2 处（表格 + 列表）")
assert(
  tabRows.every(function (row) {
    return rowKeyKbds(row).length === 3
  }),
  "Tab / Shift+Tab 拆为 3 个 kbd"
)
var simpleRow = rows.filter(function (row) {
  return rowTds(row)[0].textContent === "Meta + Z"
})[0]
assert(!!simpleRow && rowKeyKbds(simpleRow).length === 2, "Meta+Z 拆为 2 个 kbd")
var literalRow = rows.filter(function (row) {
  return rowTds(row)[0].textContent === "末尾连输两个空格"
})[0]
assert(!!literalRow && rowKeyKbds(literalRow).length === 1, "无分隔符条目仍是单个 kbd")

// 文本内容：分组 + 显性快捷键
var text = body.textContent
assert(text.indexOf("基础") >= 0, "包含分组：基础")
assert(text.indexOf("段落与块") >= 0, "包含分组：段落与块")
assert(text.indexOf("表格") >= 0, "包含分组：表格")
assert(text.indexOf("列表与代码块") >= 0, "包含分组：列表与代码块")
assert(text.indexOf("预览交互") >= 0, "包含分组：预览交互")
assert(text.indexOf("Meta + Z") >= 0, "撤销 Meta+Z")
assert(text.indexOf("Meta + B") >= 0, "加粗 Meta+B")
assert(text.indexOf("Meta + E") >= 0, "切换源码 Meta+E")
assert(text.indexOf("Meta + Enter") >= 0, "跳出块 Meta+Enter")
assert(text.indexOf("Tab / Shift + Tab") >= 0, "Tab 移格与缩进")
assert(text.indexOf("Backspace") >= 0, "Backspace 删行/删表")

// 隐形功能（无对应按钮，必须收录）
assert(text.indexOf("Shift + Enter / Alt + Enter") >= 0, "软回车 Shift+Enter / Alt+Enter")
assert(text.indexOf("软回车") >= 0, "软回车描述")
assert(text.indexOf("末尾连输两个空格") >= 0, "双空格退出表格")
assert(text.indexOf("Meta + 滚轮") >= 0, "Mermaid 缩放 Meta+滚轮")
assert(text.indexOf("Esc") >= 0, "Esc 退出全屏")

if (failures > 0) {
  console.log("FAILED: " + failures + " 项未通过")
  process.exit(1)
}
console.log("ALL PASS")