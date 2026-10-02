// raw_block NodeView 共享外壳：dom 结构。
// math/iframe/frontmatter 三种 raw_block 实现（Raw 与 Widget）共用同一壳。
//
// 点击不主动整块选中（该交互已取消）：mousedown 放行原生事件，
// 浏览器把光标定位到块前后；整块删除两条路：
// 1. 键盘——光标移到块前后按 Backspace
//    （PM joinBackward 对可选 leaf 节点会先整块选中、再按一次删除）；
// 2. 鼠标——hover 块时左侧显示节点操作菜单（decoration 实现，
//    见 node-op-menu.tsx / block-menu.ts）。
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