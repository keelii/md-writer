import { Node as PMNode, NodeType, ResolvedPos, Schema } from "prosemirror-model"
import { EditorState, NodeSelection, Selection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { InputRule } from "prosemirror-inputrules"
import { EditorDispatch, JSONNodeData, TableRowMeta, TableRowJSONMeta, TableContext, TableMutation, TableMutationResult, TableSections } from "../types"

function createEmptyTableCellNode(cellType: NodeType | undefined) {
  if (!cellType) {
    return null
  }
  if (typeof cellType.createAndFill === "function") {
    var filled = cellType.createAndFill()
    if (filled) {
      return filled
    }
  }
  return cellType.create()
}

function createTableRowNode(schema: Schema, colCount: number, isHeader: boolean) {
  var rowType = schema.nodes.table_row
  var headerCellType = schema.nodes.table_header
  var bodyCellType = schema.nodes.table_cell
  if (!rowType || !headerCellType || !bodyCellType) {
    return null
  }

  var cells: PMNode[] = []
  var cellType = isHeader ? headerCellType : bodyCellType
  for (var col = 0; col < colCount; col += 1) {
    var cell = createEmptyTableCellNode(cellType)
    if (!cell) {
      return null
    }
    cells.push(cell)
  }

  return rowType.create(null, cells)
}

export function insertDefaultTableNode(view: EditorView, schema: Schema) {
  var tableType = schema.nodes.table
  var tableHeadType = schema.nodes.table_head
  var tableBodyType = schema.nodes.table_body
  if (!tableType) {
    return false
  }

  var headerRow = createTableRowNode(schema, 3, true)
  var bodyRow = createTableRowNode(schema, 3, false)
  if (!headerRow || !bodyRow) {
    return false
  }

  var tableChildren: PMNode[] = []
  if (tableHeadType && tableBodyType) {
    tableChildren.push(tableHeadType.create(null, [headerRow]))
    tableChildren.push(tableBodyType.create(null, [bodyRow]))
  } else {
    tableChildren.push(headerRow)
    tableChildren.push(bodyRow)
  }

  var tableNode
  try {
    tableNode = tableType.create(null, tableChildren)
  } catch (error) {
    return false
  }

  var insertPos = view.state.selection.from
  var tr = view.state.tr.replaceSelectionWith(tableNode)
  var mappedInsertPos = tr.mapping.map(insertPos, -1)
  var cursorPos = mappedInsertPos + getTableCellContentOffset(tableNode, 0, 0)
  tr = tr.setSelection(Selection.near(tr.doc.resolve(cursorPos))).scrollIntoView()
  view.dispatch(tr)
  return true
}

export function getTableRowsFromNode(tableNode: PMNode): TableRowMeta[] {
  var rows: TableRowMeta[] = []
  if (!tableNode || typeof tableNode.childCount !== "number") {
    return rows
  }

  var offset = 1
  var headCount = 0
  var bodyCount = 0

  for (var childIndex = 0; childIndex < tableNode.childCount; childIndex += 1) {
    var child = tableNode.child(childIndex)
    if (!child || !child.type) {
      continue
    }

    var childName = child.type.name
    if (childName === "table_head" || childName === "table_body") {
      var sectionType = childName
      var sectionOffset = offset + 1
      for (var sectionRowIndex = 0; sectionRowIndex < child.childCount; sectionRowIndex += 1) {
        var rowNode = child.child(sectionRowIndex)
        rows.push({
          rowNode: rowNode,
          sectionType: sectionType,
          rowIndexInSection: sectionRowIndex,
          startOffset: sectionOffset
        })
        sectionOffset += rowNode.nodeSize
      }
      if (sectionType === "table_head") {
        headCount += child.childCount
      } else {
        bodyCount += child.childCount
      }
      offset += child.nodeSize
      continue
    }

    if (childName === "table_row") {
      var fallbackSectionType = headCount === 0 ? "table_head" : "table_body"
      var fallbackRowIndex = fallbackSectionType === "table_head" ? headCount : bodyCount
      rows.push({
        rowNode: child,
        sectionType: fallbackSectionType,
        rowIndexInSection: fallbackRowIndex,
        startOffset: offset
      })
      if (fallbackSectionType === "table_head") {
        headCount += 1
      } else {
        bodyCount += 1
      }
      offset += child.nodeSize
      continue
    }

    offset += child.nodeSize
  }

  return rows
}

function getTableRowsFromJSON(tableJSON: JSONNodeData): TableRowJSONMeta[] {
  var rows: TableRowJSONMeta[] = []
  var content: JSONNodeData[] = tableJSON && Array.isArray(tableJSON.content) ? tableJSON.content : []
  var headCount = 0
  var bodyCount = 0

  for (var index = 0; index < content.length; index += 1) {
    var child = content[index]
    if (!child || typeof child !== "object") {
      continue
    }

    if (child.type === "table_head" || child.type === "table_body") {
      var sectionType = child.type
      var sectionRows = Array.isArray(child.content) ? child.content : []
      for (var rowIndex = 0; rowIndex < sectionRows.length; rowIndex += 1) {
        var row = sectionRows[rowIndex]
        if (!row || typeof row !== "object" || row.type !== "table_row") {
          continue
        }
        rows.push({
          row: row,
          sectionType: sectionType,
          rowIndexInSection: rowIndex
        })
      }
      if (sectionType === "table_head") {
        headCount += sectionRows.length
      } else {
        bodyCount += sectionRows.length
      }
      continue
    }

    if (child.type === "table_row") {
      var fallbackSectionType = headCount === 0 ? "table_head" : "table_body"
      var fallbackRowIndex = fallbackSectionType === "table_head" ? headCount : bodyCount
      rows.push({
        row: child,
        sectionType: fallbackSectionType,
        rowIndexInSection: fallbackRowIndex
      })
      if (fallbackSectionType === "table_head") {
        headCount += 1
      } else {
        bodyCount += 1
      }
    }
  }

  return rows
}

export function getTableContext(state: EditorState): TableContext | null {
  var $from = state.selection.$from
  var tableDepth = -1
  var rowDepth = -1
  var cellDepth = -1

  for (var depth = $from.depth; depth >= 0; depth -= 1) {
    var node = $from.node(depth)
    var nodeName = node && node.type ? node.type.name : ""
    if (cellDepth < 0 && (nodeName === "table_cell" || nodeName === "table_header")) {
      cellDepth = depth
    }
    if (rowDepth < 0 && nodeName === "table_row") {
      rowDepth = depth
    }
    if (nodeName === "table") {
      tableDepth = depth
      break
    }
  }

  if (tableDepth < 0 || rowDepth < 0 || cellDepth < 0) {
    return null
  }

  var tableNode = $from.node(tableDepth)
  var tablePos = $from.before(tableDepth)
  var rowStartOffset = $from.before(rowDepth) - tablePos
  var rows = getTableRowsFromNode(tableNode)
  if (rows.length < 1) {
    return null
  }

  var rowIndex = -1
  for (var i = 0; i < rows.length; i += 1) {
    if (rows[i].startOffset === rowStartOffset) {
      rowIndex = i
      break
    }
  }
  if (rowIndex < 0) {
    var relativePos = $from.pos - tablePos
    for (var j = 0; j < rows.length; j += 1) {
      var start = rows[j].startOffset
      var end = start + rows[j].rowNode.nodeSize
      if (relativePos >= start && relativePos < end) {
        rowIndex = j
        break
      }
    }
  }
  if (rowIndex < 0) {
    return null
  }

  var rowMeta = rows[rowIndex]
  var colIndex = $from.index(rowDepth)
  if (!rowMeta.rowNode || rowMeta.rowNode.childCount < 1) {
    colIndex = 0
  } else if (colIndex < 0) {
    colIndex = 0
  } else if (colIndex >= rowMeta.rowNode.childCount) {
    colIndex = rowMeta.rowNode.childCount - 1
  }

  return {
    tableNode: tableNode,
    tablePos: tablePos,
    cellDepth: cellDepth,
    rowIndex: rowIndex,
    rowIndexInSection: rowMeta.rowIndexInSection,
    sectionType: rowMeta.sectionType,
    colIndex: colIndex
  }
}

// 为指定行列索引构造 TableContext（不依赖选区位置）：行列把手层用。
// cellDepth 无选区可依，占位 -1；现有 mutation 只读 rowIndex/colIndex。
export function getTableContextAt(tableNode: PMNode, tablePos: number, rowIndex: number, colIndex: number): TableContext | null {
  var rows = getTableRowsFromNode(tableNode)
  if (rows.length < 1 || rowIndex < 0 || rowIndex >= rows.length) {
    return null
  }

  var rowMeta = rows[rowIndex]
  var rowNode = rowMeta.rowNode
  var col = colIndex
  if (!rowNode || rowNode.childCount < 1) {
    col = 0
  } else if (col < 0) {
    col = 0
  } else if (col >= rowNode.childCount) {
    col = rowNode.childCount - 1
  }

  return {
    tableNode: tableNode,
    tablePos: tablePos,
    cellDepth: -1,
    rowIndex: rowIndex,
    rowIndexInSection: rowMeta.rowIndexInSection,
    sectionType: rowMeta.sectionType,
    colIndex: col
  }
}

// 是否位于表格最后一个单元格（最后一行最后一列）：
// Enter 在最后单元格触发新建一行；双空格退出规则同样以它判定。
export function isLastTableCell(state: EditorState, context?: TableContext | null): boolean {
  var tableContext = context || getTableContext(state)
  if (!tableContext || !tableContext.tableNode) {
    return false
  }
  var rows = getTableRowsFromNode(tableContext.tableNode)
  if (!rows.length || tableContext.rowIndex !== rows.length - 1) {
    return false
  }
  var lastRow = rows[rows.length - 1].rowNode
  if (!lastRow || lastRow.childCount < 1 || tableContext.colIndex !== lastRow.childCount - 1) {
    return false
  }
  return true
}

export function deleteSingleCellTableOnBackspace(state: EditorState, dispatch?: EditorDispatch) {
  if (!state.selection.empty) {
    return false
  }

  var context = getTableContext(state)
  if (!context || !context.tableNode || !Number.isInteger(context.cellDepth)) {
    return false
  }

  var $from = state.selection.$from
  var cellNode = $from.node(context.cellDepth)
  if (!cellNode || cellNode.content.size !== 0 || $from.parentOffset !== 0) {
    return false
  }

  var rows = getTableRowsFromNode(context.tableNode)
  if (rows.length !== 1) {
    return false
  }
  var onlyRow = rows[0].rowNode
  if (!onlyRow || onlyRow.childCount !== 1) {
    return false
  }

  if (!dispatch) {
    return true
  }

  var tr = state.tr.delete(context.tablePos, context.tablePos + context.tableNode.nodeSize)
  var selectionPos = Math.min(context.tablePos, tr.doc.content.size)
  tr = tr.setSelection(Selection.near(tr.doc.resolve(selectionPos), -1)).scrollIntoView()
  dispatch(tr)
  return true
}

// 行首 Backspace（光标在某行第一个单元格内容开头且该行不是表格首行）：
// 删除整行，光标落到上一行最后一个单元格。
// 不拦截时默认 joinBackward 会把两行在 row 层面 join，导致上一行多出本行的单元格。
export function deleteTableRowOnBackspace(state: EditorState, dispatch?: EditorDispatch): boolean {
  if (!state.selection.empty) {
    return false
  }
  var context = getTableContext(state)
  if (!context || !context.tableNode || !Number.isInteger(context.cellDepth)) {
    return false
  }
  // 首行不拦截（表格之上没有可合并目标）；非行首单元格的 Backspace 交给默认行为
  if (context.rowIndex < 1 || context.colIndex !== 0) {
    return false
  }
  var $from = state.selection.$from
  if ($from.parentOffset !== 0) {
    return false
  }

  var rows = getTableRowsFromNode(context.tableNode)
  var rowMeta = rows[context.rowIndex]
  var prevRowMeta = rows[context.rowIndex - 1]
  if (!rowMeta || !rowMeta.rowNode || !prevRowMeta || !prevRowMeta.rowNode) {
    return false
  }

  // 光标落在上一行最后一个单元格：上一行位于删除点之前，删除后位置不变
  var cursorPos = context.tablePos + getTableCellContentOffset(
    context.tableNode,
    context.rowIndex - 1,
    prevRowMeta.rowNode.childCount - 1
  )

  if (!dispatch) {
    return true
  }

  // table_head/table_body 要求至少一行：删的是所在 section 唯一行时，连同 section 一起删
  var sectionNode = $from.node(context.cellDepth - 2)
  var rowStart = context.tablePos + rowMeta.startOffset
  var tr = sectionNode && sectionNode.childCount === 1
    ? state.tr.delete(rowStart - 1, rowStart - 1 + sectionNode.nodeSize)
    : state.tr.delete(rowStart, rowStart + rowMeta.rowNode.nodeSize)
  tr = tr.setSelection(Selection.near(tr.doc.resolve(cursorPos))).scrollIntoView()
  dispatch(tr)
  return true
}

// 找 pos 所在 cell（table_cell / table_header）的深度：不在任何 cell 内返回 -1
function findCellDepth($pos: ResolvedPos): number {
  for (var depth = $pos.depth; depth >= 0; depth -= 1) {
    var node = $pos.node(depth)
    if (node && (node.type.name === "table_cell" || node.type.name === "table_header")) {
      return depth
    }
  }
  return -1
}

// 单元格删除守卫：绝不允许任何删除操作破坏 cell 网格（删掉单个 cell / 把
// 相邻 cell 合并成一个）。删除 cell 只能走结构命令（整行 / 整列 / 整表）。
// 拦截三类默认删除路径（baseKeymap 的 deleteSelection / joinBackward /
// joinForward / selectNodeBackward / selectNodeForward）：
// - NodeSelection 选中了单个 cell 节点（默认会删掉 cell 本身）→ 清空该
//   cell 的内容，保留 cell 节点，光标落进格内；
// - 非空选区两端在不同 cell（跨 cell 边界）→ 清空选区触及的所有 cell 的
//   内容，保留网格结构，光标落到最前触及的 cell；
// - 空选区位于 cell 内容边界（开头按 Backspace / 末尾按 Delete，默认会与
//   相邻 cell 合并或 selectNode* 选中相邻 cell）→ 吞掉（无操作）。
// 一端不在任何 cell 内（出表选区）时保守吞掉，不做任何改动。合法删除不受
// 影响：同一 cell 内的内容删除（cell 网格不变）、行首格 Backspace 整行
// 删除、单格表 Backspace 整表删除（守卫挂在它们之后）。
export function guardTableCellDeletion(state: EditorState, dispatch?: EditorDispatch, backward?: boolean): boolean {
  var selection = state.selection
  // NodeSelection 选中单个 cell 节点：清空其内容（保留 cell），光标落进格内
  if (selection instanceof NodeSelection) {
    var selectedNode = selection.node
    if (selectedNode && (selectedNode.type.name === "table_cell" || selectedNode.type.name === "table_header")) {
      if (dispatch) {
        var cellPos = selection.from
        var tr = state.tr.delete(cellPos + 1, cellPos + selectedNode.nodeSize - 1)
        tr.setSelection(Selection.near(tr.doc.resolve(cellPos + 1))).scrollIntoView()
        dispatch(tr)
      }
      return true
    }
    return false
  }
  var $from = selection.$from
  var $to = selection.$to
  var fromCellDepth = findCellDepth($from)
  // 起点不在 cell 内：与 cell 网格无关，放行（gapcursor / 表外光标等）
  if (fromCellDepth < 0) {
    return false
  }
  // 非空选区：同一 cell 内 → 正常删内容；一端不在 cell 内（出表）→ 保守
  // 吞掉；跨 cell 边界 → 清空触及的所有 cell 内容（保留网格）
  if (!selection.empty) {
    var toCellDepth = findCellDepth($to)
    if (toCellDepth < 0) {
      return true
    }
    if ($to.before(toCellDepth) === $from.before(fromCellDepth)) {
      return false
    }
    // 收集选区触及的所有 cell（nodesBetween 只报与选区相交的节点，部分
    // 交叠的首尾 cell 也包含在内），记录各自的内容区间 [start, end)
    var cellRanges: {start: number, end: number}[] = []
    state.doc.nodesBetween($from.pos, $to.pos, function (node, pos) {
      if (node.type.name === "table_cell" || node.type.name === "table_header") {
        cellRanges.push({start: pos + 1, end: pos + node.nodeSize - 1})
      }
      return true
    })
    if (dispatch) {
      var tr2 = state.tr
      // 倒序逐格删除内容：后面的先删，前面各区间的位置不被牵动
      for (var i = cellRanges.length - 1; i >= 0; i -= 1) {
        tr2.delete(cellRanges[i].start, cellRanges[i].end)
      }
      // 光标落到最前触及的 cell 开头（映射后定位）
      tr2.setSelection(Selection.near(tr2.doc.resolve(tr2.mapping.map(cellRanges[0].start)))).scrollIntoView()
      dispatch(tr2)
    }
    return true
  }
  // 空选区在 cell 内容边界（开头 / 末尾）：默认行为必然跨界，吞掉
  if (backward ? $from.parentOffset === 0 : $from.parentOffset === $from.parent.content.size) {
    return true
  }
  return false
}

// 表格最后一个单元格末尾连输两个空格：跳出表格，在表后新建空段落（与行内 mark 退出手势一致）。
// 触发时机是输入第二个空格：第一个空格已写入单元格，第二个尚未插入；
// 两个空格均为手势——已写入的第一个被删除，待输入的第二个被本规则消费，均不留在文档。
export function createExitTableCellRule(schema: Schema): InputRule | null {
  if (!schema.nodes.table || !schema.nodes.paragraph) {
    return null
  }
  var paragraphType = schema.nodes.paragraph
  return new InputRule(/[ \u00a0]{2}$/, function (state, match, start, end) {
    // 仅处理空选区下的单字符输入；非空选区替换交给默认行为
    if (start + 1 !== end) {
      return null
    }
    var $from = state.doc.resolve(end)
    if (!$from.parent.isTextblock) {
      return null
    }
    // 光标须在单元格内容末尾：单元格中间的双空格是普通文本
    if ($from.parentOffset !== $from.parent.content.size) {
      return null
    }
    var context = getTableContext(state)
    if (!context || !context.tableNode) {
      return null
    }
    // 仅最后一个单元格（最后一行最后一列）触发
    if (!isLastTableCell(state, context)) {
      return null
    }
    var tableEnd = context.tablePos + context.tableNode.nodeSize
    var $tableEnd = state.doc.resolve(tableEnd)
    if (!$tableEnd.parent.canReplaceWith($tableEnd.indexAfter(), $tableEnd.indexAfter(), paragraphType)) {
      return null
    }
    var tr = state.tr.delete(start, end)
    var paragraphPos = tr.mapping.map(tableEnd)
    tr = tr.insert(paragraphPos, paragraphType.create())
    return tr.setSelection(Selection.near(tr.doc.resolve(paragraphPos + 1))).scrollIntoView()
  })
}

export function moveTableCellSelection(state: EditorState, dispatch: EditorDispatch, direction: number) {
  if (!state.selection.empty) {
    return false
  }

  var context = getTableContext(state)
  if (!context || !context.tableNode) {
    return false
  }

  var rows = getTableRowsFromNode(context.tableNode)
  if (rows.length < 1 || context.rowIndex < 0 || context.rowIndex >= rows.length) {
    return true
  }

  var step = direction < 0 ? -1 : 1
  var targetRow = context.rowIndex
  var targetCol = context.colIndex + step

  if (step > 0) {
    var currentRowNode = rows[targetRow].rowNode
    var currentColCount = currentRowNode && currentRowNode.childCount ? currentRowNode.childCount : 0
    if (targetCol >= currentColCount) {
      targetRow += 1
      while (targetRow < rows.length) {
        var nextRowNode = rows[targetRow].rowNode
        if (nextRowNode && nextRowNode.childCount > 0) {
          break
        }
        targetRow += 1
      }
      if (targetRow >= rows.length) {
        // 已是最后一个单元格：Tab 跳出表格，光标落到表格之后
        if (!dispatch) {
          return true
        }
        var exitPos = Math.min(context.tablePos + context.tableNode.nodeSize, state.doc.content.size)
        dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(exitPos), 1)).scrollIntoView())
        return true
      }
      targetCol = 0
    }
  } else if (targetCol < 0) {
    targetRow -= 1
    while (targetRow >= 0) {
      var prevRowNode = rows[targetRow].rowNode
      if (prevRowNode && prevRowNode.childCount > 0) {
        break
      }
      targetRow -= 1
    }
    if (targetRow < 0) {
      return true
    }
    var targetRowNode = rows[targetRow].rowNode
    targetCol = targetRowNode.childCount - 1
  }

  var cursorPos = context.tablePos + getTableCellContentOffset(context.tableNode, targetRow, targetCol)
  if (!dispatch) {
    return true
  }
  var tr = state.tr.setSelection(Selection.near(state.doc.resolve(cursorPos))).scrollIntoView()
  dispatch(tr)
  return true
}

function cloneNodeJSON(node: PMNode): JSONNodeData {
  return JSON.parse(JSON.stringify(node.toJSON()))
}

function getNormalizedTableRows(sections: TableSections): TableRowJSONMeta[] {
  var rows: TableRowJSONMeta[] = []
  var headRows = sections && Array.isArray(sections.headRows) ? sections.headRows : []
  var bodyRows = sections && Array.isArray(sections.bodyRows) ? sections.bodyRows : []

  for (var i = 0; i < headRows.length; i += 1) {
    rows.push({
      row: headRows[i],
      sectionType: "table_head",
      rowIndexInSection: i
    })
  }
  for (var j = 0; j < bodyRows.length; j += 1) {
    rows.push({
      row: bodyRows[j],
      sectionType: "table_body",
      rowIndexInSection: j
    })
  }
  return rows
}

function getMaxTableColumns(tableJSON: JSONNodeData) {
  var rows = getTableRowsFromJSON(tableJSON)
  var maxCount = 0
  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i].row
    var cells = row && Array.isArray(row.content) ? row.content : []
    if (cells.length > maxCount) {
      maxCount = cells.length
    }
  }
  return maxCount
}

function createEmptyCellJSON(typeName: string): JSONNodeData {
  return {
    type: typeName || "table_cell",
    content: []
  }
}

function ensureRowCells(rowJSON: JSONNodeData, cellType: string) {
  if (!rowJSON || typeof rowJSON !== "object") {
    return
  }
  if (!Array.isArray(rowJSON.content)) {
    rowJSON.content = []
  }
  if (rowJSON.content.length < 1) {
    rowJSON.content.push(createEmptyCellJSON(cellType))
  }

  for (var cellIndex = 0; cellIndex < rowJSON.content.length; cellIndex += 1) {
    var cell = rowJSON.content[cellIndex]
    if (!cell || typeof cell !== "object") {
      rowJSON.content[cellIndex] = createEmptyCellJSON(cellType)
      continue
    }
    cell.type = cellType
    if (!Array.isArray(cell.content)) {
      cell.content = []
    }
  }
}

function normalizeTableJSONSections(tableJSON: JSONNodeData): TableSections {
  var rows = getTableRowsFromJSON(tableJSON)
  var headRows: JSONNodeData[] = []
  var bodyRows: JSONNodeData[] = []

  for (var i = 0; i < rows.length; i += 1) {
    var rowMeta = rows[i]
    if (!rowMeta.row) {
      continue
    }
    if (rowMeta.sectionType === "table_head") {
      ensureRowCells(rowMeta.row, "table_header")
      headRows.push(rowMeta.row)
    } else {
      ensureRowCells(rowMeta.row, "table_cell")
      bodyRows.push(rowMeta.row)
    }
  }

  if (headRows.length < 1) {
    if (bodyRows.length > 0) {
      var promoted = bodyRows.shift()
      if (!promoted) {
        return { headRows: [{ type: "table_row", content: [createEmptyCellJSON("table_header")] }], bodyRows: [] }
      }
      ensureRowCells(promoted, "table_header")
      headRows.push(promoted)
    } else {
      headRows.push({
        type: "table_row",
        content: [createEmptyCellJSON("table_header")]
      })
    }
  }

  return {
    headRows: headRows,
    bodyRows: bodyRows
  }
}

function setTableJSONSections(tableJSON: JSONNodeData, sections: TableSections) {
  var nextContent: JSONNodeData[] = [{
    type: "table_head",
    content: sections.headRows
  }]
  if (sections.bodyRows.length > 0) {
    nextContent.push({
      type: "table_body",
      content: sections.bodyRows
    })
  }
  tableJSON.content = nextContent
}

function getTableCellContentOffset(tableNode: PMNode, rowIndex: number, colIndex: number) {
  var rows = getTableRowsFromNode(tableNode)
  if (rows.length < 1) {
    return 1
  }

  var targetRow = rowIndex
  if (targetRow < 0) {
    targetRow = 0
  }
  if (targetRow >= rows.length) {
    targetRow = rows.length - 1
  }

  var rowMeta = rows[targetRow]
  var rowNode = rowMeta.rowNode
  if (!rowNode || rowNode.childCount < 1) {
    return rowMeta.startOffset + 1
  }

  var targetCol = colIndex
  if (targetCol < 0) {
    targetCol = 0
  }
  if (targetCol >= rowNode.childCount) {
    targetCol = rowNode.childCount - 1
  }

  var offset = rowMeta.startOffset + 1
  for (var col = 0; col < targetCol; col += 1) {
    offset += rowNode.child(col).nodeSize
  }
  offset += 1
  return offset
}

export function applyTableMutation(state: EditorState, dispatch: EditorDispatch, mutate: TableMutation) {
  var context = getTableContext(state)
  if (!context || typeof mutate !== "function") {
    return false
  }
  return applyTableMutationWithContext(state, dispatch, context, mutate)
}

// 行列把手层（table-handles.ts）不经过选区：直接为指定行列索引构造 context，
// 单事务完成结构替换 + 光标落位（避免 table-menu.tsx 那种先挪选区再跑命令的两步事务）。
export function applyTableMutationWithContext(
  state: EditorState,
  dispatch: EditorDispatch,
  context: TableContext,
  mutate: TableMutation
) {
  if (typeof mutate !== "function") {
    return false
  }

  var tableJSON = cloneNodeJSON(context.tableNode)
  var result = mutate(tableJSON, context)
  if (!result || result.ok !== true) {
    return false
  }

  var newTableNode
  try {
    newTableNode = state.schema.nodeFromJSON(tableJSON)
  } catch (error) {
    return false
  }
  if (!newTableNode || newTableNode.childCount < 1) {
    return false
  }

  if (!dispatch) {
    return true
  }

  var tr = state.tr.replaceWith(
    context.tablePos,
    context.tablePos + context.tableNode.nodeSize,
    newTableNode
  )
  var targetRow = typeof result.targetRow === "number" ? result.targetRow : context.rowIndex
  var targetCol = typeof result.targetCol === "number" ? result.targetCol : context.colIndex
  var cursorPos = context.tablePos + getTableCellContentOffset(newTableNode, targetRow, targetCol)
  tr = tr.setSelection(Selection.near(tr.doc.resolve(cursorPos))).scrollIntoView()
  dispatch(tr)
  return true
}

export function mutateTableAddRow(tableJSON: JSONNodeData, context: TableContext): TableMutationResult {
  var sections = normalizeTableJSONSections(tableJSON)
  var rows = getNormalizedTableRows(sections)
  if (rows.length < 1 || context.rowIndex < 0 || context.rowIndex >= rows.length) {
    return {ok: false}
  }

  var currentRow = rows[context.rowIndex]
  var baseRow = currentRow.row || {}
  var baseCells = Array.isArray(baseRow.content) ? baseRow.content : []
  var colCount = baseCells.length || getMaxTableColumns(tableJSON)
  if (colCount < 1) {
    colCount = 1
  }

  var newRowCells: JSONNodeData[] = []
  for (var col = 0; col < colCount; col += 1) {
    newRowCells.push(createEmptyCellJSON("table_cell"))
  }
  var newRow = {
    type: "table_row",
    content: newRowCells
  }

  var targetRow = context.rowIndex + 1
  if (currentRow.sectionType === "table_head") {
    sections.bodyRows.splice(0, 0, newRow)
    targetRow = sections.headRows.length
  } else {
    var bodyInsertIndex = currentRow.rowIndexInSection + 1
    sections.bodyRows.splice(bodyInsertIndex, 0, newRow)
    targetRow = sections.headRows.length + bodyInsertIndex
  }

  setTableJSONSections(tableJSON, sections)
  return {
    ok: true,
    targetRow: targetRow,
    targetCol: Math.min(context.colIndex, colCount - 1)
  }
}

// Enter 在最后单元格新建一行后，光标落到新行的第一个单元格。
export function mutateTableAddRowFirstCell(tableJSON: JSONNodeData, context: TableContext): TableMutationResult {
  var result = mutateTableAddRow(tableJSON, context)
  if (result.ok !== true) {
    return result
  }
  return {
    ok: true,
    targetRow: result.targetRow,
    targetCol: 0
  }
}

export function mutateTableAddColumn(tableJSON: JSONNodeData, context: TableContext): TableMutationResult {
  var sections = normalizeTableJSONSections(tableJSON)
  var rows = getNormalizedTableRows(sections)
  if (rows.length < 1) {
    return {ok: false}
  }

  var targetCol = context.colIndex + 1
  for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    var rowMeta = rows[rowIndex]
    var rowJSON = rowMeta.row
    if (!rowJSON || !Array.isArray(rowJSON.content)) {
      rowJSON.content = []
    }
    var cells = rowJSON.content
    var sampleCell = cells[Math.min(context.colIndex, Math.max(0, cells.length - 1))]
    var fallbackType = rowMeta.sectionType === "table_head" ? "table_header" : "table_cell"
    var cellType = sampleCell && sampleCell.type ? sampleCell.type : fallbackType
    var insertAt = Math.min(targetCol, cells.length)
    cells.splice(insertAt, 0, createEmptyCellJSON(cellType))
  }

  setTableJSONSections(tableJSON, sections)
  return {
    ok: true,
    targetRow: context.rowIndex,
    targetCol: targetCol
  }
}

export function mutateTableDeleteRow(tableJSON: JSONNodeData, context: TableContext): TableMutationResult {
  var sections = normalizeTableJSONSections(tableJSON)
  var rows = getNormalizedTableRows(sections)
  if (rows.length <= 1 || context.rowIndex < 0 || context.rowIndex >= rows.length) {
    return {ok: false}
  }

  var rowMeta = rows[context.rowIndex]
  if (!rowMeta) {
    return {ok: false}
  }

  if (rowMeta.sectionType === "table_head") {
    if (sections.headRows.length > 1) {
      sections.headRows.splice(rowMeta.rowIndexInSection, 1)
    } else if (sections.bodyRows.length > 0) {
      var promoted = sections.bodyRows.shift()
      if (!promoted) {
        return {ok: false}
      }
      ensureRowCells(promoted, "table_header")
      sections.headRows[0] = promoted
    } else {
      return {ok: false}
    }
  } else {
    sections.bodyRows.splice(rowMeta.rowIndexInSection, 1)
  }

  if (sections.headRows.length < 1) {
    if (sections.bodyRows.length < 1) {
      return {ok: false}
    }
    var fallbackHead = sections.bodyRows.shift()
    if (!fallbackHead) {
      return {ok: false}
    }
    ensureRowCells(fallbackHead, "table_header")
    sections.headRows.push(fallbackHead)
  }

  setTableJSONSections(tableJSON, sections)
  var nextRows = getNormalizedTableRows(sections)
  var targetRow = context.rowIndex
  if (targetRow >= nextRows.length) {
    targetRow = nextRows.length - 1
  }
  var targetRowNode = nextRows[targetRow] ? nextRows[targetRow].row : null
  var targetCells = targetRowNode && Array.isArray(targetRowNode.content) ? targetRowNode.content : []
  var targetCol = Math.min(context.colIndex, Math.max(0, targetCells.length - 1))

  return {
    ok: true,
    targetRow: targetRow,
    targetCol: targetCol
  }
}

export function mutateTableDeleteColumn(tableJSON: JSONNodeData, context: TableContext): TableMutationResult {
  var sections = normalizeTableJSONSections(tableJSON)
  var rows = getNormalizedTableRows(sections)
  if (rows.length < 1) {
    return {ok: false}
  }

  var maxCols = 0
  for (var row = 0; row < rows.length; row += 1) {
    var cells = (Array.isArray(rows[row].row.content) ? rows[row].row.content : []) as JSONNodeData[]
    if (cells.length > maxCols) {
      maxCols = cells.length
    }
  }
  if (maxCols <= 1) {
    return {ok: false}
  }

  for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    var rowMeta = rows[rowIndex]
    var rowCells = rowMeta.row && Array.isArray(rowMeta.row.content) ? rowMeta.row.content : []
    if (rowCells.length < 1) {
      rowMeta.row.content = [createEmptyCellJSON(rowMeta.sectionType === "table_head" ? "table_header" : "table_cell")]
      continue
    }
    var removeAt = Math.min(context.colIndex, rowCells.length - 1)
    rowCells.splice(removeAt, 1)
    if (rowCells.length < 1) {
      rowCells.push(createEmptyCellJSON(rowMeta.sectionType === "table_head" ? "table_header" : "table_cell"))
    }
  }

  setTableJSONSections(tableJSON, sections)
  var targetCol = context.colIndex
  if (targetCol >= maxCols - 1) {
    targetCol = maxCols - 2
  }
  if (targetCol < 0) {
    targetCol = 0
  }

  return {
    ok: true,
    targetRow: context.rowIndex,
    targetCol: targetCol
  }
}

export function createTableMoveColumnMutation(delta: number): TableMutation {
  return function (tableJSON: JSONNodeData, context: TableContext): TableMutationResult {
    var sections = normalizeTableJSONSections(tableJSON)
    var rows = getNormalizedTableRows(sections)
    if (rows.length < 1 || context.colIndex < 0) {
      return {ok: false}
    }

    var step = delta < 0 ? -1 : 1
    var targetCol = context.colIndex + step
    for (var checkIndex = 0; checkIndex < rows.length; checkIndex += 1) {
      var checkRow = rows[checkIndex].row
      var checkCells = checkRow && Array.isArray(checkRow.content) ? checkRow.content : []
      if (context.colIndex >= checkCells.length || targetCol < 0 || targetCol >= checkCells.length) {
        return {ok: false}
      }
    }

    for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      var swapRow = rows[rowIndex].row
      if (!Array.isArray(swapRow.content)) {
        continue
      }
      var rowCells = swapRow.content
      var movedCell = rowCells[context.colIndex]
      rowCells[context.colIndex] = rowCells[targetCol]
      rowCells[targetCol] = movedCell
    }

    setTableJSONSections(tableJSON, sections)
    return {
      ok: true,
      targetRow: context.rowIndex,
      targetCol: targetCol
    }
  }
}

export function createTableMoveRowMutation(delta: number): TableMutation {
  return function (tableJSON: JSONNodeData, context: TableContext): TableMutationResult {
    var sections = normalizeTableJSONSections(tableJSON)
    var rows = getNormalizedTableRows(sections)
    if (rows.length <= 1 || context.rowIndex < 0 || context.rowIndex >= rows.length) {
      return {ok: false}
    }

    var step = delta < 0 ? -1 : 1
    var targetRow = context.rowIndex + step
    if (targetRow < 0 || targetRow >= rows.length) {
      return {ok: false}
    }

    var movedRow = rows[context.rowIndex].row
    rows[context.rowIndex].row = rows[targetRow].row
    rows[targetRow].row = movedRow

    var headCount = sections.headRows.length
    var nextHeadRows: JSONNodeData[] = []
    var nextBodyRows: JSONNodeData[] = []
    for (var index = 0; index < rows.length; index += 1) {
      var rowJSON = rows[index].row
      if (!rowJSON) {
        return {ok: false}
      }
      if (index < headCount) {
        ensureRowCells(rowJSON, "table_header")
        nextHeadRows.push(rowJSON)
      } else {
        ensureRowCells(rowJSON, "table_cell")
        nextBodyRows.push(rowJSON)
      }
    }

    sections.headRows = nextHeadRows
    sections.bodyRows = nextBodyRows
    setTableJSONSections(tableJSON, sections)
    return {
      ok: true,
      targetRow: targetRow,
      targetCol: context.colIndex
    }
  }
}

// 拖拽行列把手：从 context.rowIndex（拖拽起点行）移动到绝对目标行 toIndex。
// 与 createTableMoveRowMutation（±1 相对步进）的差异只在目标行换算；
// 区段重建（headCount 保持 + ensureRowCells 跨界换单元格类型）与相对式完全一致，
// 因此跨表头/表体边界的语义（body 行升 head 时换成 table_header）保持不变。
export function createTableMoveRowToMutation(toIndex: number): TableMutation {
  return function (tableJSON: JSONNodeData, context: TableContext): TableMutationResult {
    var sections = normalizeTableJSONSections(tableJSON)
    var rows = getNormalizedTableRows(sections)
    var fromIndex = context.rowIndex
    if (rows.length <= 1 || fromIndex < 0 || fromIndex >= rows.length) {
      return {ok: false}
    }
    if (toIndex < 0 || toIndex >= rows.length || toIndex === fromIndex) {
      return {ok: false}
    }

    var movedMeta = rows.splice(fromIndex, 1)[0]
    rows.splice(toIndex, 0, movedMeta)

    var headCount = sections.headRows.length
    var nextHeadRows: JSONNodeData[] = []
    var nextBodyRows: JSONNodeData[] = []
    for (var index = 0; index < rows.length; index += 1) {
      var rowJSON = rows[index].row
      if (!rowJSON) {
        return {ok: false}
      }
      if (index < headCount) {
        ensureRowCells(rowJSON, "table_header")
        nextHeadRows.push(rowJSON)
      } else {
        ensureRowCells(rowJSON, "table_cell")
        nextBodyRows.push(rowJSON)
      }
    }

    sections.headRows = nextHeadRows
    sections.bodyRows = nextBodyRows
    setTableJSONSections(tableJSON, sections)
    return {
      ok: true,
      targetRow: toIndex,
      targetCol: context.colIndex
    }
  }
}

// 拖拽列把手：从 context.colIndex（拖拽起点列）移动到绝对目标列 toIndex。
// 每行独立 splice 再插入（与相对式的两两对换不同：整列平移），
// 锯齿行（短于 max(from,to)+1）时与相对式一致地拒绝操作。
export function createTableMoveColumnToMutation(toIndex: number): TableMutation {
  return function (tableJSON: JSONNodeData, context: TableContext): TableMutationResult {
    var sections = normalizeTableJSONSections(tableJSON)
    var rows = getNormalizedTableRows(sections)
    var fromIndex = context.colIndex
    if (rows.length < 1 || fromIndex < 0) {
      return {ok: false}
    }
    if (toIndex < 0 || toIndex === fromIndex) {
      return {ok: false}
    }

    for (var checkIndex = 0; checkIndex < rows.length; checkIndex += 1) {
      var checkRow = rows[checkIndex].row
      var checkCells = checkRow && Array.isArray(checkRow.content) ? checkRow.content : []
      if (fromIndex >= checkCells.length || toIndex >= checkCells.length) {
        return {ok: false}
      }
    }

    for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      var swapRow = rows[rowIndex].row
      if (!Array.isArray(swapRow.content)) {
        continue
      }
      var rowCells = swapRow.content
      var movedCell = rowCells.splice(fromIndex, 1)[0]
      rowCells.splice(toIndex, 0, movedCell)
    }

    setTableJSONSections(tableJSON, sections)
    return {
      ok: true,
      targetRow: context.rowIndex,
      targetCol: toIndex
    }
  }
}