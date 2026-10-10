import { EditorView } from "prosemirror-view"
import { MDWriterInitOptions } from "../../types"

// NodeView 统一上下文：init 持有的 opts 与 PM 传入的 view/getPos 收敛为单一对象，
// 各 NodeView 工厂签名为 (node, ctx)。不建基类——分类间的差异（contentDOM、
// 交互边界、refresh 能力）由各实现自行声明，ctx 只承载共享环境。
export interface NodeViewContext {
  opts: MDWriterInitOptions
  view: EditorView
  getPos: () => number
}

// 无交互预览块的常量回调，多处重复收敛于此：
// - ignoreMutation：renderer 产出 DOM（KaTeX/mermaid/SVG/自建表格）的 mutation
//   一律由 NodeView 自身接管，恒返回 true（所有预览块共用）
// - stopEvent：仅保留在事件边界需要 NodeView 接管的地方——行内公式
//   （raw_inline，无块级选中）与 iframe 块（事件直达 iframe 内容）；
//   frontmatter/块公式/svg/mermaid 的点击已放行 PM 做整块选中，
//   不再使用本回调作为 stopEvent
export function returnTrue() {
  return true
}