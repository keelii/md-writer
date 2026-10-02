// 代码块 DecoMenu：hover 顶层非 mermaid code_block 时在块左侧挂语言切换 dropdown。
//
// 主按钮显示当前语言的扩展名简写（fence info 首词按别名归一，如 python→py；无语言为“文本”），点击展开语言候选列表
// （来自 code-highlight 的 CODE_LANGUAGES，当前语言高亮）+ 删除代码块。
// 语言写回 code_block 的 params（fence info 首词），序列化仍由 prosemirror-markdown
// 的标准 fence 处理；高亮是 Decoration 叠加，params 变更后插件自动重新分词。
//
// 锚点形态：code_block 的 NodeView（code-block-copy）把内容包在 pre > code 里，
// 块内锚点渲染进 code 子树、不是来源块 DOM 的直接子元素，hover 选择器无法命中，
// 与列表/引用/表格一致锚在块前。
//
// mermaid code_block 是预览块，由 node-op-menu（复制源码 + 删除节点）负责，此处排除，
// 两边 matches 互斥、注册顺序无关。删除与标题/表格菜单同一条链路：整块 tr.delete +
// 光标落位。复制是 code_block 的 NodeView OpButton（code-block-copy）职责，
// DecoMenu 不重复提供。
import { Node as PMNode, Schema } from "prosemirror-model"
import { SvgIcon } from "../icons"
import { CODE_LANGUAGES, fenceWordShort } from "./code-highlight"
import { BlockMenuContext, BlockMenuRegistration } from "./block-menu"
import { BlockOpMenuItem, buildBlockOpMenuDom } from "./block-op-menu"
import { reloadBlockAt, deleteBlockAt } from "./prosemirror-helpers"
import { isMermaidCodeBlock } from "./nodeviews/kinds"

// fence info 首词（params 为 null/空白 → ""，即无语言）
function fenceWord(node: PMNode): string {
  var params = node.attrs && node.attrs.params ? String(node.attrs.params) : ""
  return params.trim().split(/\s+/)[0]
}

// 非 mermaid 的 code_block（mermaid 预览块归 node-op-menu 负责）
function isPlainCodeBlock(node: PMNode): boolean {
  return node.type.name === "code_block" && !isMermaidCodeBlock(node)
}

// 按当前 doc 重读节点（pos 来自 decoration 重算，避免边界竞态操作错块）
function reloadCodeBlock(ctx: BlockMenuContext): PMNode | null {
  return reloadBlockAt(ctx, isPlainCodeBlock)
}

function setCodeBlockLanguage(ctx: BlockMenuContext, value: string) {
  var view = ctx.view
  if (!view) {
    return
  }
  var current = reloadCodeBlock(ctx)
  if (!current) {
    return
  }
  var tr = view.state.tr.setNodeMarkup(
    ctx.pos,
    null,
    Object.assign({}, current.attrs, {params: value === "" ? null : value})
  )
  view.dispatch(tr)
  view.focus()
}

export function createCodeBlockMenuRegistration(schema: Schema): BlockMenuRegistration | null {
  if (!schema.nodes.code_block) {
    return null
  }
  return {
    anchorInside: false,
    matches: function (node: PMNode, parent: PMNode) {
      if (parent.type.name !== "doc" || node.type.name !== "code_block") {
        return false
      }
      return !isMermaidCodeBlock(node)
    },
    buildMenu: function (ctx: BlockMenuContext) {
      // 归一后的扩展名（python→py、javascript→js…），同时用于主按钮显示与候选高亮
      var currentWord = fenceWordShort(fenceWord(ctx.node)).toLowerCase()
      var items: BlockOpMenuItem[] = CODE_LANGUAGES.map(function (option: {value: string, label: string}) {
        return {
          label: option.label,
          active: option.value === currentWord,
          run: function () {
            setCodeBlockLanguage(ctx, option.value)
          }
        }
      })
      items.push({
        label: "删除",
        showLabel: true,
        icon: SvgIcon.trash,
        divider: true,
        run: function () {
          deleteBlockAt(ctx, isPlainCodeBlock, schema)
        }
      })
      return buildBlockOpMenuDom(
        "md-editor-code-block-menu",
        items,
        {
          toggleLabel: currentWord || "文本",
          toggleTitle: "切换代码块语言"
        }
      )
    }
  }
}