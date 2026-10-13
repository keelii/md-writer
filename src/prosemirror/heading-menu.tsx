// 标题块菜单：注册到 block-menu 核心（decoration widget 悬浮在块左侧，
// hover 块时显示 H1-H6 切换面板）。锚定/显隐/外部点击关闭等通用能力见 block-menu.ts，
// 此处只负责标题匹配与面板项组装；正文段落见 paragraph-menu.tsx
// （类型面板两文件各自独立构建，不共用构建器；setBlockType/deleteBlockAt
//   等操作函数统一收敛在 prosemirror-helpers）。
import { Node as PMNode, NodeType, Schema } from "prosemirror-model"
import { SvgIcon } from "../icons"
import { BlockMenuRegistration } from "./block-menu"
import { BlockOpMenuItem, buildBlockOpMenuDom } from "./block-op-menu"
import {
  createHeadingMenuItem,
  deleteBlockAt,
  switchBlockTypeAt
} from "./prosemirror-helpers"

var headingLevelFromNode = (node: PMNode): number => {
  var level = Number(node.attrs.level)
  if (!(level >= 1 && level <= 6)) {
    return 1
  }
  return level
}

export function createHeadingMenuRegistration(schema: Schema): BlockMenuRegistration | null {
  if (!schema.nodes.heading || !schema.nodes.paragraph) {
    return null
  }
  var headingType: NodeType = schema.nodes.heading
  var paragraphType: NodeType = schema.nodes.paragraph

  return {
    // 文本块：widget 锚在块内容首位，渲染为块第一个子元素
    anchorInside: true,
    matches: (node, parent) => {
      if (parent.type.name !== "doc") {
        return false
      }
      return node.type === headingType
    },
    buildMenu: (ctx) => {
      var node = ctx.node
      var level = headingLevelFromNode(node)
      // 删除整块（重读防竞态 + 空文档兜底 + 光标落位，见 prosemirror-helpers）
      var deleteNodeAt = () =>
        deleteBlockAt(ctx, (current: PMNode) => current.type === headingType, schema)
      // 面板项：转为正文（pilcrow 图标，无可读文字；null 转正文、1-6 切级别，
      // setBlockType 事务 + 重读防竞态见 prosemirror-helpers）+ H1-H6（当前级别
      // 高亮），尾随「删除标题」项（前置分组分隔线）
      var isTargetHeading = (current: PMNode) => current.type === headingType
      var items: BlockOpMenuItem[] = [
        {label: "段落正文", icon: SvgIcon.pilcrow, showLabel: true, run: () => {
          switchBlockTypeAt(ctx, isTargetHeading, paragraphType)
        }},
        ...createHeadingMenuItem(level, (idx: number) =>
          switchBlockTypeAt(ctx, isTargetHeading, headingType, idx)
        ),
        {label: "删除标题", icon: SvgIcon.trash, showLabel: true, divider: true, run: deleteNodeAt}
      ]
      return buildBlockOpMenuDom("md-editor-heading-menu", items, {toggleLabel: "H" + level, toggleTitle: "标题操作"})
    }
  }
}