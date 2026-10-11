// 预览块节点操作菜单（NodeOpMenu）：注册到 block-menu 核心，
// 预览块（$$ 公式 / iframe / frontmatter / svg 的 raw_block，mermaid code_block）
// hover 时在块左侧显示：复制源码 + 编辑源码 + 删除节点（dropdown 形态，构建器见 block-op-menu.tsx）。
// 脚注定义块除外：它在正文里是 display:none 的隐藏占位，hover / 选中都不可达，
// 查看与编辑只走引用处的 tooltip，删除走相邻块边界 Backspace 整删。
// 预览块 stopEvent 放行原生事件、iframe 内鼠标事件不达编辑器，
// 鼠标侧没有统一删除入口——菜单按钮与键盘 Backspace 整删走同一删除链路。
// 复制源码只读 textContent（与 markdown 序列化同源），不引入任何文档变更。
// 编辑源码弹 Dialog（Dialog 类产品交互归 actions.ts 编排）。
// dropdown 主按钮 icon 按块类型区分：math=_sigma、svg=vector-square、
// mermaid=square-chart-gantt（lucide），其余预览块落默认 ellipsis。
import { Node as PMNode } from "prosemirror-model"
import { MDWriterInitOptions } from "../../types"
import { SvgIcon } from "../../icons"
import { copyTextToClipboard } from "../../utils"
import { editPreviewBlockSource } from "../actions"
import { buildMarkdownSerializer, serializeNodeMarkdown } from "../markdown"
import { BlockMenuRegistration, BlockMenuContext } from "../block-menu"
import { buildBlockOpMenuDom } from "../block-op-menu"
import { reloadBlockAt, deleteBlockAt } from "../prosemirror-helpers"
import { getRawBlockKind, isPreviewBlock } from "./kinds"
import "./node-op-menu.css"

// dropdown 主按钮 icon/title 按预览块类型区分；未列出的 kind 落默认 ellipsis
var toggleByKind: Record<string, { toggleIcon: string, toggleTitle: string }> = {
  math: { toggleIcon: SvgIcon.sigma, toggleTitle: "公式操作" },
  svg: { toggleIcon: SvgIcon.vectorSquare, toggleTitle: "SVG 操作" },
  mermaid: { toggleIcon: SvgIcon.squareChartGantt, toggleTitle: "图表操作" }
}

function deleteNodeAt(ctx: BlockMenuContext) {
  // pos 来自最近一次 decoration 重算，正常是新鲜的；仍按当前 doc 重读并校验
  // 同一预览块（防重绘后内容已变），避免边界竞态删错范围
  deleteBlockAt(ctx, function (current: PMNode) {
    return isPreviewBlock(current) && current.eq(ctx.node)
  })
}

function copyNodeSource(ctx: BlockMenuContext) {
  // 与删除同样按当前 doc 重读，避免边界竞态读到错位内容
  var current = reloadBlockAt(ctx, isPreviewBlock)
  if (!current) {
    return
  }
  // 走 markdown 序列化而非 textContent：mermaid（code_block）能补全 ```mermaid 围栏，
  // raw_block（公式/svg/iframe）序列化结果与 textContent 等价
  var serializer = buildMarkdownSerializer(current.type.schema)
  var source = serializeNodeMarkdown(serializer, current).replace(/\s+$/, "")
  copyTextToClipboard(source).catch(function () {
    // 剪贴板失败静默：按钮交互不弹 Dialog（Dialog 类交互归 actions.ts）
  })
}

export function createPreviewBlockOpMenuRegistration(opts?: MDWriterInitOptions): BlockMenuRegistration {
  return {
  // 预览块是无 contentDOM 的 NodeView：widget 锚在块前（块内锚点会被
  // prosemirror-view 丢弃），渲染为块 DOM 的前置兄弟
  anchorInside: false,
  matches: function (node: PMNode, parent: PMNode) {
    // 脚注定义块是 display:none 的隐藏占位：hover / NodeSelection 都不可见，
    // 挂菜单只会凭空弹出浮层，直接不匹配（编辑走 tooltip、删除走边界 Backspace）
    if (node.type.name === "raw_block" && getRawBlockKind(node.textContent) === "footnote") {
      return false
    }
    return isPreviewBlock(node)
  },
  buildMenu: function (ctx) {
    var kind = ctx.node.type.name === "raw_block" ? getRawBlockKind(ctx.node.textContent) : "mermaid"
    if (kind === "frontmatter") {
      return buildBlockOpMenuDom("md-editor-node-op-menu", [{
        label: "删除",
        icon: SvgIcon.trash,
        run: function () { deleteNodeAt(ctx) }
      }])
    }
    return buildBlockOpMenuDom("md-editor-node-op-menu", [
      {
        label: "复制",
        icon: SvgIcon.clipboard,
        showLabel: true,
        run: function () {
          copyNodeSource(ctx)
        }
      },
      {
        label: "编辑",
        icon: SvgIcon.pencil,
        showLabel: true,
        run: function () {
          if (ctx.view) {
            editPreviewBlockSource(ctx.view, ctx.pos, ctx.view.dom, opts)
          }
        }
      },
      {
        label: "删除",
        icon: SvgIcon.trash,
        showLabel: true,
        run: function () {
          deleteNodeAt(ctx)
        }
      }
    ], toggleByKind[kind])
  }
  }
}

export var previewBlockOpMenuRegistration = createPreviewBlockOpMenuRegistration()