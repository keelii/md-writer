// Widget NodeView：frontmatter。
// 渲染来源是 markdown DSL（--- … --- 头部键值）→ 自建 renderer 产出只读表格，
// 无外部交互内容；不设 stopEvent，点击放行 PM 原生 selectClickedLeaf
// （raw_block 为 atom）产生 NodeSelection，整块选中后可直接 Backspace 删除。
import { Node as PMNode } from "prosemirror-model"
import { h } from "../../../jsx"
import { NodeViewContext, returnTrue } from "../types"
import { getRawBlockKind, parseFrontmatterEntries } from "../kinds"
import { createRawBlockShell } from "../raw-block-shell"
import "./frontmatter.css"

export function createFrontmatterRawBlockNodeView(node: PMNode, ctx: NodeViewContext) {
  if (node.type.name !== "raw_block") {
    return null
  }
  if (getRawBlockKind(node.textContent) !== "frontmatter") {
    return null
  }

  var shell = createRawBlockShell()
  var dom = shell.dom

  function renderFrontmatter(source: string) {
    var entries = parseFrontmatterEntries(source)
    if (entries.length < 1) {
      shell.renderError("frontmatter 预览不可用，请切换源码模式修改。")
      return
    }
    shell.setBodyClass("md-editor-raw-frontmatter-preview")
    shell.body.textContent = ""
    var rows = entries.map(function (entry) {
      return (
        <tr><th>{entry.key}</th><td>{entry.value}</td></tr>
      )
    })
    shell.body.appendChild(<table><tbody>{rows}</tbody></table>)
  }

  renderFrontmatter(node.textContent)

  return {
    dom: dom,
    update: function (nextNode: PMNode) {
      if (nextNode.type.name !== "raw_block") {
        return false
      }
      if (nextNode.textContent !== node.textContent) {
        // 跨 kind 变化交回分派器，同 kind 内文本变化原地重渲染
        if (getRawBlockKind(nextNode.textContent) !== "frontmatter") {
          return false
        }
        renderFrontmatter(nextNode.textContent)
      }
      node = nextNode
      return true
    },
    ignoreMutation: returnTrue
  }
}