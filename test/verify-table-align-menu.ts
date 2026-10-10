// 列对齐菜单端到端验证（jsdom + 真实 EditorView + 真实 NodeView）：
// 验证 table-handles.ts 列对齐菜单（列把手右侧 menu 图标按钮）交互：
// 1. 按钮渲染进首行各 cell（与列 grip 同格），带 -col-menu 类与 data-index，
//    点击弹出 4 项 dropdown（默认 / 左对齐 / 居中 / 右对齐），面板是按钮子节点
// 2. 点选对齐项：整列所有行 cell 的 align attr 更新（其他列不变），markdown
//    序列化分隔行对应列变为 :---: / ---: / ---（默认清除对齐回 ---）
// 3. 面板状态：当前列已有对齐时打开面板高亮对应项；同按钮开 ↔ 关、不同按钮
//    切换；面板外按下即关闭；pointerdown 不开拖动；面板插入不触发 PM 重读
// 运行：npx --yes tsx --import ./test/css-shim.mjs test/verify-table-align-menu.ts
// （先 npm install --no-save jsdom；跑完 npm prune 移除）

// @ts-ignore -- jsdom 为临时依赖（--no-save），无类型声明
import { JSDOM } from "jsdom"
import { EditorState } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Node as PMNode } from "prosemirror-model"
import { createTableCoordsPlugin } from "../src/prosemirror/table-handles"

// ---- jsdom 全局注入（无布局环境：本验证只走 click / pointerdown，无几何依赖）----
var dom = new JSDOM("<!DOCTYPE html><html><body><div id=\"editor\"></div></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/"
})
var win = dom.window
;(globalThis as any).window = win
;(globalThis as any).document = win.document
;(globalThis as any).MutationObserver = win.MutationObserver
;(globalThis as any).Node = win.Node
;(globalThis as any).Element = win.Element
;(globalThis as any).HTMLElement = win.HTMLElement
;(globalThis as any).Range = win.Range
;(globalThis as any).getSelection = win.getSelection.bind(win)
Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true })
;(globalThis as any).getComputedStyle = win.getComputedStyle.bind(win)
// PM 的 tr.scrollIntoView 会调用；jsdom 无布局，空实现即可
;(win.HTMLElement.prototype as any).scrollIntoView = function () {}
// PM 的 coordsAtPos 会读 getClientRects（元素 / Range 上都会调；jsdom 未实现），
// 零矩形兜底（无布局环境）
;(win as any).Element.prototype.getClientRects = function () {
  return [this.getBoundingClientRect()]
}
;(win as any).Range.prototype.getClientRects = function () {
  return []
}
;(win as any).Range.prototype.getBoundingClientRect = function () {
  return {top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0}
}
// applyHandleGeometry 见零矩形即跳过几何写入（把手定位交给 CSS）
;(win.HTMLElement.prototype as any).getBoundingClientRect = function () {
  return {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0}
}

// 模块导入须在全局注入之后（NodeView 工厂在模块级引用 document/Node 等）
var { buildSchema } = await import("../src/prosemirror/schema")
var { buildMarkdownParser, buildMarkdownSerializer, serializeNodeMarkdown } = await import("../src/prosemirror/markdown")
var { createTableHandlesNodeView, createHandleAwareCellNodeView } = await import("../src/prosemirror/table-handles")

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

var md = [
  "| H1 | H2 | H3 |",
  "| --- | --- | --- |",
  "| a1 | a2 | a3 |",
  "| b1 | b2 | b3 |",
  "| c1 | c2 | c3 |",
  "",
  "tail text"
].join("\n")

var failures = 0

function check(label: string, actual: any, expected: any) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures += 1
  }
  console.log((ok ? "PASS" : "FAIL") + " " + label + (ok ? "" : " -> expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)))
}

// 读取当前 doc 中表格的行文本矩阵（thead 行在前）
function readTableRows(doc: PMNode): string[][] {
  var rows: string[][] = []
  doc.descendants(function (node: PMNode) {
    if (node.type.name === "table_row") {
      var cells: string[] = []
      node.forEach(function (cell: PMNode) {
        cells.push(cell.textContent)
      })
      rows.push(cells)
    }
    return true
  })
  return rows
}

// 读取表格某列每行 cell 的 align attr（空串 = 无对齐）
function columnAligns(doc: PMNode, colIdx: number): string[] {
  var out: string[] = []
  doc.descendants(function (node: PMNode) {
    if (node.type.name === "table_row") {
      out.push(node.child(colIdx).attrs.align || "")
    }
    return true
  })
  return out
}

function shellEl(): HTMLElement {
  return win.document.querySelector(".md-editor-table-handles-shell") as HTMLElement
}
// 列对齐菜单按钮（渲染在首行各 th 内，data-index 即列号）
function menuBtn(col: number): HTMLElement {
  return shellEl().querySelector('.md-editor-table-handle-col-menu[data-index="' + col + '"]') as HTMLElement
}
function panelEl(): HTMLElement | null {
  return shellEl().querySelector(".md-editor-table-align-menu") as HTMLElement | null
}
// 面板内某 data-align 值的项（"" = 默认）
function alignItem(value: string): HTMLElement {
  return (panelEl() as HTMLElement).querySelector('.md-editor-table-align-item[data-align="' + value + '"]') as HTMLElement
}
// 当前面板高亮项的 data-align（无高亮返回 null）
function activeAlign(): string | null {
  var item = shellEl().querySelector(".md-editor-table-align-item-active") as HTMLElement | null
  return item ? item.getAttribute("data-align") : null
}
function clickEl(el: HTMLElement) {
  el.dispatchEvent(new win.MouseEvent("click", {bubbles: true, cancelable: true, clientX: 0, clientY: 0}))
}
function pressDoc(type: string) {
  win.document.dispatchEvent(new win.MouseEvent(type, {bubbles: true, cancelable: true, clientX: 0, clientY: 0}))
}

var view = new EditorView(win.document.getElementById("editor") as HTMLElement, {
  state: EditorState.create({doc: parser.parse(md), schema: schema, plugins: [createTableCoordsPlugin()]}),
  nodeViews: {
    table: function (node: PMNode, view: EditorView, getPos: () => number | undefined): any {
      return createTableHandlesNodeView(node, {opts: {} as any, view: view, getPos: function () { return typeof getPos() === "number" ? getPos() as number : 0 }})
    },
    // cell 级 NodeView：把手在 td/th 里的 mutation/事件拦截必须注册才会生效
    table_cell: function (node: PMNode): any {
      return createHandleAwareCellNodeView(node)
    },
    table_header: function (node: PMNode): any {
      return createHandleAwareCellNodeView(node)
    }
  } as any
})

// NodeView 工厂内的初始重建走 rAF，等一拍让把手渲染完成
await new Promise(function (resolve) { setTimeout(resolve, 50) })

// 序列表格节点的 markdown，取分隔行（第 2 行）
function tableDelimiter(): string {
  var tableNode: PMNode | null = null
  view.state.doc.descendants(function (node: PMNode) {
    if (!tableNode && node.type.name === "table") {
      tableNode = node
    }
    return true
  })
  var out = serializeNodeMarkdown(serializer, tableNode as PMNode)
  return out.split("\n")[1]
}

var initialRows = readTableRows(view.state.doc)

// ---- 1. 菜单按钮渲染 ----
check("菜单按钮数 = 3", shellEl().querySelectorAll(".md-editor-table-handle-col-menu").length, 3)
check("菜单按钮(0) 在首行首格 th 内", menuBtn(0).parentElement && (menuBtn(0).parentElement as HTMLElement).tagName, "TH")
check("菜单按钮(2) 在首行末格 th 内", menuBtn(2).parentElement && (menuBtn(2).parentElement as HTMLElement).tagName, "TH")
check("菜单按钮带 title", menuBtn(0).getAttribute("title"), "列对齐")
check("菜单按钮带图标圆片", !!menuBtn(1).querySelector(".md-editor-table-handle-icon"), true)
check("菜单按钮类不与列 grip 选择器冲突", shellEl().querySelectorAll(".md-editor-table-handle-col").length, 3)
check("行 grip 不受影响", shellEl().querySelectorAll(".md-editor-table-handle-row").length, 4)
var colGrip1 = shellEl().querySelector('.md-editor-table-handle-col[data-index="1"]') as HTMLElement
check("按钮(1) 与列 grip(1) 同格", menuBtn(1).parentElement === colGrip1.parentElement, true)

// ---- 2. 点击菜单按钮弹出面板（第 2 列 H2）----
clickEl(menuBtn(1))
var panel2 = panelEl()
check("点击后面板出现", !!panel2, true)
check("面板是按钮(1) 的子节点", !!panel2 && panel2.parentElement === menuBtn(1), true)
check("面板 data-col = 1", panel2 && panel2.getAttribute("data-col"), "1")
check("按钮(1) 带 -open 类", menuBtn(1).classList.contains("md-editor-table-handle-col-menu-open"), true)
var items = shellEl().querySelectorAll(".md-editor-table-align-item")
check("面板 4 个选项", items.length, 4)
var labels: string[] = []
var values: string[] = []
for (var ii = 0; ii < items.length; ii += 1) {
  labels.push((items[ii].querySelector(".md-editor-table-align-item-label") as HTMLElement).textContent || "")
  values.push(items[ii].getAttribute("data-align") || "")
}
check("选项文案顺序", labels, ["默认", "左对齐", "居中", "右对齐"])
check("选项 data-align 顺序", values, ["", "left", "center", "right"])
check("初始无对齐时高亮默认项", activeAlign(), "")
// 等一拍让 MutationObserver 跑完：面板插入的 childList mutation 必须被
// ignoreMutation 识别忽略，否则 PM 重读会把菜单项当单元格内容破坏表格
await new Promise(function (resolve) { setTimeout(resolve, 10) })
check("面板插入后 PM 不重读（内容不变）", readTableRows(view.state.doc), initialRows)
check("面板打开后 grip 存活", shellEl().querySelectorAll(".md-editor-table-handle-col").length + shellEl().querySelectorAll(".md-editor-table-handle-row").length, 7)

// ---- 3. 点选「居中」：整列对齐 + 分隔行序列化 ----
clickEl(alignItem("center"))
check("选后面板关闭", !!panelEl(), false)
check("按钮 -open 类移除", menuBtn(1).classList.contains("md-editor-table-handle-col-menu-open"), false)
check("第 2 列整列居中", columnAligns(view.state.doc, 1), ["center", "center", "center", "center"])
check("第 1 列不受影响", columnAligns(view.state.doc, 0), ["", "", "", ""])
check("第 3 列不受影响", columnAligns(view.state.doc, 2), ["", "", "", ""])
check("分隔行序列化 :---:", tableDelimiter(), "| --- | :---: | --- |")
var fullOut = serializer.serialize(view.state.doc)
check("序列化再解析保持对齐", columnAligns(parser.parse(fullOut), 1), ["center", "center", "center", "center"])
check("对齐变更后菜单按钮存活", shellEl().querySelectorAll(".md-editor-table-handle-col-menu").length, 3)
check("对齐变更后内容不变", readTableRows(view.state.doc), initialRows)

// ---- 4. 重新打开：已有对齐时高亮对应项 ----
clickEl(menuBtn(1))
check("重新打开面板", !!panelEl(), true)
check("已有对齐时高亮居中项", activeAlign(), "center")

// ---- 5. 不同按钮切换（第 2 列面板开着时点第 1 列按钮）----
clickEl(menuBtn(0))
check("切换后全表仅一个面板", shellEl().querySelectorAll(".md-editor-table-align-menu").length, 1)
var switchPanel = panelEl()
check("面板切到第 1 列", switchPanel && switchPanel.getAttribute("data-col"), "0")
check("按钮(1) 的 -open 已切走", menuBtn(1).classList.contains("md-editor-table-handle-col-menu-open"), false)
check("按钮(0) 带 -open 类", menuBtn(0).classList.contains("md-editor-table-handle-col-menu-open"), true)

// ---- 6. 同一按钮再点 = 关闭 ----
clickEl(menuBtn(0))
check("同按钮再点后面板关闭", !!panelEl(), false)

// ---- 7. 右对齐 → 默认（清除对齐）----
clickEl(menuBtn(0))
clickEl(alignItem("right"))
check("第 1 列整列右对齐", columnAligns(view.state.doc, 0), ["right", "right", "right", "right"])
check("分隔行序列化 ---:", tableDelimiter(), "| ---: | :---: | --- |")
clickEl(menuBtn(0))
check("右对齐项高亮", activeAlign(), "right")
clickEl(alignItem(""))
check("默认清除第 1 列对齐", columnAligns(view.state.doc, 0), ["", "", "", ""])
check("分隔行回 ---", tableDelimiter(), "| --- | :---: | --- |")

// ---- 8. 面板外按下即关闭（document 级监听）----
clickEl(menuBtn(2))
var p8 = panelEl()
check("第 3 列面板打开", !!p8 && p8.getAttribute("data-col") === "2", true)
pressDoc("pointerdown")
check("面板外按下后关闭", !!panelEl(), false)
check("关闭后无 -open 残留", shellEl().querySelectorAll(".md-editor-table-handle-col-menu-open").length, 0)

// ---- 9. 菜单按钮 pointerdown 不开拖动 ----
var rowsBeforePress = readTableRows(view.state.doc)
menuBtn(1).dispatchEvent(new win.MouseEvent("pointerdown", {bubbles: true, cancelable: true, clientX: 0, clientY: 0}))
check("按下不进入拖动激活态", shellEl().querySelectorAll(".md-editor-table-handle-active").length, 0)
pressDoc("pointermove")
pressDoc("pointerup")
check("拖动尝试后表格结构不变", readTableRows(view.state.doc), rowsBeforePress)

// ---- 10. 全部交互后把手与内容完整 ----
check("最终表格内容不变", readTableRows(view.state.doc), initialRows)
check("最终菜单按钮数 = 3", shellEl().querySelectorAll(".md-editor-table-handle-col-menu").length, 3)
check("最终列 grip 数 = 3", shellEl().querySelectorAll(".md-editor-table-handle-col").length, 3)
check("最终行 grip 数 = 4", shellEl().querySelectorAll(".md-editor-table-handle-row").length, 4)
check("最终无面板残留", shellEl().querySelectorAll(".md-editor-table-align-menu").length, 0)

view.destroy()

if (failures > 0) {
  console.log("TABLE_ALIGN_MENU_TESTS_FAILED: " + failures + " failures")
  throw new Error("TABLE_ALIGN_MENU_TESTS_FAILED")
} else {
  console.log("TABLE_ALIGN_MENU_TESTS_PASSED")
}