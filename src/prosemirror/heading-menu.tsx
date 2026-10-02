// 标题块菜单：注册到 block-menu 核心（decoration widget 悬浮在块左侧，
// hover 块时显示 H1-H6 切换面板）。锚定/显隐/外部点击关闭等通用能力见 block-menu.ts，
// 此处只负责标题匹配与 setBlockType 交互；正文段落见 paragraph-menu.tsx。
import { Node as PMNode, NodeType, Schema } from "prosemirror-model"
import { SvgIcon } from "../icons"
import { BlockMenuRegistration } from "./block-menu"
import { BlockOpMenuItem, buildBlockOpMenuDom } from "./block-op-menu"
import { deleteBlockAt } from "./prosemirror-helpers"

export function buildBlockTypeMenuDom(
  activeValue: number | null,
  onSelect: (next: number | null) => void,
  // 文档仅剩唯一顶层块时传 undefined 省略删除项（见 paragraph-menu）
  onDelete?: () => void
): HTMLElement {
  var options: Array<{label: string, value: number | null}> = [
    {label: "", value: null},
    {label: "H1", value: 1},
    {label: "H2", value: 2},
    {label: "H3", value: 3},
    {label: "H4", value: 4},
    {label: "H5", value: 5},
    {label: "H6", value: 6}
  ]
  var items: BlockOpMenuItem[] = options.filter(function (option) {
    return activeValue !== null || option.value !== null
  }).map(function (option) {
    return {
      label: option.label,
      icon: option.value === null ? SvgIcon.pilcrow : undefined,
      showLabel: option.value === null,
      active: option.value === activeValue,
      run: function () { onSelect(option.value) }
    }
  })
  if (onDelete) {
    items.push({label: "删除", icon: SvgIcon.trash, divider: true, run: onDelete})
  }
  return buildBlockOpMenuDom("md-editor-heading-menu", items, activeValue === null
    ? {toggleIcon: SvgIcon.pilcrow, toggleTitle: "段落操作"}
    : {toggleLabel: "H" + activeValue, toggleTitle: "标题操作"})
}

function headingLevelFromNode(node: PMNode): number {
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
    matches: function (node, parent) {
      if (parent.type.name !== "doc") {
        return false
      }
      return node.type === headingType
    },
    buildMenu: function (ctx) {
      var node = ctx.node
      var level = headingLevelFromNode(node)
      var from = ctx.pos
      var to = ctx.pos + node.nodeSize
      // 删除整块（重读防竞态 + 空文档兜底 + 光标落位，见 prosemirror-helpers）
      function deleteNodeAt() {
        deleteBlockAt(ctx, function (current: PMNode) {
          return current.type === headingType
        }, schema)
      }
      return buildBlockTypeMenuDom(
        level,
        function (next) {
          var view = ctx.view
          if (!view) {
            return
          }
          var tr = view.state.tr.setBlockType(
            from,
            to,
            next == null ? paragraphType : headingType,
            next == null ? undefined : {level: next}
          )
          view.dispatch(tr.scrollIntoView())
          view.focus()
        },
        deleteNodeAt
      )
    }
  }
}