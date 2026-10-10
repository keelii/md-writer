// 表格 DecoMenu：hover 顶层表格时在块左侧挂 dropdown（⋯ 主按钮 + 下拉面板），
// 绑定 4 个表格命令（commandByName 分发）+ 复制源码 + 删除整表，形态/互斥由 block-op-menu.tsx 提供。
// 行/列的拖动移动与末尾追加已由 table-handles.ts 把手交互覆盖，菜单不再提供移动类按钮。
//
// 行列命令语义（跟随光标）：命令层 applyTableMutation 基于选区取行列索引，
// 因此运行前保证选区落位——
// - 光标已在本表：直接作用于光标所在行/列（与工具栏表格按钮一致）；
// - 光标不在本表（hover 场景常态）：选区退化为末行末列（最后一个单元格），
//   「添加行/列」即末尾追加，删除针对末行末列。
//
// 复制源码：用 markdown 序列化器（markdown.ts 的 serializeNodeMarkdown）把
// 当前 table 节点序列化为 GFM 源码写入剪贴板，只读不写，与文档持久化同源。
//
// markdown 兼容：所有操作只改 PM 文档结构（增删 GFM 表格行/列），
// 序列化仍由 prosemirror-markdown 负责，不引入非标准语法。
//
// 锚点形态：table 是 isolating 复合块（table_head 的 DOM 是 thead，
// 块内锚点会因 thead 只接受 tr 被 foster parenting 挪走），与预览块一样锚在块前。
import { Node as PMNode, Schema } from "prosemirror-model"
import { Selection } from "prosemirror-state"
import { SvgIcon } from "../icons"
import { copyTextToClipboard } from "../utils"
import { BlockMenuContext, BlockMenuRegistration } from "./block-menu"
import { buildBlockOpMenuDom, BlockOpMenuItem } from "./block-op-menu"
import { reloadBlockAt, deleteBlockAt } from "./prosemirror-helpers"
import { commandByName } from "./commands"
import { getTableContext } from "./table"
import { buildMarkdownSerializer, serializeNodeMarkdown } from "./markdown"

function isTableNode(node: PMNode): boolean {
  return node.type.name === "table"
}

// 光标不在本表时把选区退化为末行末列（表格内容最后一个位置，
// Selection.near 向前收敛到末单元格文本块内），再运行命令。
function runTableCommand(ctx: BlockMenuContext, schema: Schema, name: string) {
  var view = ctx.view
  if (!view) {
    return
  }
  var current = reloadBlockAt(ctx, isTableNode)
  if (!current) {
    return
  }
  var state = view.state
  var context = getTableContext(state)
  if (!context || context.tablePos !== ctx.pos) {
    var lastCellPos = ctx.pos + current.nodeSize - 1
    view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(lastCellPos), -1)))
    state = view.state
  }
  var command = commandByName(schema, name)
  if (!command) {
    return
  }
  command(state, view.dispatch, view)
  view.focus()
}

// 复制表格的 GFM markdown 源码：按当前 doc 重读节点（避免 decoration 重算竞态读到
// 错位内容），序列化后去掉尾部换行写入剪贴板；只读不写，不产生文档事务。
function copyTableSource(ctx: BlockMenuContext, serializer: ReturnType<typeof buildMarkdownSerializer>) {
  var current = reloadBlockAt(ctx, isTableNode)
  if (!current) {
    return
  }
  var source = serializeNodeMarkdown(serializer, current).replace(/\s+$/, "")
  copyTextToClipboard(source).catch(function () {
    // 剪贴板失败静默：按钮交互不弹 Dialog（Dialog 类交互归 actions.ts）
  })
}

export function createTableMenuRegistration(schema: Schema): BlockMenuRegistration | null {
  if (!schema.nodes.table) {
    return null
  }
  var serializer = buildMarkdownSerializer(schema)
  // 图标沿用工具栏表格按钮（buttons.tsx）同一映射，保持两处入口一致；
  // 移动行/列已由 table-handles.ts 拖拽把手覆盖，此处不再提供。
  var commandEntries: Array<{name: string, label: string, icon: string}> = [
    {name: "table_add_row", label: "添加行", icon: SvgIcon.betweenHorizontalStart},
    {name: "table_add_column", label: "添加列", icon: SvgIcon.betweenVerticalStart},
    {name: "table_delete_row", label: "删除行", icon: SvgIcon.listX},
    {name: "table_delete_column", label: "删除列", icon: SvgIcon.listXRotateNeg90}
  ]

  return {
    anchorInside: false,
    matches: function (node: PMNode, parent: PMNode) {
      if (parent.type.name !== "doc") {
        return false
      }
      return node.type.name === "table"
    },
    buildMenu: function (ctx) {
      // 首项复制源码：剪贴板 icon + 「复制源码」文案，与预览块菜单的复制入口对齐
      var items: BlockOpMenuItem[] = [{
        label: "复制源码",
        icon: SvgIcon.clipboard,
        showLabel: true,
        run: function () {
          copyTableSource(ctx, serializer)
        }
      }]
      items.push.apply(items, commandEntries.map(function (entry) {
        return {
          label: entry.label,
          icon: entry.icon,
          showLabel: true,
          run: function () {
            runTableCommand(ctx, schema, entry.name)
          }
        }
      }))
      items.push({
        label: "删除",
        icon: SvgIcon.trash,
        showLabel: true,
        run: function () {
          deleteBlockAt(ctx, isTableNode, schema)
        }
      })
      return buildBlockOpMenuDom("md-editor-table-menu", items, {toggleIcon: SvgIcon.table, toggleTitle: "表格操作"})
    }
  }
}