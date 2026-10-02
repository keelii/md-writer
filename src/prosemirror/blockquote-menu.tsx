// 引用块 DecoMenu：hover 顶层 blockquote 时在块左侧挂 dropdown
// （引用 icon 主按钮 + 下拉面板），提供「转为正文」+ 删除引用，形态/互斥由 block-op-menu.tsx 提供。
//
// 锚点形态：blockquote 是复合块（DOM 为 blockquote > p），块内锚点渲染进
// 段落子树、不是来源块 DOM 的直接子元素，hover 选择器无法命中，与列表/表格一致锚在块前。
//
// 「转为正文」与命令层 blockquote 命令的 lift 分支语义一致（commands.ts）：
// 去掉引用层、子块上提为文档顶层普通块（段落等）。实现直接 replaceWith 引用内容——
// hover 场景光标通常不在引用内，选区驱动的命令无法保证按节点整体作用，直接
// 按目标节点展开，嵌套引用/引用内列表同样整体上提。
//
// markdown 兼容：仅去掉引用标记，内容仍为标准块，序列化由 prosemirror-markdown 负责。
import { Node as PMNode, Schema } from "prosemirror-model"
import { Selection } from "prosemirror-state"
import { SvgIcon } from "../icons"
import { BlockMenuContext, BlockMenuRegistration } from "./block-menu"
import { BlockOpMenuItem, buildBlockOpMenuDom } from "./block-op-menu"
import { reloadBlockAt, deleteBlockAt } from "./prosemirror-helpers"

// 按当前 doc 重读节点（pos 来自 decoration 重算，避免边界竞态操作错块）
function isBlockquote(node: PMNode): boolean {
  return node.type.name === "blockquote"
}

function unwrapBlockquoteAt(ctx: BlockMenuContext) {
  var view = ctx.view
  if (!view) {
    return
  }
  var current = reloadBlockAt(ctx, isBlockquote)
  if (!current) {
    return
  }
  var tr = view.state.tr.replaceWith(ctx.pos, ctx.pos + current.nodeSize, current.content)
  tr = tr.setSelection(Selection.near(tr.doc.resolve(Math.min(ctx.pos + 1, tr.doc.content.size)), 1)).scrollIntoView()
  view.dispatch(tr)
  view.focus()
}

export function createBlockquoteMenuRegistration(schema: Schema): BlockMenuRegistration | null {
  if (!schema.nodes.blockquote) {
    return null
  }
  return {
    anchorInside: false,
    matches: function (node: PMNode, parent: PMNode) {
      return parent.type.name === "doc" && node.type.name === "blockquote"
    },
    buildMenu: function (ctx: BlockMenuContext) {
      var items: BlockOpMenuItem[] = [
        {
          label: "正文",
          icon: SvgIcon.pilcrow,
          showLabel: true,
          run: function () {
            unwrapBlockquoteAt(ctx)
          }
        },
        {
          label: "删除",
          icon: SvgIcon.trash,
          showLabel: true,
          run: function () {
            deleteBlockAt(ctx, isBlockquote, schema)
          }
        }
      ]
      return buildBlockOpMenuDom("md-editor-blockquote-menu", items, {
        toggleIcon: SvgIcon.quote,
        toggleTitle: "引用块操作"
      })
    }
  }
}