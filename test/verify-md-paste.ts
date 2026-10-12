// 可视模式粘贴功能验证：
// 剪贴板内容为大段 md 源码（多行且含 ATX heading）时，
// 通过 handlePaste 走 markdown 解析管线插入；其余情况返回 false 交给默认行为。
// 含 <svg>…</svg> 的单行文本同样走解析管线：光标前同行有文字 → 行内 raw_inline；
// 行首 → 块级 raw_block；code_block 内保持纯文本。
import { EditorState, TextSelection } from "prosemirror-state"
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

// ---- SVG 粘贴（hasRawSvgMarkup 分支）----

// 用户实际粘贴的单行 SVG 源（lucide eye 图标，含 xmlns / class 等属性）
var SVG_SRC =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye preview-icon"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>'

// 指定光标位置构造 state（doc 内绝对位置）
function stateWithCursor(markdown: string, cursor: number) {
  var doc = parseMarkdown(schema, parser, markdown)
  return EditorState.create({ schema: schema, doc: doc, selection: TextSelection.create(doc, cursor) })
}

function hasSvgRawInline(state: EditorState) {
  var found = false
  state.doc.descendants(function (node: any) {
    if (node.type.name === "raw_inline" && /^<svg\b/i.test(node.textContent)) {
      found = true
    }
    return true
  })
  return found
}

// 11. 单行 SVG 粘贴到空文档（光标行首）→ 块级 raw_block 预览
{
  var r11 = paste(stateFromMarkdown(""), SVG_SRC)
  assert("svg paste into empty doc handled", r11.handled === true)
  var names11 = topNodeNames(r11.state)
  assert("svg at line start renders as raw_block", names11.indexOf("raw_block") !== -1, JSON.stringify(names11))
}

// 12. SVG 粘贴到段落文字中间 → 行内 raw_inline，段落不劈开
{
  var r12 = paste(stateWithCursor("看图标说明", 2), SVG_SRC)
  assert("svg paste mid-paragraph handled", r12.handled === true)
  assert("svg mid-line renders as raw_inline", hasSvgRawInline(r12.state))
  var names12 = topNodeNames(r12.state)
  assert("paragraph not split by inline svg", names12.length === 1 && names12[0] === "paragraph", JSON.stringify(names12))
  assert("prefix text preserved", r12.state.doc.textContent.indexOf("看") === 0)
  assert("suffix text preserved", r12.state.doc.textContent.indexOf("说明") !== -1)
}

// 13. SVG 粘贴到段落行首（光标 pos 1）→ 块级 raw_block，段落被块劈开
{
  var r13 = paste(stateWithCursor("行首粘贴", 1), SVG_SRC)
  assert("svg paste at line start handled", r13.handled === true)
  var names13 = topNodeNames(r13.state)
  assert("svg at paragraph start renders as raw_block", names13.indexOf("raw_block") !== -1, JSON.stringify(names13))
}

// 14. code_block 内粘贴 SVG → 保持纯文本（不转换）
{
  var r14 = paste(stateFromMarkdown("```\nplaceholder\n```"), SVG_SRC)
  assert("svg paste inside code_block ignored", r14.handled === false)
}

// 15. SVG 夹在文字中间的混合行粘贴到空文档 → 整段行内解析（raw_inline）
{
  var r15 = paste(stateFromMarkdown(""), "看图标 " + SVG_SRC + " 说明文字")
  assert("svg with surrounding text handled", r15.handled === true)
  var names15 = topNodeNames(r15.state)
  assert("mixed line renders as paragraph with raw_inline",
    names15.indexOf("paragraph") !== -1 && names15.indexOf("raw_block") === -1 && hasSvgRawInline(r15.state),
    JSON.stringify(names15))
}

// 16. 无 svg 普通单行文本 → 仍不处理
{
  var r16 = paste(stateWithCursor("看图标说明", 2), "就是一段普通文字")
  assert("plain text without svg still ignored", r16.handled === false)
}

// 17. SVG 粘贴到 heading 文字中间 → 行内 raw_inline，heading 不劈开、层级保留
{
  // doc: heading("带图标标题")，内容起始于 pos 1，光标落在"带"之后（pos 2）
  var r17 = paste(stateWithCursor("# 带图标标题", 2), SVG_SRC)
  assert("svg paste mid-heading handled", r17.handled === true)
  assert("svg mid-heading renders as raw_inline", hasSvgRawInline(r17.state))
  var names17 = topNodeNames(r17.state)
  assert("heading not split by inline svg", names17.length === 1 && names17[0] === "heading", JSON.stringify(names17))
  assert("heading level preserved", findHeadingLevels(r17.state).indexOf(1) !== -1)
  // 行内 svg 插入后 textContent 中 svg 源码夹在前后文本之间，需分段断言
  assert("heading text preserved",
    r17.state.doc.textContent.indexOf("带") === 0 && r17.state.doc.textContent.indexOf("图标标题") !== -1)
}

// 18. SVG 粘贴到 heading 行首（光标 pos 1）→ 块级 raw_block
{
  var r18 = paste(stateWithCursor("# 行首图标标题", 1), SVG_SRC)
  assert("svg paste at heading start handled", r18.handled === true)
  var names18 = topNodeNames(r18.state)
  assert("svg at heading start renders as raw_block", names18.indexOf("raw_block") !== -1, JSON.stringify(names18))
}

if (failures) {
  console.log("FAILED: " + failures + " case(s)")
  process.exit(1)
}
console.log("ALL PASS")