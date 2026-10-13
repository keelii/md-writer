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

// 17. SVG 粘贴到 heading 文字中间 → 不处理（heading 不允许 svg，交回默认字面文本粘贴）
{
  // doc: heading("带图标标题")，内容起始于 pos 1，光标落在"带"之后（pos 2）
  var r17 = paste(stateWithCursor("# 带图标标题", 2), SVG_SRC)
  assert("svg paste mid-heading not handled", r17.handled === false)
  assert("no svg rendered in heading", !hasSvgRawInline(r17.state))
  var names17 = topNodeNames(r17.state)
  assert("heading untouched by mid-heading svg paste", names17.length === 1 && names17[0] === "heading", JSON.stringify(names17))
  assert("heading level preserved", findHeadingLevels(r17.state).indexOf(1) !== -1)
}

// 18. SVG 粘贴到 heading 行首（光标 pos 1）→ 块级 raw_block 落在标题外，标题保留
{
  var r18 = paste(stateWithCursor("# 行首图标标题", 1), SVG_SRC)
  assert("svg paste at heading start handled", r18.handled === true)
  var names18 = topNodeNames(r18.state)
  assert("svg at heading start renders as raw_block", names18.indexOf("raw_block") !== -1, JSON.stringify(names18))
  assert("heading text preserved at start paste", r18.state.doc.textContent.indexOf("行首图标标题") !== -1)
}

// 18b. SVG 粘贴到 heading 行尾 → 块级 raw_block 落在标题之后，标题不劈开、无行内 svg
{
  // doc: heading("带图标标题")，内容 pos 1..6，光标在行尾 pos 6
  var r18b = paste(stateWithCursor("# 带图标标题", 6), SVG_SRC)
  assert("svg paste at heading end handled", r18b.handled === true)
  var names18b = topNodeNames(r18b.state)
  assert("svg at heading end renders as raw_block", names18b.indexOf("raw_block") !== -1, JSON.stringify(names18b))
  assert("heading not split at end paste", names18b[0] === "heading" && names18b.indexOf("heading", 1) === -1, JSON.stringify(names18b))
  assert("no inline svg inside heading", !hasSvgRawInline(r18b.state))
  assert("heading text preserved at end paste", r18b.state.doc.textContent.indexOf("带图标标题") !== -1)
}

// ---- 表格单元格内 SVG 粘贴（cell content 只收 inline，一律行内插入）----

// 定位某文本首次出现处之后的绝对位置（用于单元格内构造光标）
function posAfterText(doc: any, needle: string): number {
  var found = -1
  doc.descendants(function (node: any, pos: number) {
    if (found === -1 && node.isText && node.textContent.indexOf(needle) !== -1) {
      found = pos + node.textContent.indexOf(needle) + needle.length
    }
    return true
  })
  return found
}

function posAtText(doc: any, needle: string): number {
  var found = -1
  doc.descendants(function (node: any, pos: number) {
    if (found === -1 && node.isText && node.textContent.indexOf(needle) !== -1) {
      found = pos + node.textContent.indexOf(needle)
    }
    return true
  })
  return found
}

// 19. SVG 粘贴到单元格文字中间 → 行内 raw_inline，表格不拆
{
  var mdTable = "| 名称 | 说明 |\n| --- | --- |\n| 看图标 | 备注行 |\n"
  var docT = parseMarkdown(schema, parser, mdTable)
  var posMid = posAfterText(docT, "看图")
  var r19 = paste(stateWithCursor(mdTable, posMid), SVG_SRC)
  assert("svg paste mid-cell handled", r19.handled === true)
  assert("svg mid-cell renders as raw_inline", hasSvgRawInline(r19.state))
  var names19 = topNodeNames(r19.state)
  assert("table not split by inline svg", names19.length === 1 && names19[0] === "table", JSON.stringify(names19))
}

// 20. SVG 粘贴到单元格行首 → 仍行内 raw_inline（cell 不允许块级，不拆表）
{
  var mdTable2 = "| 名称 | 说明 |\n| --- | --- |\n| 图标 | 备注行 |\n"
  var docT2 = parseMarkdown(schema, parser, mdTable2)
  var posStart = posAtText(docT2, "图标")
  var r20 = paste(stateWithCursor(mdTable2, posStart), SVG_SRC)
  assert("svg paste at cell start handled", r20.handled === true)
  assert("svg at cell start stays inline", hasSvgRawInline(r20.state))
  var names20 = topNodeNames(r20.state)
  assert("table not split at cell start", names20.length === 1 && names20[0] === "table", JSON.stringify(names20))
}

// ---- 行末尾 / 行内 svg 之后粘贴（用户报告的回归场景）----

// 定位首个行内 svg raw_inline 之后的光标位置（紧跟其后，无空格）
function posAfterRawInline(doc: any): number {
  var found = -1
  doc.descendants(function (node: any, pos: number) {
    if (found === -1 && node.type.name === "raw_inline" && /^<svg\b/i.test(node.textContent)) {
      found = pos + node.nodeSize
    }
    return true
  })
  return found
}

// 统计 svg raw_inline 的个数
function countSvgRawInline(state: EditorState): number {
  var count = 0
  state.doc.descendants(function (node: any) {
    if (node.type.name === "raw_inline" && /^<svg\b/i.test(node.textContent)) {
      count += 1
    }
    return true
  })
  return count
}

// 21. 光标在行末尾（段落最后一个字之后）→ 行内 raw_inline，段落不劈开
{
  var r21 = paste(stateWithCursor("看图标说明", 6), SVG_SRC)
  assert("svg paste at line end handled", r21.handled === true)
  assert("svg at line end renders as raw_inline", hasSvgRawInline(r21.state))
  var names21 = topNodeNames(r21.state)
  assert("paragraph not split by line-end svg", names21.length === 1 && names21[0] === "paragraph", JSON.stringify(names21))
}

// 22. 光标在行末尾、且行内已有一个 svg（紧跟其后，无空格）→ 仍行内插入
{
  var md22 = "看 " + SVG_SRC
  var doc22 = parseMarkdown(schema, parser, md22)
  var pos22 = posAfterRawInline(doc22)
  var r22 = paste(stateWithCursor(md22, pos22), SVG_SRC)
  assert("svg paste right after inline svg handled", r22.handled === true)
  assert("svg after inline svg renders as raw_inline", countSvgRawInline(r22.state) === 2, "count=" + countSvgRawInline(r22.state))
  var names22 = topNodeNames(r22.state)
  assert("paragraph not split after inline svg", names22.length === 1 && names22[0] === "paragraph", JSON.stringify(names22))
}

// 23. 行内 svg 之后再粘贴 svg → 两个 raw_inline 相邻共处同一段落
{
  var md23 = "看 " + SVG_SRC + " 说明"
  var doc23 = parseMarkdown(schema, parser, md23)
  var pos23 = posAfterRawInline(doc23)
  var r23 = paste(stateWithCursor(md23, pos23), SVG_SRC)
  assert("consecutive svg paste handled", r23.handled === true)
  assert("consecutive svg both inline", countSvgRawInline(r23.state) === 2, "count=" + countSvgRawInline(r23.state))
  var names23 = topNodeNames(r23.state)
  assert("paragraph not split by consecutive svg", names23.length === 1 && names23[0] === "paragraph", JSON.stringify(names23))
}

// 24. md 源码解析：heading 内 svg → 降级为字面文本，不抛错、不产生 raw_inline
{
  var md24 = "# 带图标 " + SVG_SRC + " 标题"
  var doc24 = parseMarkdown(schema, parser, md24)
  var state24 = EditorState.create({ schema: schema, doc: doc24 })
  var names24 = topNodeNames(state24)
  assert("heading svg in source degrades to single heading", names24.length === 1 && names24[0] === "heading", JSON.stringify(names24))
  assert("heading svg stays literal text", state24.doc.textContent.indexOf("<svg") !== -1)
  assert("no raw_inline in heading from source", !hasSvgRawInline(state24))
}

// 25. md 源码解析：heading 内 $$ 公式 / 脚注引用 → 同样降级为字面文本，不抛错
{
  var doc25 = parseMarkdown(schema, parser, "# 公式 $$x^2$$ 与脚注[^1] 标题\n\n[^1]: 脚注内容")
  var state25 = EditorState.create({ schema: schema, doc: doc25 })
  var names25 = topNodeNames(state25)
  assert("heading formula/footnote degrades to single heading", names25[0] === "heading", JSON.stringify(names25))
  assert("heading keeps literal formula text", state25.doc.textContent.indexOf("$$x^2$$") !== -1)
}

if (failures) {
  console.log("FAILED: " + failures + " case(s)")
  process.exit(1)
}
console.log("ALL PASS")