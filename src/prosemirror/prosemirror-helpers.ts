// DecoMenu 共享操作 helper：各块菜单（heading/paragraph/list/blockquote/
// code-block/table/image/node-op-menu）重复的「按当前 doc 重读节点」与
// 「删除整块」逻辑收敛于此，菜单文件只保留各自的节点匹配与文档变换。
//
// 背景：菜单 DOM 由 Decoration.widget 承载，ctx.pos 来自最近一次 decoration
// 重算，点击时可能已过期（重绘/竞态）。统一约定：操作前按当前 doc 重读节点，
// 类型不符（或内容已变）即放弃动作，不操作错块。
import { Node as PMNode, NodeType, Schema } from "prosemirror-model"
import { Selection } from "prosemirror-state"
import { BlockMenuContext } from "./block-menu"
import {SvgIcon} from "../icons";

// 按当前 doc 重读 ctx.pos 处节点并用 matches 校验；view 未就绪、位置错位或
// 校验不通过返回 null，调用方直接放弃操作。
export const reloadBlockAt = (ctx: BlockMenuContext, matches: (node: PMNode) => boolean): PMNode | null => {
  var view = ctx.view
  if (!view) {
    return null
  }
  var current = view.state.doc.nodeAt(ctx.pos)
  if (!current || !matches(current)) {
    return null
  }
  return current
}

// 删除整块（各菜单 deleteNodeAt / deleteListAt / ... 的统一实现）：
// - 传入 schema 时，文档仅剩此块则 replaceWith 空段落，避免产生空 doc；
// - 其余情况 tr.delete 整块 + 光标 Selection.near 落位（向前收敛）；
// - 重读校验失败（竞态错块）不动作。返回是否执行了删除。
export const deleteBlockAt = (ctx: BlockMenuContext, matches: (node: PMNode) => boolean, schema?: Schema): boolean => {
  var view = ctx.view
  if (!view) {
    return false
  }
  var current = reloadBlockAt(ctx, matches)
  if (!current) {
    return false
  }
  var tr = view.state.tr
  var paragraphType = schema ? schema.nodes.paragraph : null
  if (view.state.doc.childCount <= 1 && paragraphType) {
    tr = tr.replaceWith(ctx.pos, ctx.pos + current.nodeSize, paragraphType.create())
  } else {
    tr = tr.delete(ctx.pos, ctx.pos + current.nodeSize)
    tr = tr.setSelection(Selection.near(tr.doc.resolve(Math.min(ctx.pos, tr.doc.content.size)), -1))
  }
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

// 块类型切换（heading-menu 的 selectLevel 与 paragraph-menu 的
// switchToHeading 的统一实现）：targetType 为切换目标（上游按意图直接传
// paragraph 还是 heading），level 非空时作为目标节点的 level attrs。
// 与 deleteBlockAt 同约定：按当前 doc 重读校验（竞态错块不动作），光标滚动落位。
export const switchBlockTypeAt = (
  ctx: BlockMenuContext,
  matches: (node: PMNode) => boolean,
  targetType: NodeType,
  level?: number | null
): boolean => {
  var view = ctx.view
  if (!view) {
    return false
  }
  var current = reloadBlockAt(ctx, matches)
  if (!current) {
    return false
  }
  var tr = view.state.tr.setBlockType(
    ctx.pos,
    ctx.pos + current.nodeSize,
    targetType,
    level == null ? undefined : {level: level}
  )
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

export function createHeadingMenuItem(level: number, exec: (n: number) => void) {
  return ["一", "二", "三", "四", "五", "六"].map((lv, idx) => {
    return {
      label: lv + "级标题",
      showLabel: true,
      active: level === idx + 1,
      icon: SvgIcon[`h${idx + 1}`],
      run: () => {
        exec(idx + 1)
      }
    }
  })
}