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

// 无交互预览块（Widget NodeView）的常量回调：事件与 DOM mutation 一律由
// NodeView 自身接管，stopEvent/ignoreMutation 恒返回 true（多处重复收敛于此）
export function returnTrue() {
  return true
}