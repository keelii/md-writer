// 可视模式粘贴 markdown 源码功能验证：
// 剪贴板内容为大段 md 源码（多行且含 ATX heading）时，
// 通过 handlePaste 走 markdown 解析管线插入；其余情况返回 false 交给默认行为。
import { EditorState } from "prosemirror-state"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, parseMarkdown } from "../src/prosemirror/markdown"
import { createMarkdownPastePlugin } from "../src/prosemirror/plugins"

var failures = 0

function assert(label: string, ok: boolean, extra?: string) {
  if (ok) {
    console.log("PASS: " + label)
  } else {
    failures += 1
    console.log("FAIL: " + label + (extra ? "  [" + extra + "]" : ""))
  }
}

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var plugin = createMarkdownPastePlugin(schema, parser)
var handlePaste: any = plugin.props.handlePaste
if (typeof handlePaste !== "function") {
  throw new Error("no handlePaste prop found")
}

// 模拟粘贴：fake clipboardData + fake view。
// 返回 { handled, state }（dispatch 在闭包中应用到 state 上）。
function paste(state: EditorState, text: string) {
  var applied = state
  var handled = handlePaste(
    {
      state: state,
      dispatch: function (tr: any) {
        applied = applied.apply(tr)
      }
    },
    {
      clipboardData: {
        getData: function (type: string) {
          if (type === "text/plain") {
            return text
          }
          return ""
        }
      }
    },
    null
  )
  return { handled: handled, state: applied }
}

// 从 md 文本构造初始 state（光标在文末）。
function stateFromMarkdown(markdown: string) {
  var doc = parseMarkdown(schema, parser, markdown)
  return EditorState.create({ schema: schema, doc: doc })
}

// 收集 doc 顶层节点类型名
function topNodeNames(state: EditorState) {
  var names: string[] = []
  state.doc.forEach(function (node: any) {
    names.push(node.type.name)
  })
  return names
}

function findHeadingLevels(state: EditorState) {
  var levels: number[] = []
  state.doc.descendants(function (node: any) {
    if (node.type.name === "heading") {
      levels.push(node.attrs.level)
    }
    return true
  })
  return levels
}

// 1. 大段 md（含 heading）在空文档粘贴 → 转换
{
  var md = "# 一级标题\n\n正文段落 **加粗** 内容。\n\n## 二级标题\n\n- 列表项"
  var result = paste(stateFromMarkdown(""), md)
  var names = topNodeNames(result.state)
  assert("large md handled", result.handled === true)
  assert("heading level 1 rendered", findHeadingLevels(result.state).indexOf(1) !== -1)
  assert("heading level 2 rendered", findHeadingLevels(result.state).indexOf(2) !== -1)
  assert("paragraph present", names.indexOf("paragraph") !== -1, JSON.stringify(names))
  assert("bullet list present", names.indexOf("bullet_list") !== -1, JSON.stringify(names))
  assert("strong mark rendered", result.state.doc.textContent.indexOf("加粗") !== -1)
}

// 2. 大段 md 粘贴到已有段落之后 → 追加块
{
  var md2 = "# 另一篇标题\n\n内容段落。"
  var r2 = paste(stateFromMarkdown("既有内容"), md2)
  assert("md handled after existing para", r2.handled === true)
  var h2 = findHeadingLevels(r2.state)
  assert("existing para preserved", r2.state.doc.textContent.indexOf("既有内容") !== -1)
  assert("new heading inserted", h2.indexOf(1) !== -1, JSON.stringify(h2))
}

// 3. 无 heading 的多行文本 → 不处理
{
  var r3 = paste(stateFromMarkdown(""), "第一行\n\n第二行内容\n\n第三行")
  assert("multi-line without heading ignored", r3.handled === false)
}

// 4. 单行 heading（非大段）→ 不处理
{
  var r4 = paste(stateFromMarkdown(""), "# 只有一行标题")
  assert("single-line heading ignored", r4.handled === false)
}

// 5. 普通短文本 → 不处理
{
  var r5 = paste(stateFromMarkdown(""), "hello world")
  assert("plain short text ignored", r5.handled === false)
}

// 6. code_block 内粘贴大段 md → 保持默认（不转换）
{
  var inCode = stateFromMarkdown("```\nplaceholder\n```")
  // 把光标放进 code_block（文末即 code_block 内部）
  var r6 = paste(inCode, "# 标题\n\n正文")
  assert("md paste inside code_block ignored", r6.handled === false)
}

// 7. 空文本 → 不处理
{
  var r7 = paste(stateFromMarkdown(""), "")
  assert("empty text ignored", r7.handled === false)
}

// 8. 大段 md 的 setext 风格（无 ATX heading）→ 不处理
{
  var r8 = paste(stateFromMarkdown(""), "标题文本\n===\n\n段落内容\n\n再来一段")
  assert("setext-only md ignored", r8.handled === false)
}

// 9. 粘贴含表格/代码块的大段 md → 解析渲染
{
  var md9 = "# 标题\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nvar x = 1\n```"
  var r9 = paste(stateFromMarkdown(""), md9)
  var names9 = topNodeNames(r9.state)
  assert("table rendered", names9.indexOf("table") !== -1, JSON.stringify(names9))
  assert("code block rendered", names9.indexOf("code_block") !== -1, JSON.stringify(names9))
}

// 10. 非空选区时粘贴大段 md → 替换选区
{
  var doc = parseMarkdown(schema, parser, "开头段落\n\n结尾段落")
  var withSel = EditorState.create({ schema: schema, doc: doc })
  var Sel = withSel.selection.constructor as any
  var selState = withSel.apply(
    withSel.tr.setSelection(
      new Sel(withSel.doc.resolve(1), withSel.doc.resolve(doc.content.size - 1))
    )
  )
  var r10 = paste(selState, "# 新标题\n\n替换内容")
  assert("selection replaced", r10.handled === true)
  assert("old text gone", r10.state.doc.textContent.indexOf("开头段落") === -1)
  assert("new heading in", findHeadingLevels(r10.state).indexOf(1) !== -1)
}

if (failures) {
  console.log("FAILED: " + failures + " case(s)")
  process.exit(1)
}
console.log("ALL PASS")