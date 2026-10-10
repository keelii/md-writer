// raw_block NodeView 共享外壳：dom 结构。
// math/iframe/frontmatter 三种 raw_block 实现（Raw 与 Widget）共用同一壳。
//
// 点击整块选中：math/frontmatter 的 NodeView 不设 stopEvent，点击放行 PM，
// 原生 selectClickedLeaf（raw_block 为 atom）产生 NodeSelection，选中态样式
// 落在壳上（raw-block-shell.css 的 .ProseMirror-selectednode）；选中后 Backspace
// 整删，或 hover 块时左侧节点操作菜单删除（见 node-op-menu.tsx / block-menu.ts）。
import { h } from "../../jsx"
import { setClass } from "../../utils"
import "./raw-block-shell.css"

export function createRawBlockShell() {
  var body = <div className="md-editor-raw-preview-body" />
  var dom = (
    <div className="md-editor-raw-preview" contenteditable="false">{body}</div>
  )

  return {
    dom: dom,
    body: body,
    setBodyClass: function (className: string) {
      setClass(body, "md-editor-raw-preview-body " + className)
    },
    renderError: function (message: string) {
      setClass(body, "md-editor-raw-preview-body md-editor-raw-preview-error")
      body.textContent = message
    }
  }
}