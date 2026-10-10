// 表格行列把手（table handles）：参考 ckant/codemirror-markdown-tables 的交互，
// 在 table NodeView 外包一层 shell。三类交互层（默认隐藏、不可命中）：
// - 行列 grip（六点把手图标）：直接渲染进 td/th 里——列 grip 在首行各 th/td、
//   行 grip 在各行首列 td 内，CSS 以 cell relative + 负偏移定位到表格外侧
//   （列 grip 贴表格上缘、行 grip 贴表格左缘，各对齐所在列 / 行），不压住
//   表格内容，也无需 JS 写几何。显现由光标驱动：tableCoords 装饰插件跟踪选区，
//   给光标所在行的 tr / 所在列的各 th/td 写 active 装饰类，CSS 据此只显现
//   对应的行 / 列把手（光标移出表格即全部隐藏）；按住/拖动中由 -dragging-row /
//   -col 类只显被按下的那一个 grip（-active 自显，其余同类与异类全隐藏）。
//   拖动实时位置反馈（同 codemirror-markdown-tables 的 MoveTracker）：拖动中
//   不提交文档变更，直接给 td/th 写内联 transform 平移——被拖动行/列跟随指针
//   （钳制在表格内），被跨越的行/列整列平移让位；落点用三 slot 中点推进算法
//   （视觉中心越过相邻 slot 边界中点即切换，可连续跨越）。松手才提交移动
//   事务；拖动高亮挂在被拖动行/列（拖动全程不切换）各 td/th 的 drop-target 类上，
//   CSS 用 :after 伪元素画半透明矩形——伪元素长在单元格内，随拖动的 transform
//   一起移动，高亮与位移天然同步（不再用 overlay 上的独立 indicator）；按下
//   grip（-active）即高亮被抓行/列，描边方向跟 -dragging-row / -col 走。单击
//   （未拖出阈值）松手后高亮保留在被点击的行/列上（点击选中），shell 写
//   -highlight-row / -col 方向类维持描边，被点击的 grip 自身写 -selected 类
//   保持按住同款高亮视觉；按下任何非把手位置（表格内外）清除。
//   单击把光标落到 grip 所在单元格（grip 命中的原生点击被把手拦截，以此补偿）。
// - 表下缘 / 右缘的 + 追加条（overlay 上，JS 写几何）：与表格全宽 / 全高，
//   hover 自显，点击在表尾追加一行 / 最右追加一列（单击加一，ckant 按住连加
//   在此裁剪掉）。
//
// 结构命令不走选区：applyTableMutationWithContext 为指定行列索引构造 context，
// 单事务完成整表替换 + 光标落位。移动用绝对目标式 mutation（createTableMoveRowTo /
// ColumnTo），追加复用 mutateTableAddRow / AddColumn（锚在末行末列即表尾语义）。
//
// grip 在 PM 的 contentDOM（table）子树内，三处隔离保其安全：
// - ignoreMutation：涉及 handle 节点的 mutation（插入/移除/active class）一律
//   忽略，PM 才不会把 grip div 当表格内容重读重绘；拖动实时反馈直写 td/th 的
//   style.transform 同理忽略；真实用户编辑不涉及 handle，照常处理。
// - stopEvent：命中 handle 的事件由把手交互接管（监听挂 shell——grip 冒泡
//   不经过 overlay），PM 不处理（pointerdown 才不会抢落光标）。
import { Node as PMNode } from "prosemirror-model"
import { Plugin, PluginKey, Selection } from "prosemirror-state"
import { Decoration, DecorationSet } from "prosemirror-view"
import { NodeViewContext } from "./nodeviews/types"
import {
  applyTableMutationWithContext,
  createTableMoveColumnToMutation,
  createTableMoveRowToMutation,
  getTableContextAt,
  getTableRowsFromNode,
  mutateTableAddColumn,
  mutateTableAddRow
} from "./table"
import "./table-handles.css"

// 单击与拖动的判定阈值（px）：位移超过才视为拖动
var DRAG_THRESHOLD = 4
// 拖动落点高亮类：写在目标行/列的各 td/th 上，CSS 用 :after 伪元素画高亮
var DROP_TARGET_CLASS = "md-editor-table-drop-target"
// 追加条带厚度（px）：下缘全宽横条的高度 / 右缘全高竖条的宽度
var APPEND_STRIP = 20
// 追加条带与表格边缘的间隙（px）
var APPEND_GAP = 2

var COL_GRIP_ICON = '<svg width="15" height="3" fill="currentColor" viewBox="0 0 15 3" xmlns="http://www.w3.org/2000/svg"><circle cx="1.5" cy="1.5" r="1.5"></circle><circle cx="7.5" cy="1.5" r="1.5"></circle><circle cx="13.5" cy="1.5" r="1.5"></circle></svg>'
var ROW_GRIP_ICON = '<svg width="3" height="15" fill="currentColor" viewBox="0 0 3 15" xmlns="http://www.w3.org/2000/svg"><circle cy="1.5" cx="1.5" r="1.5"></circle><circle cy="7.5" cx="1.5" r="1.5"></circle><circle cy="13.5" cx="1.5" r="1.5"></circle></svg>'
var PLUS_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>'

// mutation / 事件是否涉及把手节点（grip 在 td/th 里、+ 按钮在 overlay 里，
// 都带 md-editor-table-handle 类）。removedNodes 已脱离文档，只查自身类名
function isHandleNode(node: Node): boolean {
  return node instanceof Element && node.classList.contains("md-editor-table-handle")
}

// cell（table_cell / table_header）级轻量 NodeView。必须存在的原因：grip
// 渲染进 td/th 后，PM 对 mutation / 事件只问"最近的 desc"——即 cell 级，
// table 级 NodeView 的 ignoreMutation / stopEvent 收不到询问。cell NodeView
// 在最近层把涉及 handle 的 mutation 忽略（防 PM 把 grip 当内容重读重绘）、
// 命中 handle 的事件接管（防 PM 抢落光标）。DOM 就是 td/th + 语义类名
// （与 schema toDOM 一致），对 PM 的内容管理零侵入。
export function createHandleAwareCellNodeView(node: PMNode) {
  if (node.type.name !== "table_cell" && node.type.name !== "table_header") {
    return null
  }
  var isHeaderCell = node.type.name === "table_header"
  var dom = document.createElement(isHeaderCell ? "th" : "td")
  // 与 schema toDOM 一致：th/td 统一带 table-cell 类，handler 样式挂载于类而非裸标签
  dom.className = "table-cell"
  return {
    dom: dom,
    contentDOM: dom,
    // 内容变化的 cell 复用同一 DOM（grip 才不会被重建清掉）
    update: function (nextNode: PMNode) {
      if (nextNode.type !== node.type) {
        return false
      }
      node = nextNode
      return true
    },
    ignoreMutation: function (mutation: MutationRecord) {
      var type: string = mutation.type
      if (type === "selection") {
        return false
      }
      if (type === "childList") {
        for (var i = 0; i < mutation.addedNodes.length; i += 1) {
          if (isHandleNode(mutation.addedNodes[i])) {
            return true
          }
        }
        for (var j = 0; j < mutation.removedNodes.length; j += 1) {
          if (isHandleNode(mutation.removedNodes[j])) {
            return true
          }
        }
      }
      // 拖动实时反馈直写 td/th 的 style.transform（平移跟随/让位）与拖动
      // 落点 drop-target 类，这类 attribute mutation 必须忽略——PM 把它当
      // 内容变化会重读重绘单元格（渲染进来的 grip 会被一并清掉）。tr 上
      // 不能写 transform 的原因同此：tr 没有 NodeView，其 mutation 无人忽略
      if (type === "attributes" && mutation.target === dom &&
          (mutation.attributeName === "style" || mutation.attributeName === "class")) {
        return true
      }
      return isHandleNode(mutation.target)
    },
    stopEvent: function (event: Event) {
      var target = event.target
      var el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
      return !!(el && el.closest(".md-editor-table-handle"))
    }
  }
}

interface TableHandleDragState {
  kind: "row" | "col"
  fromIndex: number
  toIndex: number
  moved: boolean
  startX: number
  startY: number
  // 单击补偿用：grip 所在的单元格元素（未拖动时把光标落进去）
  cellEl: HTMLElement | null
  // 被按下的 grip 元素（单击保留选中态时给它写 selected 类）
  gripEl: HTMLElement | null
  // 拖动开始时的行/列视口矩形缓存（拖动中表结构不变，无需重测）
  rowRects: Array<{left: number, top: number, right: number, bottom: number}>
  colRects: Array<{left: number, top: number, right: number, bottom: number}>
  // 拖动开始时的表格整体矩形（钳制被拖动行/列的位移边界，不出表格）
  tableRect: {left: number, top: number, right: number, bottom: number}
  // 被拖动行的行高 / 列的列宽（被跨越的行/列让位时整行/列平移这个尺寸）
  movingSize: number
}

export function createTableHandlesNodeView(node: PMNode, ctx: NodeViewContext) {
  if (node.type.name !== "table") {
    return null
  }

  var view = ctx.view
  var shell = document.createElement("div")
  shell.className = "md-editor-table-handles-shell"
  var table = document.createElement("table")
  shell.appendChild(table)
  var overlay = document.createElement("div")
  overlay.className = "md-editor-table-handles"
  overlay.setAttribute("contenteditable", "false")
  shell.appendChild(overlay)

  var dragState: TableHandleDragState | null = null
  // 当前已写 drop-target 类的落点（kind:toIndex），落点未变时跳过重写
  var lastIndicatorKey = ""
  var measureFrame: number | null = null
  var rowGripCount = -1
  var colGripCount = -1
  var removeDragListeners: (() => void) | null = null

  function getTablePos(): number {
    var pos = ctx.getPos()
    return typeof pos === "number" ? pos : -1
  }

  // 行元素（DOM 顺序 = 规范化后的 head 行 + body 行顺序）
  function collectRowEls(): HTMLElement[] {
    var rows: HTMLElement[] = []
    var rowNodes = table.querySelectorAll("tr")
    for (var i = 0; i < rowNodes.length; i += 1) {
      rows.push(rowNodes[i] as HTMLElement)
    }
    return rows
  }

  // 列矩形取首行单元格（行列把手与拖动落点都以首行为准）
  function collectCellEls(): HTMLElement[] {
    var firstRow = table.querySelector("tr")
    if (!firstRow) {
      return []
    }
    var cells: HTMLElement[] = []
    var cellNodes = firstRow.children
    for (var i = 0; i < cellNodes.length; i += 1) {
      cells.push(cellNodes[i] as HTMLElement)
    }
    return cells
  }

  function rectsFromElements(els: HTMLElement[]): Array<{left: number, top: number, right: number, bottom: number}> {
    var rects: Array<{left: number, top: number, right: number, bottom: number}> = []
    for (var i = 0; i < els.length; i += 1) {
      var rect = els[i].getBoundingClientRect()
      rects.push({left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom})
    }
    return rects
  }

  // 拖动实时反馈：写单个单元格的拖动 transform。moving = 被拖动行/列的
  // 单元格——平移跟随指针（无过渡）；否则为让位（dx/dy 非 0，带 CSS 过渡
  // 平滑收放）或复位（清空）。提层 z-index 与防穿透底色不写内联——由 CSS
  // 按拖动态分流（shell 带 -dragging 类 + 被拖动行/列各格全程带 drop-target
  // 类）：td 用 --table-drag-cell-bg、th 保表头灰底，th 不再被 td 的底色
  // 一刀切覆盖；松手清 -dragging 类后样式自然消失。
  // 只写 transform 一项内联样式：单元格其余内联样式归其他功能，不整体覆写 style
  function writeDragTransform(el: HTMLElement, dx: number, dy: number, moving: boolean) {
    if (moving || dx !== 0 || dy !== 0) {
      el.style.transform = "translate3d(" + dx + "px, " + dy + "px, 0)"
    } else {
      el.style.transform = ""
    }
  }

  // 拖动实时位置反馈：拖动中不提交文档变更，直接给 td/th 写内联 transform
  // 平移——被拖动行/列的所有单元格平移 offset（onDragMove 钳制在表格内），
  // 落点推进跨越的行/列整行/列平移 ±movingSize 让位。transform 不参与布局，
  // 拖动中的 rects 缓存始终有效；落点高亮是单元格 :after 伪元素，随位移同
  // 步。位移只写 td/th（cell
  // NodeView 会忽略其 style mutation；tr 没有 NodeView，写了会被 PM 重读）
  function applyDragTransforms(state: TableHandleDragState, offset: number) {
    var isRow = state.kind === "row"
    var size = state.movingSize
    var rows = collectRowEls()
    for (var r = 0; r < rows.length; r += 1) {
      var rowShift = 0
      var rowMoving = r === state.fromIndex
      if (!rowMoving) {
        if (state.fromIndex < state.toIndex && r > state.fromIndex && r <= state.toIndex) {
          rowShift = -size
        } else if (state.fromIndex > state.toIndex && r >= state.toIndex && r < state.fromIndex) {
          rowShift = size
        }
      }
      var cells = rows[r].children
      for (var c = 0; c < cells.length; c += 1) {
        var cell = cells[c] as HTMLElement
        if (isRow) {
          writeDragTransform(cell, 0, rowMoving ? offset : rowShift, rowMoving)
        } else {
          var colMoving = c === state.fromIndex
          var colShift = 0
          if (!colMoving) {
            if (state.fromIndex < state.toIndex && c > state.fromIndex && c <= state.toIndex) {
              colShift = -size
            } else if (state.fromIndex > state.toIndex && c >= state.toIndex && c < state.fromIndex) {
              colShift = size
            }
          }
          writeDragTransform(cell, colMoving ? offset : colShift, 0, colMoving)
        }
      }
    }
  }

  // 清理拖动实时反馈的内联样式：松手提交移动事务前调用——列/行移动后 PM
  // 复用同一批 td/th DOM，残留 transform 会让"已移动完成"的表格仍然偏着
  function clearDragTransforms() {
    var rows = collectRowEls()
    for (var r = 0; r < rows.length; r += 1) {
      var cells = rows[r].children
      for (var c = 0; c < cells.length; c += 1) {
        writeDragTransform(cells[c] as HTMLElement, 0, 0, false)
      }
    }
  }

  // 把手几何：grip 的定位全交给 CSS（负偏移到表格外侧），这里只写
  // + 追加条带的几何（相对 overlay 原点换算——shell 是块级容器可能比 table
  // 宽，不能用 table 左上角当原点）：
  // - 追加行条：表格下缘全表宽横条；追加列条：右缘全表高竖条。
  // 无布局环境（jsdom）矩形全 0，直接跳过（几何交给真实浏览器渲染时再写）。
  function applyHandleGeometry() {
    // 保底校验：PM 重绘 cell 内容（如撤销大段）可能把插在 td/th 里的 grip
    // 清掉且不触发 NodeView.update；每次几何重测前校验 grip 数量，缺失则重建
    var expectedGrips = collectCellEls().length + collectRowEls().length
    var actualGrips = table.querySelectorAll(".md-editor-table-handle-col, .md-editor-table-handle-row").length
    if (actualGrips !== expectedGrips) {
      rebuildHandles(true)
      return
    }
    var overlayRect = overlay.getBoundingClientRect()
    var tableRect = table.getBoundingClientRect()
    if (tableRect.width <= 0 && tableRect.height <= 0) {
      return
    }
    var appendRow = overlay.querySelector(".md-editor-table-append-row") as HTMLElement | null
    if (appendRow) {
      appendRow.style.left = (tableRect.left - overlayRect.left) + "px"
      appendRow.style.top = (tableRect.bottom - overlayRect.top + APPEND_GAP) + "px"
      appendRow.style.width = tableRect.width + "px"
      appendRow.style.height = APPEND_STRIP + "px"
    }
    var appendCol = overlay.querySelector(".md-editor-table-append-col") as HTMLElement | null
    if (appendCol) {
      appendCol.style.left = (tableRect.right - overlayRect.left + APPEND_GAP) + "px"
      appendCol.style.top = (tableRect.top - overlayRect.top) + "px"
      appendCol.style.width = APPEND_STRIP + "px"
      appendCol.style.height = tableRect.height + "px"
    }
  }

  function scheduleMeasure() {
    if (measureFrame !== null) {
      return
    }
    measureFrame = window.requestAnimationFrame(function () {
      measureFrame = null
      applyHandleGeometry()
    })
  }

  // 延迟一帧重建把手：工厂执行时 PM 尚未把表格内容挂载进 contentDOM
  // （NodeView 工厂返回后 PM 才同步渲染子节点），同步 rebuildHandles 会拿到
  // 空表（0 行 0 列）且此后再无触发时机。rAF 一帧后内容已就位。
  var rebuildFrame: number | null = null
  function scheduleRebuild() {
    if (rebuildFrame !== null) {
      return
    }
    rebuildFrame = window.requestAnimationFrame(function () {
      rebuildFrame = null
      rebuildHandles(false)
    })
  }

  // 结构变化（行列数）时重建把手；几何位置一律在 rAF 中重测（内容编辑也会改列宽）。
  // force：绕过行列数缓存比对强制重建（保底校验发现 grip 被 PM 重绘清掉、
  // 但行列数没变时，缓存比对会误判"无变化"而 early-return）
  function rebuildHandles(force: boolean) {
    var rowEls = collectRowEls()
    var cellEls = collectCellEls()
    var nextRowGrips = rowEls.length
    var nextColGrips = cellEls.length
    if (!force && nextRowGrips === rowGripCount && nextColGrips === colGripCount) {
      scheduleMeasure()
      return
    }
    rowGripCount = nextRowGrips
    colGripCount = nextColGrips

    // 旧把手清理：grip 在 td/th 里、+ 按钮在 overlay 里，都在 shell 子树内，
    // 从 shell 范围统一移除（drop-target 类在 td/th 上，不受影响）
    var stale = shell.querySelectorAll(".md-editor-table-handle")
    for (var i = 0; i < stale.length; i += 1) {
      var parent = stale[i].parentNode
      if (parent) {
        parent.removeChild(stale[i])
      }
    }

    // grip 真渲染进 td/th：列 grip 插入首行对应 cell、行 grip 插入对应行首 cell。
    // 定位交给 CSS（cell relative + 负偏移到表格外侧：行 grip 贴左缘、列 grip
    // 贴上缘），无需 JS 写几何。
    // innerHTML 先于 appendChild：icon 的子树 mutation 在脱离文档时发生，
    // PM 的 MutationObserver 不会收到（只有 append 这一个 childList mutation，
    // 由 ignoreMutation 识别 handle 节点忽略）
    for (var col = 0; col < colGripCount && col < cellEls.length; col += 1) {
      var colGrip = document.createElement("div")
      colGrip.className = "md-editor-table-handle md-editor-table-handle-col"
      colGrip.setAttribute("data-kind", "col")
      colGrip.setAttribute("data-index", String(col))
      colGrip.setAttribute("title", "拖动移动列，单击定位")
      colGrip.innerHTML = '<span class="md-editor-table-handle-icon">' + COL_GRIP_ICON + "</span>"
      cellEls[col].appendChild(colGrip)
    }
    for (var row = 0; row < rowGripCount && row < rowEls.length; row += 1) {
      var firstCell = rowEls[row].firstElementChild
      if (!(firstCell instanceof HTMLElement)) {
        continue
      }
      var rowGrip = document.createElement("div")
      rowGrip.className = "md-editor-table-handle md-editor-table-handle-row"
      rowGrip.setAttribute("data-kind", "row")
      rowGrip.setAttribute("data-index", String(row))
      rowGrip.setAttribute("title", "拖动移动行，单击定位")
      rowGrip.innerHTML = '<span class="md-editor-table-handle-icon">' + ROW_GRIP_ICON + "</span>"
      firstCell.appendChild(rowGrip)
    }

    var appendRow = document.createElement("div")
    appendRow.className = "md-editor-table-handle md-editor-table-append-row"
    appendRow.setAttribute("data-kind", "row")
    appendRow.setAttribute("title", "追加一行")
    appendRow.innerHTML = PLUS_ICON
    overlay.appendChild(appendRow)

    var appendCol = document.createElement("div")
    appendCol.className = "md-editor-table-handle md-editor-table-append-col"
    appendCol.setAttribute("data-kind", "col")
    appendCol.setAttribute("title", "追加一列")
    appendCol.innerHTML = PLUS_ICON
    overlay.appendChild(appendCol)

    scheduleMeasure()
  }

  // 拖动高亮：拖动全程挂被拖动行/列（fromIndex）的各 td/th 上，写 drop-target
  // 类，CSS 用 :after 伪元素画半透明矩形（盖满单元格并外扩 1px，同行/列各格的
  // 高亮自然连成整条）。伪元素长在单元格内部，随拖动的 transform 平移一起移动——
  // 高亮与拖动位移天然同步，无需 JS 定位。高亮不随落点切换（key = kind + ":" +
  // fromIndex 拖动全程不变，类一次写好后跳过重写），避免"快到目标时高亮消失"的观感
  function clearDropTargetClass() {
    var marked = shell.querySelectorAll("." + DROP_TARGET_CLASS)
    for (var i = 0; i < marked.length; i += 1) {
      marked[i].classList.remove(DROP_TARGET_CLASS)
    }
  }

  // 高亮挂在被拖动的行/列上（fromIndex），不挂在落点槽位：被拖动行/列随指针
  // 平移，本身已经指示落点；若高亮切到目标槽位，被拖动行/列的高亮反而消失，
  // 出现"快到目标时高亮没了、被替换的行/列亮了"的错位。类一次写好即可，
  // 落点推进只动 transform（key 不变，重复调用直接跳过）
  function showIndicator(state: TableHandleDragState) {
    var key = state.kind + ":" + state.fromIndex
    if (key === lastIndicatorKey) {
      return
    }
    clearDropTargetClass()
    lastIndicatorKey = key
    var rows = collectRowEls()
    if (state.kind === "row") {
      var rowEl = rows[state.fromIndex]
      if (rowEl) {
        var cells = rowEl.children
        for (var i = 0; i < cells.length; i += 1) {
          ;(cells[i] as Element).classList.add(DROP_TARGET_CLASS)
        }
      }
    } else {
      for (var r = 0; r < rows.length; r += 1) {
        var cell = rows[r].children[state.fromIndex]
        if (cell) {
          cell.classList.add(DROP_TARGET_CLASS)
        }
      }
    }
  }

  // 拖动收尾：keepHighlight 为 true（单击未拖出阈值）时保留行/列高亮——
  // drop-target 类留在被 grip 命中的行/列各 td/th 上，并给 shell 写
  // -highlight-row / -highlight-col 方向类（松手后没有 -dragging-* 类，CSS
  // 的描边方向规则须靠它命中），形成"点击选中该行/列"的保持态；真拖动
  // 结束 / 拖动取消则高亮全部清掉。两种路径都把缓存清空：保留时类已在
  // DOM 上不依赖缓存，下次按下任何 grip 都强制重写（防 DOM 重建后残留
  // 缓存导致高亮丢失）
  // 清除所有 grip 的 selected 选中态（单击保留高亮时 grip 自身复用
  // -active 同款 ::after 高亮，selected 只是类名层面的保持态标记）
  function clearSelectedGrips() {
    var grips = shell.querySelectorAll(".md-editor-table-handle-selected")
    for (var i = 0; i < grips.length; i += 1) {
      grips[i].classList.remove("md-editor-table-handle-selected")
    }
  }

  function endDrag(keepHighlight: boolean, kind: "row" | "col") {
    if (removeDragListeners) {
      removeDragListeners()
      removeDragListeners = null
    }
    shell.classList.remove("md-editor-table-handles-dragging")
    shell.classList.remove("md-editor-table-handles-dragging-row")
    shell.classList.remove("md-editor-table-handles-dragging-col")
    shell.classList.remove("md-editor-table-handles-highlight-row")
    shell.classList.remove("md-editor-table-handles-highlight-col")
    clearSelectedGrips()
    if (keepHighlight) {
      shell.classList.add("md-editor-table-handles-highlight-" + kind)
    } else {
      clearDropTargetClass()
    }
    lastIndicatorKey = ""
    clearDragTransforms()
    var grips = shell.querySelectorAll(".md-editor-table-handle-active")
    for (var i = 0; i < grips.length; i += 1) {
      grips[i].classList.remove("md-editor-table-handle-active")
    }
  }

  // 拖动落点：三 slot 中点推进算法——被拖动行/列的视觉中心越过相邻行/列的
  // 边界中点即切换 currentIndex（可连续跨越多个 slot），从 toIndex 出发向
  // 指针方向推进。位移先钳制在表格范围内（被拖动行/列不出界）。拖动中布局
  // 不变（transform 不参与布局），rects 缓存始终有效
  function onDragMove(event: PointerEvent) {
    var state = dragState
    if (!state) {
      return
    }
    var dx = event.clientX - state.startX
    var dy = event.clientY - state.startY
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      state.moved = true
    }
    if (!state.moved) {
      return
    }
    var isRow = state.kind === "row"
    var rects = isRow ? state.rowRects : state.colRects
    var fromRect = rects[state.fromIndex]
    if (!fromRect) {
      return
    }
    // 位移钳制：被拖动行/列不脱离表格范围
    var rawOffset = isRow ? dy : dx
    var minOffset = isRow ? state.tableRect.top - fromRect.top : state.tableRect.left - fromRect.left
    var maxOffset = isRow ? state.tableRect.bottom - fromRect.bottom : state.tableRect.right - fromRect.right
    var offset = rawOffset < minOffset ? minOffset : rawOffset > maxOffset ? maxOffset : rawOffset
    // 视觉中心（起始中心 + 钳制后位移），与相邻 slot 边界中点比较推进落点
    var start = function (rect: {left: number, top: number}) { return isRow ? rect.top : rect.left }
    var end = function (rect: {left: number, top: number, right: number, bottom: number}) { return isRow ? rect.bottom : rect.right }
    var center = (start(fromRect) + end(fromRect)) / 2 + offset
    var nextIndex = state.toIndex
    while (nextIndex < rects.length - 1 && center > (end(rects[nextIndex]) + start(rects[nextIndex + 1])) / 2) {
      nextIndex += 1
    }
    while (nextIndex > 0 && center < (end(rects[nextIndex - 1]) + start(rects[nextIndex])) / 2) {
      nextIndex -= 1
    }
    state.toIndex = nextIndex
    applyDragTransforms(state, offset)
    showIndicator(state)
  }

  function onDragEnd() {
    var state = dragState
    dragState = null
    if (!state) {
      endDrag(false, "row")
      return
    }
    // 单击（未越阈值）：不移动行列，保留行/列高亮（点击选中该行/列），
    // 落光标到 grip 铺满的单元格
    if (!state.moved) {
      endDrag(true, state.kind)
      if (state.gripEl) {
        state.gripEl.classList.add("md-editor-table-handle-selected")
      }
      if (state.cellEl) {
        focusCell(state.cellEl)
      }
      return
    }
    endDrag(false, state.kind)
    if (state.toIndex === state.fromIndex) {
      return
    }
    runMoveMutation(state.kind, state.fromIndex, state.toIndex)
  }

  function onDragCancel() {
    dragState = null
    endDrag(false, "row")
  }

  // 单击补偿：grip 命中的原生点击被把手拦截（pointerdown preventDefault），
  // 未拖动松手时把光标落到 grip 所在单元格内（单元格开头）
  function focusCell(cellEl: HTMLElement) {
    view.focus()
    try {
      var pos = view.posAtDOM(cellEl, 0)
      var sel = Selection.near(view.state.doc.resolve(pos), 1)
      view.dispatch(view.state.tr.setSelection(sel))
    } catch (error) {
      // posAtDOM 在节点未挂载 / 已脱离文档等场景会抛错，静默放弃落位
    }
  }

  // 拖动把手：document 级监听（不依赖 setPointerCapture，jsdom 等环境也可用）。
  // grip 渲染在 td/th 里，其父元素即所在的对应单元格（单击落光标补偿用）
  function startDrag(event: PointerEvent, kind: "row" | "col", fromIndex: number, gripEl: HTMLElement) {
    var cellEl = gripEl.parentElement instanceof HTMLElement ? gripEl.parentElement : null
    var rowRects = rectsFromElements(collectRowEls())
    var colRects = rectsFromElements(collectCellEls())
    var tableRectRaw = table.getBoundingClientRect()
    var tableRect = {left: tableRectRaw.left, top: tableRectRaw.top, right: tableRectRaw.right, bottom: tableRectRaw.bottom}
    var fromRect = kind === "row" ? rowRects[fromIndex] : colRects[fromIndex]
    var movingSize = fromRect
      ? (kind === "row" ? fromRect.bottom - fromRect.top : fromRect.right - fromRect.left)
      : 0
    var state: TableHandleDragState = {
      kind: kind,
      fromIndex: fromIndex,
      toIndex: fromIndex,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      cellEl: cellEl,
      gripEl: gripEl,
      rowRects: rowRects,
      colRects: colRects,
      tableRect: tableRect,
      movingSize: movingSize
    }
    dragState = state
    // 新一次按下即开始新交互：清掉上一次单击保留的高亮方向类与 grip 选中态
    // （保留的 drop-target 类由 showIndicator 清旧写新）
    shell.classList.remove("md-editor-table-handles-highlight-row")
    shell.classList.remove("md-editor-table-handles-highlight-col")
    clearSelectedGrips()
    shell.classList.add("md-editor-table-handles-dragging")
    shell.classList.add(kind === "row" ? "md-editor-table-handles-dragging-row" : "md-editor-table-handles-dragging-col")
    // 按下（grip 得 handle-active）即高亮被抓的行/列——toIndex 初始就是
    // fromIndex，直接写 drop-target 类；移动后落点变化由 showIndicator 增量切换
    showIndicator(state)
    document.addEventListener("pointermove", onDragMove)
    document.addEventListener("pointerup", onDragEnd)
    document.addEventListener("pointercancel", onDragCancel)
    removeDragListeners = function () {
      document.removeEventListener("pointermove", onDragMove)
      document.removeEventListener("pointerup", onDragEnd)
      document.removeEventListener("pointercancel", onDragCancel)
    }
  }

  // 监听挂在 shell：grip 在 td/th 里（table 子树），事件冒泡路径是
  // grip→td→tr→…→table→shell，不经过 overlay；+ 按钮在 overlay 里同样冒泡到 shell
  function onShellPointerDown(event: PointerEvent) {
    var target = event.target as HTMLElement | null
    if (!target || !(target instanceof Element)) {
      return
    }
    var grip = target.closest(".md-editor-table-handle") as HTMLElement | null
    if (!grip || !shell.contains(grip)) {
      return
    }
    // 阻止编辑器抢焦点/落光标；把手交互不改变选区
    event.preventDefault()
    event.stopPropagation()
    if (grip.classList.contains("md-editor-table-append-row") || grip.classList.contains("md-editor-table-append-col")) {
      // + 按钮只响应 click，pointerdown 不开拖动
      return
    }
    var kind: "row" | "col" = grip.getAttribute("data-kind") === "col" ? "col" : "row"
    var index = parseInt(grip.getAttribute("data-index") || "0", 10)
    grip.classList.add("md-editor-table-handle-active")
    startDrag(event, kind, index, grip)
  }

  shell.addEventListener("pointerdown", onShellPointerDown)
  shell.addEventListener("click", onShellClick)
  // hover 表格时把手位置可能因内容编辑/窗口变化过期，进入即重测一次
  shell.addEventListener("pointerenter", scheduleMeasure)
  // 单击保留的高亮清除监听（见下方 onDocPointerDown）
  document.addEventListener("pointerdown", onDocPointerDown)

  // 单击保留高亮的清除时机：按下任何非把手位置（表格内其他区域、+ 追加条、
  // 表格外任意处）即清。命中本表 grip（非追加条）的按下除外——按下即开始
  // 新的拖动/选中，startDrag 的 showIndicator 会把高亮切到新行/列
  function onDocPointerDown(event: PointerEvent) {
    var target = event.target
    if (target instanceof Element && shell.contains(target)) {
      if (target.closest(".md-editor-table-handle") &&
          !target.closest(".md-editor-table-append-row") &&
          !target.closest(".md-editor-table-append-col")) {
        return
      }
    }
    shell.classList.remove("md-editor-table-handles-highlight-row")
    shell.classList.remove("md-editor-table-handles-highlight-col")
    lastIndicatorKey = ""
    clearDropTargetClass()
    clearSelectedGrips()
  }

  // 监听在 shell 上：单元格内容的正常点击也冒泡到这里，必须先确认命中把手
  // 才拦截（否则 preventDefault 会破坏 PM 的原生点击处理），否则放行
  function onShellClick(event: MouseEvent) {
    var target = event.target as HTMLElement | null
    if (!target || !(target instanceof Element)) {
      return
    }
    if (!target.closest(".md-editor-table-handle")) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (target.closest(".md-editor-table-append-row")) {
      runAppendMutation("row")
    } else if (target.closest(".md-editor-table-append-col")) {
      runAppendMutation("col")
    }
  }

  // 为移动操作构造 context：行移动锚在起点行；列移动锚在首个包含起点列的行
  function buildMoveContext(tableNode: PMNode, tablePos: number, kind: "row" | "col", fromIndex: number) {
    if (kind === "row") {
      return getTableContextAt(tableNode, tablePos, fromIndex, 0)
    }
    var rows = getTableRowsFromNode(tableNode)
    for (var i = 0; i < rows.length; i += 1) {
      var rowNode = rows[i].rowNode
      if (rowNode && rowNode.childCount > fromIndex) {
        return getTableContextAt(tableNode, tablePos, i, fromIndex)
      }
    }
    return null
  }

  function runMoveMutation(kind: "row" | "col", fromIndex: number, toIndex: number) {
    var tablePos = getTablePos()
    if (tablePos < 0) {
      return
    }
    var tableNode = view.state.doc.nodeAt(tablePos)
    if (!tableNode || tableNode.type.name !== "table") {
      return
    }
    var context = buildMoveContext(tableNode, tablePos, kind, fromIndex)
    if (!context) {
      return
    }
    var mutation = kind === "row"
      ? createTableMoveRowToMutation(toIndex)
      : createTableMoveColumnToMutation(toIndex)
    applyTableMutationWithContext(view.state, view.dispatch, context, mutation)
  }

  // 表尾追加：锚在末行末列（mutateTableAddRow 在锚点行后插入 = 表尾；
  // mutateTableAddColumn 在锚点列后插入 = 最右），复用现有命令语义
  function runAppendMutation(kind: "row" | "col") {
    var tablePos = getTablePos()
    if (tablePos < 0) {
      return
    }
    var tableNode = view.state.doc.nodeAt(tablePos)
    if (!tableNode || tableNode.type.name !== "table") {
      return
    }
    var rows = getTableRowsFromNode(tableNode)
    if (rows.length < 1) {
      return
    }
    var lastRowNode = rows[rows.length - 1].rowNode
    var lastCol = lastRowNode && lastRowNode.childCount > 0 ? lastRowNode.childCount - 1 : 0
    var context = getTableContextAt(tableNode, tablePos, rows.length - 1, lastCol)
    if (!context) {
      return
    }
    var mutation = kind === "row" ? mutateTableAddRow : mutateTableAddColumn
    applyTableMutationWithContext(view.state, view.dispatch, context, mutation)
    view.focus()
  }

  scheduleRebuild()

  return {
    dom: shell,
    contentDOM: table,
    update: function (nextNode: PMNode) {
      if (nextNode.type.name !== "table") {
        return false
      }
      node = nextNode
      // PM 调用 update 时 contentDOM 还是旧内容（先问 NodeView 能否复用，
      // 之后才同步 contentDOM 子树），同步 rebuildHandles 会读到旧行列数
      // 且与缓存相等而 early-return；改走 rAF，一帧后内容已就位。
      scheduleRebuild()
      return true
    },
    stopEvent: function (event: Event) {
      var target = event.target
      if (target instanceof Node && overlay.contains(target)) {
        return true
      }
      // grip 渲染在 td/th（contentDOM 子树）里：命中 handle 的事件也一律由
      // 把手交互接管，PM 不得处理（否则 pointerdown 会抢落光标）
      var el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
      return !!(el && el.closest(".md-editor-table-handle") && shell.contains(el))
    },
    // overlay/shell 是把手层自管的 DOM：其中任何 mutation 都不能让 PM
    // 重读/重绘整个 table 节点（否则把手会被清掉）。grip 渲染进 td/th 后，
    // table 内涉及 handle 节点的 mutation（append / 移除 / active class 切换）
    // 也必须忽略——PM 若把这些当内容变化处理，readDOMChange 会把 grip div
    // 一起解析重读，表格内容会被破坏；真正的用户编辑 mutation 不涉及 handle
    // 节点，照常由 PM 处理。
    ignoreMutation: function (mutation: MutationRecord) {
      // 浏览器有 selection 型 mutation（TS 的 MutationRecordType 未收录），
      // 选区类 mutation 交给 PM 自己处理
      var type: string = mutation.type
      if (type === "selection") {
        return false
      }
      var target = mutation.target
      if (target instanceof Node && shell.contains(target) && !table.contains(target)) {
        return true
      }
      if (type === "childList") {
        for (var i = 0; i < mutation.addedNodes.length; i += 1) {
          if (isHandleNode(mutation.addedNodes[i])) {
            return true
          }
        }
        for (var j = 0; j < mutation.removedNodes.length; j += 1) {
          if (isHandleNode(mutation.removedNodes[j])) {
            return true
          }
        }
      }
      return isHandleNode(target)
    },
    destroy: function () {
      document.removeEventListener("pointerdown", onDocPointerDown)
      if (measureFrame !== null) {
        window.cancelAnimationFrame(measureFrame)
        measureFrame = null
      }
      if (rebuildFrame !== null) {
        window.cancelAnimationFrame(rebuildFrame)
        rebuildFrame = null
      }
      if (removeDragListeners) {
        removeDragListeners()
        removeDragListeners = null
      }
      dragState = null
    }
  }
}

// 表格行列坐标装饰：给每个 tr 写 data-row（表内 0 起递增，thead 行在前、
// tbody 行在后）、行内每个 th/td 写 data-col（0 起递增），供样式与测试按
// 行列定位单元格；并按光标位置给所在行的 tr / 所在列的各 th/td 写 active
// 类（CSS 据此显现表格外侧的行 / 列把手，替代原先的 hover 显现）。
// 用节点装饰（Decoration.node）而非直接 setAttribute：直接改 DOM 属性会触发
// PM 的 attribute mutation → registerMutation 返回该节点区间 → readDOMChange
// 重读重绘，把把手（grip）与标注一并清掉。装饰属性由 PM 在自身更新流程中
// 应用（observer 已停），不经过 MutationObserver。
interface TableCoordsState {
  decorations: DecorationSet
}

export var tableCoordsKey = new PluginKey<TableCoordsState>("tableCoords")

export function createTableCoordsPlugin(): Plugin<TableCoordsState> {
  return new Plugin<TableCoordsState>({
    key: tableCoordsKey,
    state: {
      init: function (_, state) {
        return { decorations: buildTableCoordsDecorations(state.doc, state.selection) }
      },
      apply: function (tr, value) {
        // 选区变化也要重建：光标所在行/列的 active 装饰随选区走，
        // docChanged 时结构变了自然要重建
        if (!tr.docChanged && !tr.selectionSet) {
          return value
        }
        return { decorations: buildTableCoordsDecorations(tr.doc, tr.selection) }
      }
    },
    props: {
      decorations: function (state) {
        var pluginState = tableCoordsKey.getState(state)
        return pluginState ? pluginState.decorations : DecorationSet.empty
      }
    }
  })
}

// 光标所在的表格锚点：从 $from 向上解析 cell / row / table 三层深度，
// 算出所在行的表内行号（rowPos）与行内列号，供 active 装饰定位。
// 光标不在任何表格内时返回 null（此时所有 active 装饰清空 → 把手全隐藏）
interface ActiveCellAnchor {
  tablePos: number
  rowPos: number
  colIndex: number
}

function findActiveCellAnchor(selection: Selection): ActiveCellAnchor | null {
  var $from = selection.$from
  var cellDepth = -1
  var rowDepth = -1
  var tableDepth = -1
  for (var d = $from.depth; d > 0; d -= 1) {
    var name = $from.node(d).type.name
    if (name === "table_cell" || name === "table_header") {
      cellDepth = d
    } else if (name === "table_row") {
      rowDepth = d
    } else if (name === "table") {
      tableDepth = d
    }
  }
  if (tableDepth < 0 || rowDepth < 0 || cellDepth < 0) {
    return null
  }
  var tablePos = $from.before(tableDepth)
  var rowNode = $from.node(rowDepth)
  var rowPos = $from.before(rowDepth)
  var cellNode = $from.node(cellDepth)
  var colIndex = -1
  rowNode.forEach(function (child, _offset, index) {
    if (child === cellNode) {
      colIndex = index
    }
  })
  if (colIndex < 0) {
    return null
  }
  return { tablePos: tablePos, rowPos: rowPos, colIndex: colIndex }
}

// 遍历文档所有 table，按 DOM 顺序（table_head 行在前、table_body 行在后）给
// 每个 table_row 标 row 序号，行内 table_header/table_cell 标 col 序号。
// 同时按光标位置写 active 类：光标所在行的 tr 加 md-editor-table-active-row
// （驱动该行行把手显现）、光标所在列的所有 th/td 加 md-editor-table-active-col
// （驱动该列列把手显现）。
function buildTableCoordsDecorations(doc: PMNode, selection: Selection): DecorationSet {
  var decorations: Decoration[] = []
  var anchor = findActiveCellAnchor(selection)
  doc.descendants(function (tableNode, tablePos) {
    if (tableNode.type.name !== "table") {
      return
    }
    var activeTable = !!anchor && anchor.tablePos === tablePos
    var rowIndex = 0
    tableNode.descendants(function (rowNode, rowOffset) {
      if (rowNode.type.name !== "table_row") {
        return
      }
      var rowPos = tablePos + 1 + rowOffset
      var rowAttrs: { [key: string]: string } = { "data-row": String(rowIndex) }
      if (activeTable && rowPos === anchor!.rowPos) {
        rowAttrs["class"] = "md-editor-table-active-row"
      }
      decorations.push(Decoration.node(rowPos, rowPos + rowNode.nodeSize, rowAttrs))
      var colIndex = 0
      rowNode.forEach(function (cellNode, cellOffset) {
        var cellPos = rowPos + 1 + cellOffset
        var cellAttrs: { [key: string]: string } = { "data-col": String(colIndex) }
        if (activeTable && colIndex === anchor!.colIndex) {
          cellAttrs["class"] = "md-editor-table-active-col"
        }
        decorations.push(Decoration.node(cellPos, cellPos + cellNode.nodeSize, cellAttrs))
        colIndex += 1
      })
      rowIndex += 1
    })
  })
  return DecorationSet.create(doc, decorations)
}