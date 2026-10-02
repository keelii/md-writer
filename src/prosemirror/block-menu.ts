// 块级悬浮菜单核心（block menu）：用 decoration widget 在块左侧挂操作菜单，
// hover 到块、光标/选区位于块内、或整块被 NodeSelection 选中时显示。
// 标题/段落类型切换（heading-menu）与预览块删除入口
// （nodeviews/node-op-menu）都基于它注册。
//
// widget 锚点两种形态（由注册项 anchorInside 决定）：
// - 文本块（heading/paragraph，有 contentDOM）：锚在 pos+1（块内容首位），
//   widget 渲染为块的第一个子元素，hover 由
//   .md-editor-block-menu-source:hover > .md-editor-block-menu 命中；
// - atom / 无 contentDOM 的 NodeView（raw_block 预览块、mermaid code_block）：
//   锚在 pos（块前边界），widget 渲染为块 DOM 的前置兄弟。锚在块内（如 pos+1）
//   会落进 NodeView 子树、被 prosemirror-view 静默丢弃——widget 只能由父级
//   docView 的 updateChildren 渲染，atom 节点不参与该流程——hover 由
//   .md-editor-block-menu:has(+ .md-editor-block-menu-source:hover) 命中。
// 来源块统一由 node decoration 打 .md-editor-block-menu-source 类；选区在块内时
// 追加 .md-editor-block-menu-source-active，CSS 据此免 hover 常显菜单（见
// selectionInBlock 与 block-menu.css 的 -active 选择器）。
//
// 菜单定位用「静态位置 + 负 margin」：widget 设 position:absolute 且不指定
// left/top，浏览器取其静态位置（紧贴块左上角），再由 margin-left 左移，
// 不依赖任何 positioned 祖先，两种锚点形态几何一致。
import { Node as PMNode } from "prosemirror-model"
import { EditorState, NodeSelection, Plugin, Selection } from "prosemirror-state"
import { EditorView, Decoration, DecorationSet } from "prosemirror-view"
import { removeClass } from "../utils"
import "./block-menu.css"

export interface BlockMenuContext {
  node: PMNode
  pos: number
  view: EditorView | null
  // decorations 计算时的 doc 快照：注册项构建菜单时可做文档级判断
  //（如文档仅剩唯一顶层块时段落菜单省略删除项）。widget 每次事务重建，
  // 快照始终与菜单同步；不可用 ctx.view 判断——首次构建时 viewRef 尚为 null
  doc: PMNode
}

export interface BlockMenuRegistration {
  // 文本块锚块内（pos+1），atom/无 contentDOM 的 NodeView 锚块前（pos）
  anchorInside: boolean
  matches: (node: PMNode, parent: PMNode) => boolean
  buildMenu: (ctx: BlockMenuContext) => HTMLElement
}

export function closeAllOpenBlockMenus(exceptHost: HTMLElement | null) {
  var openMenus = document.querySelectorAll(".md-editor-block-menu-open")
  for (var i = 0; i < openMenus.length; i += 1) {
    var openMenu = openMenus[i]
    if (exceptHost && openMenu === exceptHost) {
      continue
    }
    removeClass(openMenu, "md-editor-block-menu-open")
  }
}

// 选区是否落在块内（决定来源块是否加 -active 常显类）：
// - NodeSelection（点击 atom 预览块整块选中）：选区区间被块覆盖即命中
//   （嵌套内容被选中时外层菜单块也点亮）；
// - 其余选区（光标 / 文本选区）：任一端点位于块内容区间。边界位置严格不计，
//   否则相邻两块会同时点亮（块边界位置同时是前块终点与后块起点）。
function selectionInBlock(selection: Selection, node: PMNode, pos: number): boolean {
  var end = pos + node.nodeSize
  if (selection instanceof NodeSelection) {
    return selection.from >= pos && selection.to <= end
  }
  return (selection.from > pos && selection.from < end) ||
    (selection.to > pos && selection.to < end)
}

export function createBlockMenuPlugin(registrations: BlockMenuRegistration[]): Plugin {
  var viewRef: EditorView | null = null
  return new Plugin({
    view: function (view) {
      viewRef = view
      function onDocumentClick(event: MouseEvent) {
        var target = event.target
        if (target instanceof Element && target.closest(".md-editor-block-menu")) {
          return
        }
        closeAllOpenBlockMenus(null)
      }
      document.addEventListener("click", onDocumentClick)
      return {
        destroy: function () {
          document.removeEventListener("click", onDocumentClick)
        }
      }
    },
    props: {
      decorations: function (state: EditorState) {
        var decorations: Decoration[] = []
        state.doc.descendants(function (node, pos, parent) {
          // 顶层块的 parent 是 doc；类型上 parent 可为 null（无父节点），直接跳过
          if (!parent) {
            return true
          }
          for (var i = 0; i < registrations.length; i += 1) {
            var registration = registrations[i]
            if (!registration.matches(node, parent)) {
              continue
            }
            // 光标/选区在块内时加 -active 类：CSS 据此免 hover 常显菜单。
            // 选区移动会触发 decorations 重算（每次重建，node 装饰
            // attrs 不 eq 时 prosemirror-view 自动同步 DOM class）
            var sourceClass = selectionInBlock(state.selection, node, pos)
              ? "md-editor-block-menu-source md-editor-block-menu-source-active"
              : "md-editor-block-menu-source"
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {class: sourceClass})
            )
            decorations.push(
              Decoration.widget(
                registration.anchorInside ? pos + 1 : pos,
                function () {
                  // EditorView 构造中初始 docView 渲染先于 plugin view() 回调，
                  // 首次构建 widget 时 viewRef 尚为 null——view 用 getter 延迟求值，
                  // 否则加载后未做任何编辑前点击菜单，ctx.view 为 null 操作静默失效
                  return registration.buildMenu({
                    node: node,
                    pos: pos,
                    doc: state.doc,
                    get view() { return viewRef }
                  })
                },
                {side: -1}
              )
            )
            break
          }
          return true
        })
        if (!decorations.length) {
          return null
        }
        return DecorationSet.create(state.doc, decorations)
      }
    }
  })
}