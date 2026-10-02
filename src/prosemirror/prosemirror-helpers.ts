// DecoMenu 共享操作 helper：各块菜单（heading/paragraph/list/blockquote/
// code-block/table/image/node-op-menu）重复的「按当前 doc 重读节点」与
// 「删除整块」逻辑收敛于此，菜单文件只保留各自的节点匹配与文档变换。
//
// 背景：菜单 DOM 由 Decoration.widget 承载，ctx.pos 来自最近一次 decoration
// 重算，点击时可能已过期（重绘/竞态）。统一约定：操作前按当前 doc 重读节点，
// 类型不符（或内容已变）即放弃动作，不操作错块。
import { Node as PMNode, Schema } from "prosemirror-model"
import { Selection } from "prosemirror-state"
import { BlockMenuContext } from "./block-menu"

// 按当前 doc 重读 ctx.pos 处节点并用 matches 校验；view 未就绪、位置错位或
// 校验不通过返回 null，调用方直接放弃操作。
export function reloadBlockAt(ctx: BlockMenuContext, matches: (node: PMNode) => boolean): PMNode | null {
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
export function deleteBlockAt(ctx: BlockMenuContext, matches: (node: PMNode) => boolean, schema?: Schema): boolean {
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