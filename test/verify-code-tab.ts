// 验证 code block 内 Tab 多行选区缩进/反缩进的纯函数逻辑。
// 直接复制 collectCodeBlockLineStarts 的语义进行等价验证不可靠，
// 这里通过构建真实 ProseMirror 文档驱动命令。
import { EditorState, TextSelection } from "prosemirror-state"
import { buildSchema } from "../src/prosemirror/schema"
import { dedentCodeBlockCommand, indentCodeBlockCommand } from "../src/prosemirror/plugins"

var pass = 0
var fail = 0

function check(name: string, actual: string, expected: string) {
  if (actual === expected) {
    pass += 1
    console.log("PASS: " + name)
  } else {
    fail += 1
    console.log("FAIL: " + name + "\n  expected: " + JSON.stringify(expected) + "\n  actual:   " + JSON.stringify(actual))
  }
}

var schema = buildSchema()

function makeState(codeText: string): EditorState {
  var doc = schema.nodes.doc.create(null, [
    schema.nodes.code_block.create(null, schema.text(codeText))
  ])
  return EditorState.create({ doc: doc })
}

function applyTab(codeText: string, from: number, to: number, cmd: any): string {
  var state = makeState(codeText)
  // code_block 是 doc 第一个子节点，其内容从 doc 位置 1 开始
  var contentStart = 1
  var sel = TextSelection.create(state.doc, contentStart + from, contentStart + to)
  state = state.apply(state.tr.setSelection(sel))
  cmd(state, function (tr: any) {
    state = state.apply(tr)
  })
  var node = state.doc.firstChild
  return node ? node.textContent : ""
}

var INDENT = indentCodeBlockCommand
var DEDENT = dedentCodeBlockCommand

// 光标单点缩进
check("cursor indent", applyTab("abc", 2, 2, INDENT), "ab  c")
check("cursor dedent with spaces", applyTab("  ab", 2, 2, DEDENT), "ab")
check("cursor dedent without spaces (no-op)", applyTab("ab", 1, 1, DEDENT), "ab")

// 多行选区缩进
check("multi-line indent", applyTab("aa\nbb\ncc", 1, 7, INDENT), "  aa\n  bb\n  cc")
check("multi-line indent ends at line start", applyTab("aa\nbb\ncc", 1, 6, INDENT), "  aa\n  bb\ncc")
check("multi-line indent partial", applyTab("aa\nbb\ncc", 3, 4, INDENT), "aa\n  bb\ncc")
// 选区终点恰为行首：不包含该行
check("selection ends at line start", applyTab("aa\nbb\ncc", 0, 3, INDENT), "  aa\nbb\ncc")
// 选区起点在行中间
check("selection starts mid-line", applyTab("aa\nbb", 1, 5, INDENT), "  aa\n  bb")

// 多行反缩进
check("multi-line dedent", applyTab("  aa\n  bb\ncc", 0, 12, DEDENT), "aa\nbb\ncc")
check("multi-line dedent partial units", applyTab("    aa\n b\ncc", 0, 10, DEDENT), "  aa\nb\ncc")
check("multi-line dedent mixed lines", applyTab("  aa\nbb", 0, 7, DEDENT), "aa\nbb")

// 空行处理：多行选区跨越空行时空行也缩进
check("empty line in selection", applyTab("aa\n\ncc", 0, 6, INDENT), "  aa\n  \n  cc")
// 光标在空行
check("cursor on empty line", applyTab("aa\n\ncc", 3, 3, INDENT), "aa\n  \ncc")
// 光标在块尾
check("cursor at block end", applyTab("aa\nbb", 5, 5, INDENT), "aa\nbb  ")
check("cursor at block end dedent", applyTab("aa\nbb  ", 7, 7, DEDENT), "aa\nbb")

// 空选区在行中间反缩进只删光标前的空格
check("mid-line dedent", applyTab("a   b", 4, 4, DEDENT), "a b")

// 选区非空但只在一行内：整行行首缩进
check("single-line selection", applyTab("abcd", 1, 3, INDENT), "  abcd")

// 非 code block：段落上命令返回 false（吞掉由外层负责）
var paraDoc = schema.nodes.doc.create(null, [
  schema.nodes.paragraph.create(null, schema.text("hello"))
])
var paraState = EditorState.create({ doc: paraDoc })
var okIndent = indentCodeBlockCommand(paraState)
var okDedent = dedentCodeBlockCommand(paraState)
check("paragraph returns false (indent)", okIndent ? "true" : "false", "false")
check("paragraph returns false (dedent)", okDedent ? "true" : "false", "false")

console.log(fail === 0 ? "ALL CODE TAB TESTS PASSED (" + pass + ")" : "FAILED: " + fail)
process.exit(fail === 0 ? 0 : 1)