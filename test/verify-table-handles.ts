// 表格行列把手端到端验证（jsdom + 真实 EditorView + 真实 NodeView）：
// 复刻浏览器事件链（dispatchEvent 冒泡到 overlay/document 监听），
// 验证 table-handles.ts 的交互：
// 1. NodeView 包壳渲染：shell > table + overlay；行列 grip 渲染在 td/th 里
//    （列 grip=首行各格、行 grip=各行首格，CSS 负偏移到表格外侧），+ 按钮留在 overlay
// 2. 光标驱动显隐：tableCoords 装饰插件按选区给光标所在行 tr / 所在列各 th/td
//    写 md-editor-table-active-row / -col 装饰类（CSS 据此显现把手），
//    光标移出表格后类清空；装饰类更新不重建 cell DOM（grip 存活）
// 3. 拖动行 grip：拖动中实时位置反馈——被拖动行单元格内联 transform 平移跟随、
//    被跨越行整行让位、不提交文档变更、PM 不因直写 style 重读重绘；松手行移动到末尾
// 4. 拖动列 grip：同上（列平移跟随、被跨越列让位、被拖动列各格全程带 drop-target 类），
//    列移动到最右；三 slot 中点法边界（未过相邻边界中点不换列、越过即换）
// 5. 单击 grip（未拖出阈值）：不改表格结构，光标补偿落到对应单元格
// 6. 单击末尾 + 按钮：追加一行 / 一列；+ 按钮 pointerdown 不开启拖动
// 运行：npx --yes tsx --import ./test/css-shim.mjs test/verify-table-handles.ts
// （先 npm install --no-save jsdom；跑完可 npm install --no-save 移除）

// @ts-ignore -- jsdom 为临时依赖（--no-save），无类型声明
import { JSDOM } from "jsdom"
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Node as PMNode } from "prosemirror-model"
import { createTableCoordsPlugin } from "../src/prosemirror/table-handles"

// ---- jsdom 全局注入（无布局环境：拖动落点与实时平移需要几何，后续用
// getBoundingClientRect 原型桩构造确定矩形）----
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
// PM 的 scrollToSelection → coordsAtPos → singleRect 会读 getClientRects
// （元素 / Range 上都会调；jsdom 都未实现）。零矩形兜底（无布局环境）：
// Range 上返回空列表 → PM 回退到 getBoundingClientRect → 再兜零矩形
;(win as any).Element.prototype.getClientRects = function () {
  return [this.getBoundingClientRect()]
}
;(win as any).Range.prototype.getClientRects = function () {
  return []
}
;(win as any).Range.prototype.getBoundingClientRect = function () {
  return {top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0}
}

// 模块导入须在全局注入之后（NodeView 工厂在模块级引用 document/Node 等）
var { buildSchema } = await import("../src/prosemirror/schema")
var { buildMarkdownParser } = await import("../src/prosemirror/markdown")
var { createTableHandlesNodeView, createHandleAwareCellNodeView } = await import("../src/prosemirror/table-handles")
var { buildPlugins } = await import("../src/prosemirror/plugins")
var { guardTableCellDeletion } = await import("../src/prosemirror/table")

var schema = buildSchema()
var parser = buildMarkdownParser(schema)

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

// jsdom 无 PointerEvent，用 MouseEvent 携带 pointer* 事件类型（只读 clientX/clientY/target）
function pointerEvent(type: string, opts: {x: number, y: number, bubbles?: boolean}) {
  return new win.MouseEvent(type, {bubbles: opts.bubbles !== false, cancelable: true, clientX: opts.x, clientY: opts.y})
}

function dragHandle(el: HTMLElement, from: {x: number, y: number}, to: {x: number, y: number}) {
  el.dispatchEvent(pointerEvent("pointerdown", {x: from.x, y: from.y}))
  win.document.dispatchEvent(pointerEvent("pointermove", {x: to.x, y: to.y}))
  win.document.dispatchEvent(pointerEvent("pointerup", {x: to.x, y: to.y}))
}

function clickEl(el: HTMLElement, pos: {x: number, y: number}) {
  el.dispatchEvent(new win.MouseEvent("click", {bubbles: true, cancelable: true, clientX: pos.x, clientY: pos.y}))
}

var view = new EditorView(win.document.getElementById("editor") as HTMLElement, {
  state: EditorState.create({doc: parser.parse(md), schema: schema, plugins: [createTableCoordsPlugin()]}),
  nodeViews: {
    table: function (node: PMNode, view: EditorView, getPos: () => number | undefined): any {
      return createTableHandlesNodeView(node, {opts: {} as any, view: view, getPos: function () { return typeof getPos() === "number" ? getPos() as number : 0 }})
    },
    // cell 级 NodeView：grip 在 td/th 里的 mutation/事件拦截必须注册才会生效
    table_cell: function (node: PMNode): any {
      return createHandleAwareCellNodeView(node)
    },
    table_header: function (node: PMNode): any {
      return createHandleAwareCellNodeView(node)
    }
  } as any
})

// ---- 布局矩形桩：拖动落点（三 slot 中点推进）与实时平移反馈需要非零几何，
// jsdom 无布局，构造确定矩形——每列宽 100px（第 c 列 left=c*100）、每行高
// 40px（第 r 行 top=r*40），表宽 = 列数×100、表高 = 行数×40。td/th 按 DOM
// 行列索引定位；其余元素保持零矩形 ----
var CELL_W = 100
var ROW_H = 40
;(win.HTMLElement.prototype as any).getBoundingClientRect = function () {
  var el = this as HTMLElement
  var tag = el.tagName
  var zero = {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0}
  if (tag === "TD" || tag === "TH") {
    var tr = el.parentElement
    var section = tr ? tr.parentElement : null
    var tableEl = section ? section.parentElement : null
    if (tr && tableEl && tableEl.tagName === "TABLE") {
      var col = Array.prototype.indexOf.call(tr.children, el)
      var row = Array.prototype.indexOf.call(tableEl.querySelectorAll("tr"), tr)
      if (col >= 0 && row >= 0) {
        return {left: col * CELL_W, right: (col + 1) * CELL_W, top: row * ROW_H, bottom: (row + 1) * ROW_H, width: CELL_W, height: ROW_H}
      }
    }
    return zero
  }
  if (tag === "TR") {
    var tEl = el.parentElement ? el.parentElement.parentElement : null
    if (tEl && tEl.tagName === "TABLE") {
      var rIdx = Array.prototype.indexOf.call(tEl.querySelectorAll("tr"), el)
      if (rIdx >= 0) {
        var rCols = el.children.length
        return {left: 0, right: rCols * CELL_W, top: rIdx * ROW_H, bottom: (rIdx + 1) * ROW_H, width: rCols * CELL_W, height: ROW_H}
      }
    }
    return zero
  }
  if (tag === "TABLE") {
    var rows = el.querySelectorAll("tr")
    var cols = rows.length > 0 ? rows[0].children.length : 0
    return {left: 0, top: 0, right: cols * CELL_W, bottom: rows.length * ROW_H, width: cols * CELL_W, height: rows.length * ROW_H}
  }
  return zero
}

function shellEl(): HTMLElement {
  return win.document.querySelector(".md-editor-table-handles-shell") as HTMLElement
}
function overlayEl(): HTMLElement {
  return win.document.querySelector(".md-editor-table-handles") as HTMLElement
}
function grip(kind: "row" | "col", index: number): HTMLElement {
  // grip 渲染在 td/th 里（shell 子树），+ 按钮在 overlay 上
  return shellEl().querySelector(".md-editor-table-handle-" + kind + "[data-index=\"" + index + "\"]") as HTMLElement
}
// 按行列索引取单元格（tr 的 children 就是 td/th，grip 是 td 的子元素不占其位）
function cellAt(rowIdx: number, colIdx: number): HTMLElement {
  var tr = shellEl().querySelectorAll("tr")[rowIdx] as HTMLElement
  return tr.children[colIdx] as HTMLElement
}
// 拖动实时反馈的内联样式是否全清空（拖动只写 transform，提层/底色走 CSS 类，
// 但仍按四项全查以防回退到内联写法）
function allDragStylesCleared(): boolean {
  var trs = shellEl().querySelectorAll("tr")
  for (var ri = 0; ri < trs.length; ri += 1) {
    var cells = trs[ri].children
    for (var ci = 0; ci < cells.length; ci += 1) {
      var st = (cells[ci] as HTMLElement).style
      if (st.transform !== "" || st.transition !== "" || st.zIndex !== "" || st.backgroundColor !== "") {
        return false
      }
    }
  }
  return true
}
// NodeView 工厂内的初始重建走 rAF（工厂执行时 contentDOM 还没挂内容），
// 等一拍让 jsdom 的 rAF（pretendToBeVisual 用 ~16ms timer 驱动）跑完
await new Promise(function (resolve) { setTimeout(resolve, 50) })

// ---- 1. 包壳结构 ----
var shell = win.document.querySelector(".md-editor-table-handles-shell")
check("shell 渲染", !!shell, true)
check("shell 内含 table", !!(shell && (shell as HTMLElement).querySelector("table")), true)
check("overlay 渲染", !!overlayEl(), true)
check("overlay 不可编辑", overlayEl().getAttribute("contenteditable"), "false")
check("行 grip 数 = 4（head+3 body）", shellEl().querySelectorAll(".md-editor-table-handle-row").length, 4)
check("列 grip 数 = 3", shellEl().querySelectorAll(".md-editor-table-handle-col").length, 3)
check("追加行按钮存在", !!overlayEl().querySelector(".md-editor-table-append-row"), true)
check("追加列按钮存在", !!overlayEl().querySelector(".md-editor-table-append-col"), true)
// grip 真渲染进 td/th：列 grip 挂首行各 th/td、行 grip 挂各行首列 td
check("thead 带 table-head 类", !!shellEl().querySelector("thead.table-head"), true)
check("tbody 带 table-body 类", !!shellEl().querySelector("tbody.table-body"), true)
check("tr 带 table-row 类", shellEl().querySelectorAll("tr.table-row").length > 0, true)
var stampedTrs = shellEl().querySelectorAll("tr[data-row]")
check("每行都有 data-row", stampedTrs.length, 4)
var rowAttrOk = true
for (var ri = 0; ri < stampedTrs.length; ri += 1) {
  if (stampedTrs[ri].getAttribute("data-row") !== String(ri)) {
    rowAttrOk = false
  }
}
check("data-row 从 0 递增", rowAttrOk, true)
var stampedCells = stampedTrs[1].querySelectorAll("td[data-col], th[data-col]")
check("body 行每格都有 data-col", stampedCells.length, 3)
var colAttrOk = true
for (var ci = 0; ci < stampedCells.length; ci += 1) {
  if (stampedCells[ci].getAttribute("data-col") !== String(ci)) {
    colAttrOk = false
  }
}
check("data-col 从 0 递增", colAttrOk, true)
check("列 grip(0) 在首行首格 th 内", grip("col", 0).parentElement && (grip("col", 0).parentElement as HTMLElement).tagName, "TH")
check("th 也带 table-cell 类", grip("col", 0).parentElement && (grip("col", 0).parentElement as HTMLElement).classList.contains("table-cell"), true)
check("body 首格 td 带 table-cell 类", grip("row", 1).parentElement && (grip("row", 1).parentElement as HTMLElement).classList.contains("table-cell"), true)
check("列 grip(2) 在首行末格 th 内", grip("col", 2).parentElement && (grip("col", 2).parentElement as HTMLElement).tagName, "TH")
check("行 grip(0) 在表头行首格 th 内", grip("row", 0).parentElement && (grip("row", 0).parentElement as HTMLElement).tagName, "TH")
check("行 grip(1) 在 body 行首格 td 内", grip("row", 1).parentElement && (grip("row", 1).parentElement as HTMLElement).tagName, "TD")
var allTrs = shellEl().querySelectorAll("tr")
check("行 grip(1) 挂在对应行上", grip("row", 1).parentElement && (grip("row", 1).parentElement as HTMLElement).parentElement === allTrs[1], true)
check("行 grip(2) 挂在对应行上", grip("row", 2).parentElement && (grip("row", 2).parentElement as HTMLElement).parentElement === allTrs[2], true)
// overlay 上只剩 + 追加条（grip 已全部移入 td/th）
check("overlay 只余 2 个追加条", overlayEl().querySelectorAll(".md-editor-table-handle").length, 2)

var initialRows = [
  ["H1", "H2", "H3"],
  ["a1", "a2", "a3"],
  ["b1", "b2", "b3"],
  ["c1", "c2", "c3"]
]
check("初始表格内容", readTableRows(view.state.doc), initialRows)

// ---- 2. 光标驱动的把手显现（tableCoords 装饰类）----
// 光标落 a2（thead 行后第 1 行、行内第 2 列）：所在行 tr 与所在列各 th/td 获得 active 类
var a2Pos = -1
view.state.doc.descendants(function (node: PMNode, pos: number) {
  if (node.type.name === "table_cell" && node.textContent === "a2") {
    a2Pos = pos
  }
  return true
})
check("找到 a2 单元格", a2Pos >= 0, true)
view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, a2Pos + 1)))
var activeRowTr = shellEl().querySelector("tr[data-row=\"1\"]") as HTMLElement
check("光标所在行 tr 有 active-row 类", activeRowTr.classList.contains("md-editor-table-active-row"), true)
check("active 行仅一个", shellEl().querySelectorAll("tr.md-editor-table-active-row").length, 1)
var activeColCells = shellEl().querySelectorAll(".table-cell.md-editor-table-active-col")
check("active 列格数 = 4（每行一格）", activeColCells.length, 4)
var activeColOk = true
for (var ai = 0; ai < activeColCells.length; ai += 1) {
  if ((activeColCells[ai] as HTMLElement).getAttribute("data-col") !== "1") {
    activeColOk = false
  }
}
check("active 列格都在第 2 列（data-col=1）", activeColOk, true)
// 装饰类更新必须走 cell NodeView 原地补丁（updateOuterDeco），不重建 cell DOM：
// 否则渲染进 td/th 的 grip 会被清掉
check("装饰更新后行 grip 仍 = 4", shellEl().querySelectorAll(".md-editor-table-handle-row").length, 4)
check("装饰更新后列 grip 仍 = 3", shellEl().querySelectorAll(".md-editor-table-handle-col").length, 3)
// 光标移出表格（尾部段落）：active 类清空 → 把手全部隐藏
// （content.size - 1 = 尾段落内末位——直接用 content.size 会落在 doc 层报错）
view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)))
check("光标移出表后 active 行清空", shellEl().querySelectorAll("tr.md-editor-table-active-row").length, 0)
check("光标移出表后 active 列清空", shellEl().querySelectorAll(".table-cell.md-editor-table-active-col").length, 0)
check("移出表后 grip 仍 = 4 + 3", shellEl().querySelectorAll(".md-editor-table-handle-row").length + shellEl().querySelectorAll(".md-editor-table-handle-col").length, 7)

// ---- 3. 拖动行 grip：body 首行 a 移到表尾（dy=70：行高 40、中心 60+70=130，
// 连续越过 mid(1,2)=80 与 mid(2,3)=120 两道边界中点 → 连续跨越到末行）----
var rowsBeforeDrag = readTableRows(view.state.doc)
grip("row", 1).dispatchEvent(pointerEvent("pointerdown", {x: 0, y: 0}))
// 按下（grip 得 handle-active）即高亮被抓的行（高亮挂 fromIndex=1 的行，全程不切换）
check("按下即高亮被抓行", cellAt(1, 0).classList.contains("md-editor-table-drop-target"), true)
check("按下时其他行不高亮", cellAt(2, 0).classList.contains("md-editor-table-drop-target"), false)
win.document.dispatchEvent(pointerEvent("pointermove", {x: 0, y: 70}))
// 拖动中实时反馈：a 行单元格平移跟随指针（钳制内）、被跨越的 b/c 行整行让位、
// H 行不动；不提交文档变更
check("拖动中不提交文档变更", readTableRows(view.state.doc), rowsBeforeDrag)
check("拖动中 a 行单元格平移跟随", cellAt(1, 0).style.transform.indexOf("70px") >= 0, true)
  // 提层与防穿透底色已纯 CSS 化（shell -dragging + 单元格 drop-target 类按
  // td/th 分流：td 用 --table-drag-cell-bg、th 保表头灰底），不再写内联——
  // 断言内联为空证明未回退到 JS 内联样式一刀切
  check("拖动中提层不写内联（CSS 驱动）", cellAt(1, 1).style.zIndex, "")
check("拖动中底色不写内联（CSS 驱动）", cellAt(1, 2).style.backgroundColor, "")
check("拖动中 b 行整行让位", cellAt(2, 0).style.transform.indexOf("-40px") >= 0, true)
check("拖动中 c 行整行让位", cellAt(3, 2).style.transform.indexOf("-40px") >= 0, true)
// 高亮全程挂被拖动的 a 行（fromIndex=1），不随落点切换——拖到末位后仍亮 a 行，
// 落点行 c 与让位行 b 都不带；高亮是单元格 :after 伪元素（jsdom 不渲染伪元素样式，断言类名）
check("拖动中高亮始终在 a 行", cellAt(1, 0).classList.contains("md-editor-table-drop-target"), true)
check("拖动中高亮不切到落点行 c", cellAt(3, 0).classList.contains("md-editor-table-drop-target"), false)
check("拖动中 b 行不带 drop-target", cellAt(2, 0).classList.contains("md-editor-table-drop-target"), false)
check("拖动中 drop-target 总数 = a 行格数", shellEl().querySelectorAll(".md-editor-table-drop-target").length, 3)
check("拖动中 H 行不动", cellAt(0, 1).style.transform, "")
// 等一拍让 jsdom 的 MutationObserver 跑完：直写 td 的 style mutation 必须被
// cell NodeView 忽略，否则 PM 重读重绘会破坏 doc / 清掉 grip
await new Promise(function (resolve) { setTimeout(resolve, 10) })
check("拖动中 PM 不因直写 style 重读", readTableRows(view.state.doc), rowsBeforeDrag)
check("等待后行 grip 仍存活", shellEl().querySelectorAll(".md-editor-table-handle-row").length, 4)
win.document.dispatchEvent(pointerEvent("pointerup", {x: 0, y: 70}))
check("拖动行 1 → 末尾", readTableRows(view.state.doc), [
  ["H1", "H2", "H3"],
  ["b1", "b2", "b3"],
  ["c1", "c2", "c3"],
  ["a1", "a2", "a3"]
])
check("松手后拖动内联样式全清空", allDragStylesCleared(), true)

// ---- 4. 单击 grip（位移未越 4px 阈值）：不改结构，光标落到 grip 对应单元格 ----
// 行移动后 PM 重建 cell DOM（grip 随旧 td 销毁），NodeView.update 的重建走 rAF，
// 等一拍再查 grip
var tick = function () { return new Promise(function (resolve) { setTimeout(resolve, 50) }) }
await tick()
var rowsBeforeClick = readTableRows(view.state.doc)
dragHandle(grip("row", 1), {x: 100, y: 100}, {x: 101, y: 102})
check("单击行 grip 不改结构", readTableRows(view.state.doc), rowsBeforeClick)
// 单击保留高亮（点击选中）：行 grip(1) 所在的 b 行各格带 drop-target 类、
// shell 带 -highlight-row 方向类；拖拽态类已移除
check("单击后高亮保留在 b 行", cellAt(1, 0).classList.contains("md-editor-table-drop-target"), true)
check("单击后 H 行不带高亮", cellAt(0, 0).classList.contains("md-editor-table-drop-target"), false)
check("单击后 drop-target 总数 = b 行格数", shellEl().querySelectorAll(".md-editor-table-drop-target").length, 3)
check("单击后 shell 带 -highlight-row", shellEl().className.indexOf("md-editor-table-handles-highlight-row") >= 0, true)
check("拖拽态类已移除", (shell as HTMLElement).className.indexOf("dragging") < 0, true)
// 单击选中态：被点击的行 grip(1) 自身写 -selected 类（保持 hover 同款背景）
check("单击后行 grip 带 -selected", grip("row", 1).classList.contains("md-editor-table-handle-selected"), true)
// 单击补偿：行 grip(1) 现对应 b1 行（组 2 已把 a1 行移到表尾），光标应落进 b1 单元格
var b1Cell: {pos: number, size: number} | null = null
view.state.doc.descendants(function (node: PMNode, pos: number) {
  if (node.type.name === "table_cell" && node.textContent === "b1") {
    b1Cell = {pos: pos, size: node.nodeSize}
  }
  return true
})
var selPos = view.state.selection.$from.pos
check("单击行 grip 光标落 b1 单元格", !!b1Cell && selPos > (b1Cell as any).pos && selPos < (b1Cell as any).pos + (b1Cell as any).size, true)
// 单击列 grip(2)（H3 列）：光标落到首行 H3 单元格
dragHandle(grip("col", 2), {x: 50, y: 100}, {x: 51, y: 101})
var h3Cell: {pos: number, size: number} | null = null
view.state.doc.descendants(function (node: PMNode, pos: number) {
  if (node.type.name === "table_header" && node.textContent === "H3") {
    h3Cell = {pos: pos, size: node.nodeSize}
  }
  return true
})
selPos = view.state.selection.$from.pos
check("单击列 grip 光标落 H3 表头", !!h3Cell && selPos > (h3Cell as any).pos && selPos < (h3Cell as any).pos + (h3Cell as any).size, true)
check("单击列 grip 不改结构", readTableRows(view.state.doc), rowsBeforeClick)
// 单击列 grip(2) 后高亮切到 H3 列并保留：各行第 2 列格带类、b 行高亮已切走、
// shell 方向类切到 -highlight-col
check("单击列后高亮保留在 H3 列", cellAt(0, 2).classList.contains("md-editor-table-drop-target"), true)
check("单击列后末行 H3 列带高亮", cellAt(3, 2).classList.contains("md-editor-table-drop-target"), true)
check("单击列后 b 行高亮已切走", cellAt(1, 0).classList.contains("md-editor-table-drop-target"), false)
check("单击列后 shell 带 -highlight-col", shellEl().className.indexOf("md-editor-table-handles-highlight-col") >= 0, true)
// 切换选中：列 grip(2) 带 -selected，行 grip(1) 的 selected 已切走
check("单击列后列 grip 带 -selected", grip("col", 2).classList.contains("md-editor-table-handle-selected"), true)
check("单击列后行 grip 的 -selected 已切走", grip("row", 1).classList.contains("md-editor-table-handle-selected"), false)
// 按下非把手位置（表格外的 document）清除单击保留的高亮与方向类
win.document.dispatchEvent(pointerEvent("pointerdown", {x: 0, y: 0}))
check("表外按下后高亮清除", shellEl().querySelectorAll(".md-editor-table-drop-target").length, 0)
check("表外按下后 -highlight 类清除", shellEl().className.indexOf("highlight") < 0, true)
check("表外按下后 -selected 清除", shellEl().querySelectorAll(".md-editor-table-handle-selected").length, 0)
// 图标圆片：grip 内层 span（保证把手在任意单元格背景上可见）
check("grip 图标圆片结构", !!(grip("col", 0).querySelector(".md-editor-table-handle-icon") as HTMLElement), true)
check("行 grip 图标圆片结构", !!(grip("row", 0).querySelector(".md-editor-table-handle-icon") as HTMLElement), true)

// ---- 5. 拖动列 grip：首列移到最右（dx=160：列宽 100、中心 50+160=210，
// 连续越过 mid(0,1)=100 与 mid(1,2)=200 两道边界中点 → 连续跨越到末列）----
// 拖动中只显同类把手：pointerdown 列 grip → shell 带 -dragging-col、不带 -dragging-row
grip("col", 0).dispatchEvent(pointerEvent("pointerdown", {x: 0, y: 0}))
check("拖列时 shell 带 -dragging-col", shellEl().className.indexOf("md-editor-table-handles-dragging-col") >= 0, true)
check("拖列时 shell 不带 -dragging-row", shellEl().className.indexOf("md-editor-table-handles-dragging-row") < 0, true)
// 按下即高亮被抓的列（高亮挂 fromIndex=0 的列，全程不切换）
check("按下即高亮被抓列", cellAt(0, 0).classList.contains("md-editor-table-drop-target"), true)
win.document.dispatchEvent(pointerEvent("pointermove", {x: 160, y: 0}))
// 拖动中实时反馈：首列单元格平移跟随指针（钳制内）、被跨越的二/三列整体让位、
// 不提交文档变更
check("拖列中不提交文档变更", readTableRows(view.state.doc), rowsBeforeClick)
check("拖列中首列单元格平移跟随", cellAt(0, 0).style.transform.indexOf("160px") >= 0, true)
check("拖列中末行首列单元格平移跟随", cellAt(3, 0).style.transform.indexOf("160px") >= 0, true)
check("拖列中二列让位", cellAt(0, 1).style.transform.indexOf("-100px") >= 0, true)
check("拖列中三列让位", cellAt(1, 2).style.transform.indexOf("-100px") >= 0, true)
// 高亮全程挂被拖动的首列（fromIndex=0）的各格，不随落点切换——拖到末列后
// 仍亮首列，落点末列与让位列都不带；高亮是单元格 :after 伪元素（jsdom 不渲染伪元素样式，断言类名）
check("拖列中高亮始终在首列表头", cellAt(0, 0).classList.contains("md-editor-table-drop-target"), true)
check("拖列中高亮始终在首列末行", cellAt(3, 0).classList.contains("md-editor-table-drop-target"), true)
check("拖列中让位列不带 drop-target", cellAt(0, 1).classList.contains("md-editor-table-drop-target"), false)
check("拖列中高亮不切到落点末列", cellAt(0, 2).classList.contains("md-editor-table-drop-target"), false)
check("拖列中 drop-target 总数 = 行数", shellEl().querySelectorAll(".md-editor-table-drop-target").length, 4)
// 等一拍让 jsdom 的 MutationObserver 跑完：直写 td/th 的 style mutation 必须被
// cell NodeView 忽略，否则 PM 重读重绘会破坏 doc / 清掉 grip
await new Promise(function (resolve) { setTimeout(resolve, 10) })
check("拖列中 PM 不因直写 style 重读", readTableRows(view.state.doc), rowsBeforeClick)
check("等待后列 grip 仍存活", shellEl().querySelectorAll(".md-editor-table-handle-col").length, 3)
win.document.dispatchEvent(pointerEvent("pointerup", {x: 160, y: 0}))
check("拖列结束后无 -active 残留", shellEl().querySelectorAll(".md-editor-table-handle-active").length, 0)
check("拖列结束后无 -selected 残留", shellEl().querySelectorAll(".md-editor-table-handle-selected").length, 0)
check("拖列结束后无 drop-target 残留", shellEl().querySelectorAll(".md-editor-table-drop-target").length, 0)
check("拖列结束后无 -highlight 残留", shellEl().className.indexOf("highlight") < 0, true)
check("拖动列 0 → 最右", readTableRows(view.state.doc), [
  ["H2", "H3", "H1"],
  ["b2", "b3", "b1"],
  ["c2", "c3", "c1"],
  ["a2", "a3", "a1"]
])

// ---- 6. 单击 + 按钮追加一行 ----
clickEl(overlayEl().querySelector(".md-editor-table-append-row") as HTMLElement, {x: 10, y: 10})
await tick()
check("追加一行后行数 = 5", readTableRows(view.state.doc).length, 5)
check("新行在表尾且为空行", readTableRows(view.state.doc)[4], ["", "", ""])
check("NodeView 重建行 grip 数 = 5", shellEl().querySelectorAll(".md-editor-table-handle-row").length, 5)

// ---- 7. + 按钮 pointerdown 不开拖动（拖拽后不应移动行）----
dragHandle(overlayEl().querySelector(".md-editor-table-append-row") as HTMLElement, {x: 0, y: 0}, {x: 0, y: 40})
check("拖动追加行按钮无移动", readTableRows(view.state.doc).length, 5)

// ---- 8. 单击 + 按钮追加一列 ----
clickEl(overlayEl().querySelector(".md-editor-table-append-col") as HTMLElement, {x: 10, y: 10})
await tick()
check("追加一列后每行 4 列", readTableRows(view.state.doc).map(function (r) { return r.length }), [4, 4, 4, 4, 4])
check("新列在最右且为空", readTableRows(view.state.doc)[0][3], "")
check("NodeView 重建列 grip 数 = 4", shellEl().querySelectorAll(".md-editor-table-handle-col").length, 4)
// 结构变化后 grip 仍在新结构的 td/th 里
check("重建后行 grip(1) 仍在 td 内", grip("row", 1).parentElement && (grip("row", 1).parentElement as HTMLElement).tagName, "TD")

// ---- 9. 结构变化后再拖动行（把手索引对新结构生效）----
// 5 行结构：dy=90 → 中心 60+90=150，越过 mid(2,3)=120 落在 mid(3,4)=160 前
// → b 行移到 a 行后（索引 3），空行仍在表尾
dragHandle(grip("row", 1), {x: 0, y: 0}, {x: 0, y: 90})
var afterRedrag = readTableRows(view.state.doc)
check("重建后拖动仍可移动行", afterRedrag.length, 5)
check("重建后移动结果（b 行到表尾）", afterRedrag.slice(0, 3), [
  ["H2", "H3", "H1", ""],
  ["c2", "c3", "c1", ""],
  ["a2", "a3", "a1", ""]
])

view.destroy()

// ---- 10. 单元格删除守卫：Backspace / Delete 任何情况下不得删掉单个 cell 或
// 合并相邻 cell（keymap 单测：fake view 依序喂给各插件的 handleKeyDown）----
// 表格 3 列 4 行：行 0=表头 H、行 1=a、行 2=b、行 3=c（见 md）
var keyDownHandlers: Array<(view: any, event: any) => boolean> = []
var guardPlugins = buildPlugins(schema)
for (var gi = 0; gi < guardPlugins.length; gi += 1) {
  var guardProps = (guardPlugins[gi] as any).props
  if (guardProps && typeof guardProps.handleKeyDown === "function") {
    keyDownHandlers.push(guardProps.handleKeyDown)
  }
}
// 依序调用各插件 handleKeyDown（含自定义 keymap + baseKeymap），直到某个插件处理
function pressKey(state: EditorState, keyName: string) {
  var applied = state
  var fakeView: any = {
    state: state,
    // jsdom 无布局，按光标的文档位置判断可视边界（真实视图由几何决定）：
    // backward=光标在块内容开头、forward=在末尾
    endOfTextblock: function (dir: string, st: any) {
      var $cursor = st.selection.$cursor
      if (!$cursor) {
        return false
      }
      return dir === "backward" ? $cursor.parentOffset === 0 : $cursor.parentOffset === $cursor.parent.content.size
    },
    dispatch: function (tr: any) { applied = applied.apply(tr) },
    focus: function () {}
  }
  var handled = false
  for (var ki = 0; ki < keyDownHandlers.length && !handled; ki += 1) {
    handled = keyDownHandlers[ki](fakeView, {key: keyName, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false})
  }
  return { handled: handled, state: applied }
}
// 收集 md 文档的平铺 cell（行主序，3 列），返回第 rowIdx 行 colIdx 列 cell 内容位置
function guardDoc() {
  return parser.parse(md)
}
function guardCellFlat(doc: PMNode) {
  var flat: Array<{pos: number, size: number}> = []
  doc.descendants(function (node: PMNode, pos: number) {
    if (node.type.name === "table_cell" || node.type.name === "table_header") {
      flat.push({pos: pos, size: node.content.size})
    }
    return true
  })
  return flat
}
function guardStateAt(rowIdx: number, colIdx: number, offset: number) {
  var doc = guardDoc()
  var cell = guardCellFlat(doc)[rowIdx * 3 + colIdx]
  var pos = cell.pos + 1 + offset
  return EditorState.create({doc: doc, schema: schema, selection: TextSelection.create(doc, pos)})
}
function guardStateNodeAt(rowIdx: number, colIdx: number) {
  var doc = guardDoc()
  var cell = guardCellFlat(doc)[rowIdx * 3 + colIdx]
  return EditorState.create({doc: doc, schema: schema, selection: NodeSelection.create(doc, cell.pos)})
}
function guardStateRange(fromRow: number, fromCol: number, fromOff: number, toRow: number, toCol: number, toOff: number) {
  var doc = guardDoc()
  var flat = guardCellFlat(doc)
  var from = flat[fromRow * 3 + fromCol].pos + 1 + fromOff
  var to = flat[toRow * 3 + toCol].pos + 1 + toOff
  return EditorState.create({doc: doc, schema: schema, selection: TextSelection.create(doc, from, to)})
}
var guardInitialDoc = guardDoc()

// 非行首格内容开头 Backspace：吞掉（默认 joinBackward 会与前一 cell 合并）
var guardBackspace = pressKey(guardStateAt(1, 1, 0), "Backspace")
check("格开头 Backspace 被处理", guardBackspace.handled, true)
check("格开头 Backspace 文档不变", guardBackspace.state.doc.eq(guardInitialDoc), true)
check("格开头 Backspace 后网格仍 3 列", readTableRows(guardBackspace.state.doc).map(function (r) { return r.length }), [3, 3, 3, 3])

// 同格末尾 Delete：吞掉（默认 joinForward 会与后一 cell 合并）
var guardDelete = pressKey(guardStateAt(1, 1, 2), "Delete")
check("格末尾 Delete 被处理", guardDelete.handled, true)
check("格末尾 Delete 文档不变", guardDelete.state.doc.eq(guardInitialDoc), true)

// 首行行首格开头 Backspace：吞掉（默认会跨表边界 join 或选中 table）
var guardFirstRow = pressKey(guardStateAt(0, 0, 0), "Backspace")
check("首行行首格 Backspace 文档不变", guardFirstRow.state.doc.eq(guardInitialDoc), true)

// 空格开头与末尾重合（空 cell）：两键都吞。本表无空 cell，用末行验证末尾即可
var guardLastCell = pressKey(guardStateAt(3, 2, 2), "Delete")
check("末格末尾 Delete 文档不变", guardLastCell.state.doc.eq(guardInitialDoc), true)

// NodeSelection 选中单个 cell：清空该 cell 内容，cell 保留、光标落进格内
var guardNodeBackspace = pressKey(guardStateNodeAt(1, 0), "Backspace")
check("NodeSelection 选中 cell Backspace 被处理", guardNodeBackspace.handled, true)
check("NodeSelection 选中 cell Backspace 清空内容", readTableRows(guardNodeBackspace.state.doc)[1], ["", "a2", "a3"])
check("NodeSelection 选中 cell Backspace 后仍 3 列", readTableRows(guardNodeBackspace.state.doc)[1].length, 3)
function guardCellParentName($from: any) {
  return $from.parent.type.name === "table_cell" || $from.parent.type.name === "table_header"
}
check("NodeSelection 选中 cell Backspace 后光标进格内", guardCellParentName(guardNodeBackspace.state.selection.$from), true)
var guardNodeDelete = pressKey(guardStateNodeAt(2, 1), "Delete")
check("NodeSelection 选中 cell Delete 清空内容", readTableRows(guardNodeDelete.state.doc)[2], ["b1", "", "b3"])
check("NodeSelection 选中 cell Delete 后仍 3 列", readTableRows(guardNodeDelete.state.doc).length, 4)

// 跨 cell 选区（a1 内容末尾 → b2 内容开头，右开区间）：清空触及的 a1/a2/a3/
// b1/b2 内容，b3 未触及保留；网格保留（默认行为会把相邻 cell join 成一个）
var guardCrossCell = pressKey(guardStateRange(1, 0, 2, 2, 1, 0), "Backspace")
check("跨 cell 选区 Backspace 被处理", guardCrossCell.handled, true)
check("跨 cell 选区 Backspace 清空触及 cell", readTableRows(guardCrossCell.state.doc), [
  ["H1", "H2", "H3"],
  ["", "", ""],
  ["", "", "b3"],
  ["c1", "c2", "c3"]
])
check("跨 cell 选区 Backspace 后网格仍 4 行 3 列", readTableRows(guardCrossCell.state.doc).map(function (r) { return r.length }), [3, 3, 3, 3])
check("跨 cell 选区 Backspace 后光标进格内", guardCellParentName(guardCrossCell.state.selection.$from), true)

// 选中相邻两个 cell（a1 → a2）：清空两个 cell 内容，第三个不受牵连
var guardTwoCells = pressKey(guardStateRange(1, 0, 2, 1, 1, 2), "Backspace")
check("两格选区 Backspace 清空两个 cell", readTableRows(guardTwoCells.state.doc)[1], ["", "", "a3"])
check("两格选区 Backspace 后仍 3 列", readTableRows(guardTwoCells.state.doc)[1].length, 3)

// 同一 cell 内非空选区：正常删内容（网格不变）
var guardInnerRange = pressKey(guardStateRange(1, 1, 0, 1, 1, 2), "Backspace")
check("同格内选区 Backspace 删除内容", readTableRows(guardInnerRange.state.doc)[1], ["a1", "", "a3"])
check("同格内选区 Backspace 后仍 3 列", readTableRows(guardInnerRange.state.doc)[1].length, 3)

// cell 中间 Backspace：不拦（handled=false 交给浏览器原生删除，jsdom 不模拟）
var guardMiddle = pressKey(guardStateAt(1, 1, 1), "Backspace")
check("格中间 Backspace 不拦截", guardMiddle.handled, false)
check("格中间 Backspace 文档不变", guardMiddle.state.doc.eq(guardInitialDoc), true)

// 行首格（非首行）内容开头 Backspace：整行删除优先（守卫不得吞掉它）
var guardRowDelete = pressKey(guardStateAt(2, 0, 0), "Backspace")
check("行首格 Backspace 删整行", readTableRows(guardRowDelete.state.doc).length, 3)
check("行首格 Backspace 删的是 b 行", readTableRows(guardRowDelete.state.doc).map(function (r) { return r[0] }), ["H1", "a1", "c1"])

// 守卫函数直测：表外光标（tail 段落）放行（守卫只管 cell 网格，不干扰表外删除）
var tailDoc = guardDoc()
var tailState = EditorState.create({doc: tailDoc, schema: schema, selection: TextSelection.create(tailDoc, tailDoc.content.size - 9)})
check("表外光标守卫放行", guardTableCellDeletion(tailState, undefined, true), false)

if (failures > 0) {
  console.log("TABLE_HANDLES_TESTS_FAILED: " + failures + " failures")
  throw new Error("TABLE_HANDLES_TESTS_FAILED")
} else {
  console.log("TABLE_HANDLES_TESTS_PASSED")
}