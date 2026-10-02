import { Mark, MarkType, Node as PMNode, NodeType, ResolvedPos, Schema } from "prosemirror-model"
import { EditorState } from "prosemirror-state"
import { lift, toggleMark, wrapIn } from "prosemirror-commands"
import { redo, undo } from "prosemirror-history"
import { wrapInList } from "prosemirror-schema-list"
import { EditorCommand, TableMutation } from "../types"
import { isPreviewBlock } from "./nodeviews/kinds"
import { applyTableMutation, createTableMoveColumnMutation, createTableMoveRowMutation, insertDefaultTableNode, mutateTableAddColumn, mutateTableAddRow, mutateTableDeleteColumn, mutateTableDeleteRow } from "./table"

function isMarkActive(state: EditorState, markType: MarkType) {
  var selection = state.selection
  if (selection.empty) {
    var stored = state.storedMarks
    if (stored && markType.isInSet(stored)) {
      return true
    }
    return markType.isInSet(selection.$from.marks()) != null
  }
  return state.doc.rangeHasMark(selection.from, selection.to, markType)
}

function hasAncestorNodeType($pos: ResolvedPos, nodeType: NodeType) {
  for (var depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type === nodeType) {
      return true
    }
  }
  return false
}

function findDeepestAncestorDepth($pos: ResolvedPos, nodeType: NodeType) {
  for (var depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type === nodeType) {
      return depth
    }
  }
  return -1
}

function isNodeTypeActive(state: EditorState, nodeType: NodeType) {
  var selection = state.selection
  return hasAncestorNodeType(selection.$from, nodeType) || hasAncestorNodeType(selection.$to, nodeType)
}

export function getActiveLinkMark(state: EditorState, linkMarkType: MarkType): Mark | null {
  var selection = state.selection
  if (!selection.empty) {
    var found: Mark | null = null
    state.doc.nodesBetween(selection.from, selection.to, function (node: PMNode) {
      if (found || node.marks.length === 0) {
        return
      }
      found = linkMarkType.isInSet(node.marks) || null
    })
    return found
  }
  return linkMarkType.isInSet(selection.$from.marks()) || null
}

export function getLinkMarkRangeAtCursor(state: EditorState, linkMarkType: MarkType) {
  var $from = state.selection.$from
  var parent = $from.parent
  var offset = $from.parentOffset
  var base = $from.start()

  // 光标所在（中间）或紧随其后（开头边界）的 child；末尾边界时回退到前一个 child
  var anchor = parent.childAfter(offset)
  if (!anchor.node || !linkMarkType.isInSet(anchor.node.marks)) {
    anchor = parent.childBefore(offset)
  }
  if (!anchor.node || !linkMarkType.isInSet(anchor.node.marks)) {
    return null
  }

  var mark = linkMarkType.isInSet(anchor.node.marks)
  if (!mark) {
    return null
  }
  var startIndex = anchor.index
  var startPos = base + anchor.offset
  while (startIndex > 0 && mark.isInSet(parent.child(startIndex - 1).marks)) {
    startIndex -= 1
    startPos -= parent.child(startIndex).nodeSize
  }

  var endIndex = anchor.index + 1
  var endPos = startPos + parent.child(anchor.index).nodeSize
  while (endIndex < parent.childCount && mark.isInSet(parent.child(endIndex).marks)) {
    endPos += parent.child(endIndex).nodeSize
    endIndex += 1
  }

  return {from: startPos, to: endPos}
}

export function normalizeCommandName(name: string | null | undefined) {
  return (name || "").trim()
}

export function isCommandActive(schema: Schema, name: string | null | undefined, state: EditorState) {
  var cmd = normalizeCommandName(name)
  switch (cmd) {
    case "bold":
      return isMarkActive(state, schema.marks.strong)
    case "italic":
      return isMarkActive(state, schema.marks.em)
    case "strike":
      return isMarkActive(state, schema.marks.strike)
    case "inline_code":
      return isMarkActive(state, schema.marks.code)
    case "link":
      return isMarkActive(state, schema.marks.link)
    case "blockquote":
      return isNodeTypeActive(state, schema.nodes.blockquote)
    case "bullet_list":
      return isNodeTypeActive(state, schema.nodes.bullet_list)
    case "ordered_list":
      return isNodeTypeActive(state, schema.nodes.ordered_list)
    default:
      return false
  }
}

// 列表命令：光标在相反类型列表中时就地转换列表类型（保留内容与光标），否则回退为 wrapInList 包裹
function createListCommand(listType: NodeType, oppositeType: NodeType | undefined): EditorCommand {
  return function (state, dispatch, view) {
    if (oppositeType) {
      var selection = state.selection
      var fromDepth = findDeepestAncestorDepth(selection.$from, oppositeType)
      var toDepth = findDeepestAncestorDepth(selection.$to, oppositeType)
      if (fromDepth > 0 || toDepth > 0) {
        if (typeof dispatch !== "function") {
          return true
        }
        var tr = state.tr
        // 两种列表 attrs 不同但 nodeSize 相同（content 一致），多个位置转换互不偏移
        if (fromDepth > 0) {
          var fromNode = selection.$from.node(fromDepth)
          var fromPos = selection.$from.before(fromDepth)
          // 保留原 attrs（tight/order），多余 attr 由 NodeType.create 自动过滤
          tr.replaceWith(fromPos, fromPos + fromNode.nodeSize, listType.create(fromNode.attrs, fromNode.content))
        }
        if (toDepth > 0 && toDepth !== fromDepth) {
          var toNode = selection.$to.node(toDepth)
          var toPos = selection.$to.before(toDepth)
          tr.replaceWith(toPos, toPos + toNode.nodeSize, listType.create(toNode.attrs, toNode.content))
        }
        dispatch(tr.scrollIntoView())
        return true
      }
    }
    return wrapInList(listType)(state, dispatch, view)
  }
}

function createBlockquoteCommand(blockquote: NodeType): EditorCommand {
  return function (state, dispatch, view) {
    var selection = state.selection
    if (hasAncestorNodeType(selection.$from, blockquote) && hasAncestorNodeType(selection.$to, blockquote)) {
      return lift(state, dispatch, view)
    }
    return wrapIn(blockquote)(state, dispatch, view)
  }
}

function createTableInsertCommand(schema: Schema): EditorCommand {
  return function (state, dispatch, view) {
    if (typeof dispatch !== "function") {
      return true
    }
    if (!view) {
      return false
    }
    return insertDefaultTableNode(view, schema)
  }
}

function createTableMutationCommand(mutate: TableMutation): EditorCommand {
  return function (state, dispatch) {
    return applyTableMutation(state, dispatch, mutate)
  }
}

// 链接命令（纯）：编辑已有链接 —— 清除 range 上的旧 link mark 后应用新 href
export function createLinkEditCommand(link: MarkType, range: {from: number, to: number}, href: string): EditorCommand {
  return function (state, dispatch) {
    if (typeof dispatch !== "function") {
      return true
    }
    var mark = link.create({href: href, title: null})
    var tr = state.tr.removeMark(range.from, range.to, link)
    tr.addMark(range.from, range.to, mark)
    dispatch(tr.scrollIntoView())
    return true
  }
}

// 链接命令（纯）：移除 range 上的 link mark
export function createLinkRemoveCommand(link: MarkType, range: {from: number, to: number}): EditorCommand {
  return function (state, dispatch) {
    if (typeof dispatch !== "function") {
      return true
    }
    dispatch(state.tr.removeMark(range.from, range.to, link).scrollIntoView())
    return true
  }
}

// 链接命令（纯）：新建链接 —— 选区非空时对选区应用 mark；空选区时插入 href 文本并应用 mark
export function createLinkApplyCommand(link: MarkType, from: number, to: number, href: string): EditorCommand {
  return function (state, dispatch) {
    if (typeof dispatch !== "function") {
      return true
    }
    var mark = link.create({href: href, title: null})
    if (from < to) {
      dispatch(state.tr.addMark(from, to, mark).scrollIntoView())
      return true
    }
    var tr = state.tr.insertText(href, from, to)
    tr.addMark(from, from + href.length, mark)
    dispatch(tr.scrollIntoView())
    return true
  }
}

// 图片命令（纯）：以给定 attrs 在选区处插入图片节点
export function createImageInsertCommand(schema: Schema, attrs: { src: string; alt?: string | null; title?: string | null }): EditorCommand {
  return function (state, dispatch) {
    var image = schema.nodes.image
    if (!image || !attrs || !attrs.src) {
      return false
    }
    if (typeof dispatch !== "function") {
      return true
    }
    var node = image.create({
      src: attrs.src,
      alt: attrs.alt || "",
      title: attrs.title == null ? null : attrs.title
    })
    dispatch(state.tr.replaceSelectionWith(node).scrollIntoView())
    return true
  }
}

// 预览块源码替换命令：替换 raw_block / mermaid code_block 的 text* 内容
// （[pos+1, pos+nodeSize-1]）。pos 由 Action 在 dialog 关闭后传入，命令内部
// 按最新 state 重读校验（dialog 打开期间文档可能已变化），类型不符不动作。
// 内容不变时跳过 dispatch，不产生空历史记录。
export function createPreviewSourceReplaceCommand(pos: number, source: string): EditorCommand {
  return function (state, dispatch) {
    var node = state.doc.nodeAt(pos)
    if (!node || !isPreviewBlock(node)) {
      return false
    }
    if (typeof dispatch !== "function") {
      return true
    }
    if (node.textContent === source) {
      return true
    }
    var tr = state.tr
    if (source) {
      tr = tr.replaceWith(pos + 1, pos + node.nodeSize - 1, state.schema.text(source))
    } else {
      tr = tr.delete(pos + 1, pos + node.nodeSize - 1)
    }
    dispatch(tr)
    return true
  }
}

// 纯命令注册表：只收录 (state, dispatch?) => boolean 的同步命令；带 Dialog 的产品交互见 actions.ts
export function commandByName(schema: Schema, name: string | null | undefined): EditorCommand | null {
  var commandName = normalizeCommandName(name)
  var strong = schema.marks.strong
  var em = schema.marks.em
  var code = schema.marks.code
  var strike = schema.marks.strike
  var blockquote = schema.nodes.blockquote
  var bulletList = schema.nodes.bullet_list
  var orderedList = schema.nodes.ordered_list

  var simpleCommands: Record<string, EditorCommand | null> = {
    bold: strong ? toggleMark(strong) : null,
    italic: em ? toggleMark(em) : null,
    inline_code: code ? toggleMark(code) : null,
    strike: strike ? toggleMark(strike) : null,
    bullet_list: bulletList ? createListCommand(bulletList, orderedList) : null,
    ordered_list: orderedList ? createListCommand(orderedList, bulletList) : null,
    undo: undo,
    redo: redo
  }

  if (Object.prototype.hasOwnProperty.call(simpleCommands, commandName)) {
    return simpleCommands[commandName]
  }

  switch (commandName) {
    case "blockquote":
      return blockquote ? createBlockquoteCommand(blockquote) : null
    case "table_insert":
      return createTableInsertCommand(schema)
    case "table_add_row":
      return createTableMutationCommand(mutateTableAddRow)
    case "table_add_column":
      return createTableMutationCommand(mutateTableAddColumn)
    case "table_delete_row":
      return createTableMutationCommand(mutateTableDeleteRow)
    case "table_delete_column":
      return createTableMutationCommand(mutateTableDeleteColumn)
    case "table_move_row_up":
      return createTableMutationCommand(createTableMoveRowMutation(-1))
    case "table_move_row_down":
      return createTableMutationCommand(createTableMoveRowMutation(1))
    case "table_move_column_left":
      return createTableMutationCommand(createTableMoveColumnMutation(-1))
    case "table_move_column_right":
      return createTableMutationCommand(createTableMoveColumnMutation(1))
    default:
      return null
  }
}
