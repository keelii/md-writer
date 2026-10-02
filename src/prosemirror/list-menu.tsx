// 列表 DecoMenu：hover 顶层 bullet_list / ordered_list 时在块左侧挂 dropdown
// （主按钮显示当前列表类型 icon + 下拉面板），提供有序/无序切换 + 删除列表，形态/互斥由 block-op-menu.tsx 提供。
//
// 锚点形态：列表是复合块（DOM 为 ul/ol > li），块内锚点渲染进 li 子树、
// 不是来源块 DOM 的直接子元素，hover 选择器无法命中，与表格一致锚在块前。
//
// 切换实现与命令层 createListCommand 的就地转换分支同构（commands.ts）：
// replaceWith 只换节点类型、保留 attrs（tight）与内容，两种列表 nodeSize 相同，
// 光标位置不受影响。hover 场景光标通常不在列表内，选区驱动的命令无法保证
// 按节点整体作用（嵌套列表边界只转内层），故直接按目标节点作用。
//
// markdown 兼容：仅互换标准列表类型，序列化仍由 prosemirror-markdown 负责。
import { Node as PMNode, Schema } from "prosemirror-model"
import { SvgIcon } from "../icons"
import { BlockMenuContext, BlockMenuRegistration } from "./block-menu"
import { BlockOpMenuItem, buildBlockOpMenuDom } from "./block-op-menu"
import { reloadBlockAt, deleteBlockAt } from "./prosemirror-helpers"

function isListNode(node: PMNode | null | undefined): node is PMNode {
  return !!node && (node.type.name === "bullet_list" || node.type.name === "ordered_list")
}

// 按当前 doc 重读节点（pos 来自 decoration 重算，避免边界竞态操作错块）
function switchListTypeAt(ctx: BlockMenuContext, schema: Schema) {
  var view = ctx.view
  if (!view) {
    return
  }
  var current = reloadBlockAt(ctx, isListNode)
  if (!current) {
    return
  }
  var targetType = current.type.name === "bullet_list" ? schema.nodes.ordered_list : schema.nodes.bullet_list
  if (!targetType) {
    return
  }
  view.dispatch(
    view.state.tr.replaceWith(ctx.pos, ctx.pos + current.nodeSize, targetType.create(current.attrs, current.content))
  )
  view.focus()
}

export function createListMenuRegistration(schema: Schema): BlockMenuRegistration | null {
  if (!schema.nodes.bullet_list || !schema.nodes.ordered_list) {
    return null
  }
  return {
    anchorInside: false,
    matches: function (node: PMNode, parent: PMNode) {
      return parent.type.name === "doc" && isListNode(node)
    },
    buildMenu: function (ctx: BlockMenuContext) {
      var isBullet = ctx.node.type.name === "bullet_list"
      var items: BlockOpMenuItem[] = [
        {
          label: isBullet ? "有序" : "无序",
          icon: isBullet ? SvgIcon.listOrdered : SvgIcon.list,
          showLabel: true,
          run: function () {
            switchListTypeAt(ctx, schema)
          }
        },
        {
          label: "删除",
          icon: SvgIcon.trash,
          showLabel: true,
          run: function () {
            deleteBlockAt(ctx, isListNode, schema)
          }
        }
      ]
      return buildBlockOpMenuDom("md-editor-list-menu", items, {
        toggleIcon: isBullet ? SvgIcon.list : SvgIcon.listOrdered,
        toggleTitle: isBullet ? "无序列表操作" : "有序列表操作"
      })
    }
  }
}