// 段落块菜单：注册到 block-menu 核心（decoration widget 悬浮在块左侧，
// hover 块时显示 H1-H6 切换面板，"正文"为当前项）。菜单构建逻辑与 heading-menu
// 共用 buildBlockTypeMenuDom，此处只负责正文段落匹配与 setBlockType 交互；
// 单图段落由 image-rhythm 的图片菜单接管，不在此匹配。
import { NodeType, Schema } from "prosemirror-model"
import { BlockMenuRegistration } from "./block-menu"
import { buildBlockTypeMenuDom } from "./heading-menu"
import { deleteBlockAt } from "./prosemirror-helpers"
import { isImageOnlyParagraph } from "./image-rhythm"

export function createParagraphMenuRegistration(schema: Schema): BlockMenuRegistration | null {
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
      return node.type === paragraphType && !isImageOnlyParagraph(node)
    },
    buildMenu: function (ctx) {
      var node = ctx.node
      var from = ctx.pos
      var to = ctx.pos + node.nodeSize
      // 删除整块（重读防竞态 + 空文档兜底 + 光标落位，见 prosemirror-helpers）
      function deleteNodeAt() {
        deleteBlockAt(ctx, function (current) {
          return current.type === paragraphType
        }, schema)
      }
      // 文档仅剩此一个段落时删除会被空文档兜底重置为空段落（等于纯清空），
      // 对这种"不可真正删除"的块不提供删除按钮。用 ctx.doc（decorations 计算
      // 时的快照）判断：菜单 widget 每次事务都会重建（block-menu 的 toDOM
      // 每次都是新闭包，WidgetType.eq 恒为 false），此判断随文档变化自动生效；
      // 不能用 ctx.view——首次构建 widget 时 viewRef 尚为 null
      var docIsSingleBlock = ctx.doc.childCount === 1
      return buildBlockTypeMenuDom(
        null,
        function (next) {
          var selectView = ctx.view
          if (!selectView) {
            return
          }
          var tr = selectView.state.tr.setBlockType(
            from,
            to,
            next == null ? paragraphType : headingType,
            next == null ? undefined : {level: next}
          )
          selectView.dispatch(tr.scrollIntoView())
          selectView.focus()
        },
        docIsSingleBlock ? undefined : deleteNodeAt
      )
    }
  }
}