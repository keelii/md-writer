// 行内 mark 末尾连输两个空格跳出功能验证：
// 输入第二个空格时触发 input rule，删除已插入的第一个空格并清除待输入 mark。
import { EditorState, TextSelection } from "prosemirror-state"
import { Node as PMNode } from "prosemirror-model"
import { buildSchema } from "../src/prosemirror/schema"
import { buildPlugins } from "../src/prosemirror/plugins"

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
var plugins = buildPlugins(schema)
var handleTextInput: any = null
for (var i = 0; i < plugins.length; i += 1) {
  var props = (plugins[i] as any).props
  if (props && typeof props.handleTextInput === "function") {
    handleTextInput = props.handleTextInput
  }
}
if (!handleTextInput) {
  throw new Error("no inputRules plugin found")
}

// 模拟输入：对给定 state 调用插件 handleTextInput。
// 返回 { handled, state }（dispatch 在闭包中应用到 state 上）。
function typeText(state: EditorState, text: string) {
  var applied = state
  var handled = handleTextInput(
    {
      composing: false,
      state: state,
      dispatch: function (tr: any) {
        applied = applied.apply(tr)
      }
    },
    state.selection.from,
    state.selection.to,
    text
  )
  return { handled: handled, state: applied }
}

// 构造 state：单个段落，children 为 [文本, mark 集] 列表，光标在段落末尾。
function buildState(children: Array<[string, string[]]>) {
  var nodes: PMNode[] = []
  for (var i = 0; i < children.length; i += 1) {
    var pair = children[i]
    var marks = pair[1].map(function (name) {
      return schema.marks[name].create()
    })
    nodes.push(schema.text(pair[0], marks))
  }
  var para = schema.nodes.paragraph.create(null, nodes)
  var doc = schema.nodes.doc.create(null, para)
  return EditorState.create({
    doc: doc,
    selection: TextSelection.create(doc, 1 + para.content.size)
  })
}

// 段落内容概要："文本[mark1,mark2]" 列表，用于断言。
function summarizeChildren(state: EditorState): string[] {
  var out: string[] = []
  state.doc.forEach(function (para) {
    para.forEach(function (child) {
      var names = child.marks.map(function (m) {
        return m.type.name
      })
      out.push((child.text || child.type.name) + "[" + names.sort().join(",") + "]")
    })
  })
  return out
}

// ---- 用例 1：各 mark 末尾双空格跳出 ----
var markNames = [
  "code",
  "strong",
  "em",
  "strike",
  "underline",
  "highlight",
  "subscript",
  "superscript",
  "kbd",
  "abbreviation"
]
for (var m = 0; m < markNames.length; m += 1) {
  var markName = markNames[m]
  // 前提回归：第一个空格插入后携带 mark（否则规则无从触发）
  var baseState = buildState([["foo", [markName]]])
  var afterFirst = baseState.apply(baseState.tr.insertText(" "))
  var firstSummary = summarizeChildren(afterFirst)
  var firstJoined = firstSummary.map(function (s) { return s.replace(/\[.*\]$/, "") }).join("")
  assert(
    "first space inherits " + markName,
    firstJoined === "foo " && firstSummary.every(function (s) {
      return s.indexOf("[" + markName + "]") >= 0
    }),
    firstSummary.join("|")
  )
  // 第二个空格：规则应消费手势，第一个空格保留但移除 mark（跳出到 mark 之外）
  var result = typeText(afterFirst, " ")
  assert("second space handled for " + markName, result.handled === true)
  assert(
    "first space unmarked for " + markName,
    summarizeChildren(result.state).join("|") === "foo[" + markName + "]| []",
    summarizeChildren(result.state).join("|")
  )
  // 跳出后继续输入不带 mark
  var typed = result.state.apply(result.state.tr.insertText("x"))
  assert(
    "subsequent typing unmarked for " + markName,
    summarizeChildren(typed).join("|") === "foo[" + markName + "]| x[]",
    summarizeChildren(typed).join("|")
  )
}

// ---- 用例 2：无 mark 的普通文本双空格不触发 ----
var plainState = buildState([["foo", []]])
plainState = plainState.apply(plainState.tr.insertText(" "))
var plainResult = typeText(plainState, " ")
assert("plain double space not handled", plainResult.handled === false)

// ---- 用例 3：光标在 mark 中间（nodeAfter 延续 mark）不触发 ----
var middleState = buildState([["abcd", ["code"]]])
// 光标移到 ab 与 cd 之间（pos 3），插入第一个空格后 textBefore 以 "  " 结尾仍会尝试匹配
var middleDoc = middleState.doc
middleState = EditorState.create({
  doc: middleDoc,
  selection: TextSelection.create(middleDoc, 3)
})
middleState = middleState.apply(middleState.tr.insertText(" "))
var middleResult = typeText(middleState, " ")
assert("inside mark not handled", middleResult.handled === false)
var middleSummary = summarizeChildren(middleResult.state)
var middleJoined = middleSummary.map(function (s) { return s.replace(/\[.*\]$/, "") }).join("")
var middleAllCode = middleSummary.every(function (s) { return /\bcode\b/.test(s) })
assert("inside mark text kept", middleJoined === "ab cd" && middleAllCode, middleSummary.join("|"))

// ---- 用例 4：code_block 内双空格不触发 ----
var codeBlock = schema.nodes.code_block.create(null, schema.text("foo"))
var cbDoc = schema.nodes.doc.create(null, codeBlock)
var cbState = EditorState.create({
  doc: cbDoc,
  selection: TextSelection.create(cbDoc, 1 + 3)
})
cbState = cbState.apply(cbState.tr.insertText(" "))
var cbResult = typeText(cbState, " ")
assert("code block double space not handled", cbResult.handled === false)

// ---- 用例 5：嵌套 mark 只跳出内层 ----
// 结构：a(strong) + 空格(strong+em) + c(strong)，光标在空格后
var nestedBuilt = buildState([
  ["a", ["strong"]],
  ["b", ["strong", "em"]],
  [" ", ["strong", "em"]],
  ["c", ["strong"]]
])
// 光标放在带 mark 的空格之后（pos 4），"c" 之前
var nestedState = EditorState.create({
  doc: nestedBuilt.doc,
  selection: TextSelection.create(nestedBuilt.doc, 4)
})
var nestedResult = typeText(nestedState, " ")
assert("nested handled", nestedResult.handled === true)
assert(
  "nested space unmarked, outer strong kept",
  summarizeChildren(nestedResult.state).join("|") === "a[strong]|b[em,strong]| c[strong]",
  summarizeChildren(nestedResult.state).join("|")
)
// 跳出 em 后 strong 应保留（storedMarks）
var nestedTyped = nestedResult.state.apply(nestedResult.state.tr.insertText("x"))
assert(
  "outer strong kept after exit",
  summarizeChildren(nestedTyped).join("|") === "a[strong]|b[em,strong]| xc[strong]",
  summarizeChildren(nestedTyped).join("|")
)

// ---- 用例 6：Chrome 无 pre-wrap 行为模拟 —— 第二个空格以 nbsp 形式进入 ----
// handleTextInput 收到 text="\u00a0"（textBefore = "abc \u00a0"），规则仍应触发
var nbspState = buildState([["foo", ["code"]]])
nbspState = nbspState.apply(nbspState.tr.insertText(" "))
var nbspResult = typeText(nbspState, "\u00a0")
assert("nbsp second space handled", nbspResult.handled === true)
assert(
  "nbsp space unmarked",
  summarizeChildren(nbspResult.state).join("|") === "foo[code]| []",
  summarizeChildren(nbspResult.state).join("|")
)

// ---- 用例 7：行尾场景 —— 第一个空格已被浏览器写成 nbsp ----
var nbspTail = buildState([["foo", ["code"]]])
nbspTail = nbspTail.apply(nbspTail.tr.insertText("\u00a0"))
var nbspTailResult = typeText(nbspTail, "\u00a0")
assert("tail nbsp double handled", nbspTailResult.handled === true)
assert(
  "tail nbsp unmarked",
  summarizeChildren(nbspTailResult.state).join("|") === "foo[code]|\u00a0[]",
  summarizeChildren(nbspTailResult.state).join("|")
)

// ---- 用例 8：普通文本 nbsp 不触发（防误伤） ----
var plainNbsp = buildState([["foo", []]])
plainNbsp = plainNbsp.apply(plainNbsp.tr.insertText(" "))
var plainNbspResult = typeText(plainNbsp, "\u00a0")
assert("plain nbsp not handled", plainNbspResult.handled === false)

if (failures > 0) {
  console.log(failures + " failure(s)")
  process.exit(1)
} else {
  console.log("ALL PASS")
}