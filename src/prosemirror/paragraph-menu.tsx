// 段落块菜单：注册到 block-menu 核心（decoration widget 悬浮在块左侧，
// hover 块时显示类型切换面板，"正文"为当前项）。菜单构建逻辑与 heading-menu
// 共用 buildBlockTypeMenuDom，此处只负责正文段落匹配与交互：
// - 类型切换：setBlockType 切正文 / H1-H6；
// - 块形态转换：引用（包一层 blockquote）/ 列表（包一层 bullet_list）/ 表格
//   （空段落原位替换为默认表格，非空段落保留内容、表格插在其后）；
// - 删除整块（文档仅剩此段时省略）。
// 单图段落由 image-rhythm 的图片菜单接管，不在此匹配。
import { Node as PMNode, NodeType, Schema } from "prosemirror-model"
import { Selection } from "prosemirror-state"
import { SvgIcon } from "../icons"
import { BlockMenuRegistration } from "./block-menu"
import { BlockOpMenuItem } from "./block-op-menu"
import { buildBlockTypeMenuDom } from "./heading-menu"
import { deleteBlockAt, reloadBlockAt } from "./prosemirror-helpers"
import { createDefaultTableNode, getTableCellContentOffset } from "./table"
import { isImageOnlyParagraph } from "./image-rhythm"

export function createParagraphMenuRegistration(schema: Schema): BlockMenuRegistration | null {
  if (!schema.nodes.heading || !schema.nodes.paragraph) {
    return null
  }
  var headingType: NodeType = schema.nodes.heading
  var paragraphType: NodeType = schema.nodes.paragraph
  var blockquoteType: NodeType | undefined = schema.nodes.blockquote
  var bulletListType: NodeType | undefined = schema.nodes.bullet_list
  var listItemType: NodeType | undefined = schema.nodes.list_item

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
      // 重读防竞态：点击时菜单 widget 的 pos 可能已过期，按当前 doc 重读并
      // 校验仍是目标段落，不符即放弃（见 prosemirror-helpers）
      function isTargetParagraph(current: PMNode): boolean {
        return current.type === paragraphType
      }
      // 删除整块（重读防竞态 + 空文档兜底 + 光标落位，见 prosemirror-helpers）
      function deleteNodeAt() {
        deleteBlockAt(ctx, isTargetParagraph, schema)
      }

      // 引用：段落原样包进 blockquote（内容/光标区间不变，光标落回段内文本）
      function wrapParagraphAsBlockquote() {
        var view = ctx.view
        if (!view || !blockquoteType) {
          return
        }
        var current = reloadBlockAt(ctx, isTargetParagraph)
        if (!current) {
          return
        }
        var tr = view.state.tr.replaceWith(from, from + current.nodeSize, blockquoteType.create(null, [current]))
        tr = tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from + 2, tr.doc.content.size)), 1)).scrollIntoView()
        view.dispatch(tr)
        view.focus()
      }

      // 列表：段落原样包进 bullet_list > list_item（段落文字成为首项文本）
      function wrapParagraphAsList() {
        var view = ctx.view
        if (!view || !bulletListType || !listItemType) {
          return
        }
        var current = reloadBlockAt(ctx, isTargetParagraph)
        if (!current) {
          return
        }
        var wrapped = listItemType.create(null, [current])
        var tr = view.state.tr.replaceWith(from, from + current.nodeSize, bulletListType.create(null, [wrapped]))
        tr = tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from + 3, tr.doc.content.size)), 1)).scrollIntoView()
        view.dispatch(tr)
        view.focus()
      }

      // 表格：空段落原位替换为默认表格（不留空段）；非空段落保留内容、
      // 表格插在其后（段落文字无法映射进网格，避免丢内容）。光标落首格。
      function transformParagraphToTable() {
        var view = ctx.view
        if (!view) {
          return
        }
        var current = reloadBlockAt(ctx, isTargetParagraph)
        if (!current) {
          return
        }
        var tableNode = createDefaultTableNode(schema)
        if (!tableNode) {
          return
        }
        var tr
        if (current.content.size === 0) {
          // 空段：原位替换，表格起点就是 from
          tr = view.state.tr.replaceWith(from, from + current.nodeSize, tableNode)
        } else {
          // 非空段：表格插在其后，表格起点是原段末尾
          tr = view.state.tr.insert(from + current.nodeSize, tableNode)
        }
        var tableStart = current.content.size === 0 ? from : from + current.nodeSize
        var cursorPos = tableStart + getTableCellContentOffset(tableNode, 0, 0)
        tr = tr.setSelection(Selection.near(tr.doc.resolve(Math.min(cursorPos, tr.doc.content.size)), 1)).scrollIntoView()
        view.dispatch(tr)
        view.focus()
      }

      // 块形态转换项：schema 缺对应节点类型时逐项省略（如受限 schema）
      var transformItems: BlockOpMenuItem[] = []
      if (blockquoteType) {
        transformItems.push({
          label: "引用",
          icon: SvgIcon.quote,
          showLabel: true,
          run: wrapParagraphAsBlockquote
        })
      }
      if (bulletListType && listItemType) {
        transformItems.push({
          label: "列表",
          icon: SvgIcon.list,
          showLabel: true,
          run: wrapParagraphAsList
        })
      }
      if (schema.nodes.table) {
        transformItems.push({
          label: "表格",
          icon: SvgIcon.table,
          showLabel: true,
          run: transformParagraphToTable
        })
      }
      if (transformItems.length) {
        transformItems[0].divider = true
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
        docIsSingleBlock ? undefined : deleteNodeAt,
        transformItems.length ? transformItems : undefined,
        // 主按钮图标：空段落是起笔的羽毛（feather），写下内容后回到段落符（pilcrow）
        node.content.size === 0 ? SvgIcon.feather : SvgIcon.pilcrow
      )
    }
  }
}