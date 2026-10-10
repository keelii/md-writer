import { DOMOutputSpec, Node as PMNode, NodeSpec, Schema } from "prosemirror-model";
import { schema as baseMarkdownSchema } from "prosemirror-markdown";

export function buildSchema(): Schema {
  var tableSpec: NodeSpec = {
    group: "block",
    content: "(table_head | table_body)+",
    isolating: true,
    parseDOM: [{tag: "table"}],
    toDOM: function (): DOMOutputSpec {
      return ["table", 0]
    }
  }

  var tableHeadSpec: NodeSpec = {
    content: "table_row+",
    parseDOM: [{tag: "thead"}],
    toDOM: function (): DOMOutputSpec {
      return ["thead", {class: "table-head"}, 0]
    }
  }

  var tableBodySpec: NodeSpec = {
    content: "table_row+",
    parseDOM: [{tag: "tbody"}],
    toDOM: function (): DOMOutputSpec {
      return ["tbody", {class: "table-body"}, 0]
    }
  }

  var tableRowSpec: NodeSpec = {
    content: "(table_header | table_cell)+",
    parseDOM: [{tag: "tr"}],
    toDOM: function (): DOMOutputSpec {
      return ["tr", {class: "table-row"}, 0]
    }
  }

  // 表格单元格列对齐：GFM 分隔行的 :--- / :---: / ---: 在 markdown-it 解析后
  // 落到该列每个 th/td 的 align attr（left/center/right，null 为默认）。
  // 对齐存 cell 而非 table 节点：markdown-it 逐 cell 发 style attr，且
  // 增删行/列的 JSON 变更（table.ts）无需回写表级数组，序列化端取表头行
  // 各列 cell 的 align 还原分隔行。渲染端 toDOM 与 cell NodeView
  // （table-handles.ts 的 createHandleAwareCellNodeView）都把它写成
  // text-align 内联样式。
  var cellAlignAttr = {
    align: {default: null}
  }

  function tableCellAlignFromDOM(node: Node): {align: string | null} {
    var el = node as HTMLElement
    var value = el && el.style && el.style.textAlign ? String(el.style.textAlign).toLowerCase() : ""
    if (value !== "left" && value !== "center" && value !== "right") {
      return {align: null}
    }
    return {align: value}
  }

  function tableCellToDOM(tag: string, node: PMNode): DOMOutputSpec {
    var align = node.attrs.align
    var attrs: Record<string, string> = {class: "table-cell"}
    if (align === "left" || align === "center" || align === "right") {
      attrs.style = "text-align:" + align
    }
    return [tag, attrs, 0]
  }

  var tableHeaderSpec: NodeSpec = {
    content: "inline*",
    attrs: cellAlignAttr,
    parseDOM: [{tag: "th", getAttrs: tableCellAlignFromDOM}],
    toDOM: function (node: PMNode): DOMOutputSpec {
      return tableCellToDOM("th", node)
    }
  }

  var tableCellSpec: NodeSpec = {
    content: "inline*",
    attrs: cellAlignAttr,
    parseDOM: [{tag: "td", getAttrs: tableCellAlignFromDOM}],
    toDOM: function (node: PMNode): DOMOutputSpec {
      return tableCellToDOM("td", node)
    }
  }

  var rawInlineSpec: NodeSpec = {
    inline: true,
    group: "inline",
    content: "text*",
    marks: "",
    atom: true,
    parseDOM: [{tag: "span[data-md-editor-raw-inline=\"true\"]"}],
    toDOM: function (): DOMOutputSpec {
      return ["span", {"data-md-editor-raw-inline": "true", class: "md-editor-raw-inline"}, 0]
    }
  }

  var rawBlockSpec: NodeSpec = {
    group: "block",
    content: "text*",
    marks: "",
    code: true,
    defining: true,
    atom: true,
    // 预览类 raw_block（$$ 公式 / iframe / frontmatter）的 NodeView 为
    // contenteditable=false 且 stopEvent 放行原生事件，点击后浏览器 caret
    // 跨浏览器落点不可靠——光标到不了块边界，整块删除命令够不着。
    // createGapCursor 让 gapcursor 插件在块前后产生可视补位光标，
    // 补齐“鼠标点击 → 光标到边界 → Backspace 整删”的链路。
    // 副作用：kind 为空的可编辑 raw_block（HTML 源码块）周围同样出现
    // gap cursor，属可接受的降级（键盘方向键仍可进入内容）。
    createGapCursor: true,
    parseDOM: [{tag: "pre[data-md-editor-raw-block=\"true\"]"}],
    toDOM: function (): DOMOutputSpec {
      return ["pre", {"data-md-editor-raw-block": "true", class: "md-editor-raw-block"}, 0]
    }
  }

  var nodes = baseMarkdownSchema.spec.nodes
  if (!nodes.get("table")) {
    nodes = nodes.addToEnd("table", tableSpec)
  }
  if (!nodes.get("table_head")) {
    nodes = nodes.addToEnd("table_head", tableHeadSpec)
  }
  if (!nodes.get("table_body")) {
    nodes = nodes.addToEnd("table_body", tableBodySpec)
  }
  if (!nodes.get("table_row")) {
    nodes = nodes.addToEnd("table_row", tableRowSpec)
  }
  if (!nodes.get("table_header")) {
    nodes = nodes.addToEnd("table_header", tableHeaderSpec)
  }
  if (!nodes.get("table_cell")) {
    nodes = nodes.addToEnd("table_cell", tableCellSpec)
  }
  if (!nodes.get("raw_inline")) {
    nodes = nodes.addToEnd("raw_inline", rawInlineSpec)
  }
  if (!nodes.get("raw_block")) {
    nodes = nodes.addToEnd("raw_block", rawBlockSpec)
  }

  // hr 包壳加类：prosemirror-markdown 上游 schema 定死 toDOM: ["div", ["hr"]]，
  // 选中时 ProseMirror-selectednode 类落在这个匿名 div 上，主题样式无钩子可用。
  // 覆写为带 md-editor-horizontal-rule 类的同一结构（group/parseDOM 与上游一致）。
  var horizontalRuleSpec: NodeSpec = {
    group: "block",
    parseDOM: [{tag: "hr"}],
    toDOM: function (): DOMOutputSpec {
      return ["div", {class: "md-editor-horizontal-rule"}, ["hr"]]
    }
  }
  nodes = nodes.update("horizontal_rule", horizontalRuleSpec)

  var marks = baseMarkdownSchema.spec.marks
  var codeSpec = marks.get("code")
  if (codeSpec) {
    // 默认 code mark 的 excludes 为 "_`"（排除所有其他 mark），
    // 导致行内 code 无法与 link 等其他 mark 共存。
    // 这里改为仅排除自身，允许 code 与 a 标签（link）同时生效。
    marks = marks.update("code", Object.assign({}, codeSpec, {excludes: "code"}))
  }

  if (!marks.get("strike")) {
    marks = marks.addToEnd("strike", {
      parseDOM: [{tag: "s"}, {tag: "del"}, {tag: "strike"}],
      toDOM: function (): DOMOutputSpec {
        return ["s", 0]
      }
    })
  }

  // 行内 HTML 语义标签：u/mark/sub/sup/kbd/abbr。
  // 解析端由 markdown.ts 的 HTML 标签配对切分负责（markdown-it html:false
  // 会把行内标签保留在 text token 中），parseDOM 供富文本粘贴使用。
  if (!marks.get("underline")) {
    marks = marks.addToEnd("underline", {
      parseDOM: [{tag: "u"}],
      toDOM: function (): DOMOutputSpec {
        return ["u", 0]
      }
    })
  }
  if (!marks.get("highlight")) {
    marks = marks.addToEnd("highlight", {
      parseDOM: [{tag: "mark"}],
      toDOM: function (): DOMOutputSpec {
        return ["mark", 0]
      }
    })
  }
  if (!marks.get("subscript")) {
    marks = marks.addToEnd("subscript", {
      parseDOM: [{tag: "sub"}],
      toDOM: function (): DOMOutputSpec {
        return ["sub", 0]
      }
    })
  }
  if (!marks.get("superscript")) {
    marks = marks.addToEnd("superscript", {
      parseDOM: [{tag: "sup"}],
      toDOM: function (): DOMOutputSpec {
        return ["sup", 0]
      }
    })
  }
  if (!marks.get("kbd")) {
    marks = marks.addToEnd("kbd", {
      parseDOM: [{tag: "kbd"}],
      toDOM: function (): DOMOutputSpec {
        return ["kbd", 0]
      }
    })
  }
  if (!marks.get("abbreviation")) {
    marks = marks.addToEnd("abbreviation", {
      attrs: {
        title: {default: null}
      },
      parseDOM: [{
        tag: "abbr",
        getAttrs: function (dom: HTMLElement): Record<string, unknown> {
          return {title: dom.getAttribute("title") || null}
        }
      }],
      toDOM: function (mark: any): DOMOutputSpec {
        var attrs = mark.attrs && mark.attrs.title ? {title: mark.attrs.title} : {}
        return ["abbr", attrs, 0]
      }
    })
  }

  return new Schema({
    nodes: nodes,
    marks: marks
  })
}