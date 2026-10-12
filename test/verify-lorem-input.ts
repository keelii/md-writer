// lorem 占位文本输入规则验证：空段落逐字输入 "lorem"，最后输入空格时
// 触发规则，段落替换为完整 Lorem ipsum 占位文本。
import { EditorState, TextSelection } from "prosemirror-state"
import { Node as PMNode } from "prosemirror-model"
import { buildSchema } from "../src/prosemirror/schema"
import { buildPlugins } from "../src/prosemirror/plugins"

var LOREM_TEXT =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Fusce est sem, ornare vitae mauris sed, faucibus tempor mi. Nullam at lobortis lacus. Quisque euismod, enim a eleifend egestas, magna ex lobortis sem, eu convallis felis justo vitae turpis. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Sed eget arcu ex. Aenean nec metus odio. Vestibulum congue augue ex, non vulputate dolor egestas ac."

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

// 逐字输入一串文本：未 handled 的字符手动 insertText 应用，
// handled 的字符交由规则返回的 state。
function typeString(state: EditorState, text: string) {
  var current = state
  var chars = text.split("")
  for (var i = 0; i < chars.length; i += 1) {
    var result = typeText(current, chars[i])
    if (result.handled) {
      current = result.state
    } else {
      current = current.apply(current.tr.insertText(chars[i]))
    }
  }
  return current
}

// 构造 state：给定块节点，光标在块内容末尾。
function stateWithBlock(block: PMNode) {
  var doc = schema.nodes.doc.create(null, block)
  return EditorState.create({
    doc: doc,
    selection: TextSelection.create(doc, 1 + block.content.size)
  })
}

function paraText(state: EditorState): string {
  var out = ""
  state.doc.forEach(function (block) {
    block.forEach(function (child) {
      out += child.text || ""
    })
  })
  return out
}

// ---- 用例 1：空段落逐字输入 "lorem "，前 5 个字符不触发，空格触发替换 ----
var emptyPara = stateWithBlock(schema.nodes.paragraph.create())
var chars = ["l", "o", "r", "e", "m"]
var before = emptyPara
for (var c = 0; c < chars.length; c += 1) {
  var step = typeText(before, chars[c])
  assert("char '" + chars[c] + "' not handled", step.handled === false)
  before = before.apply(before.tr.insertText(chars[c]))
}
assert("typed lorem joined", paraText(before) === "lorem", paraText(before))
// 输入空格触发替换
var spaceResult = typeText(before, " ")
assert("space after lorem handled", spaceResult.handled === true)
assert("paragraph replaced with lorem text", paraText(spaceResult.state) === LOREM_TEXT, paraText(spaceResult.state).slice(0, 60))

// ---- 用例 2：替换后光标在文本末尾，可继续输入 ----
var after = spaceResult.state.apply(spaceResult.state.tr.insertText("!"))
assert("append after replacement", paraText(after) === LOREM_TEXT + "!", "")

// ---- 用例 3：替换后段落仍是 paragraph 节点 ----
var blockTypeAfter: string | null = null
spaceResult.state.doc.forEach(function (block) {
  blockTypeAfter = block.type.name
})
assert("still paragraph after replacement", blockTypeAfter === "paragraph", String(blockTypeAfter))

// ---- 用例 4：段落中部（前有其他文字）不触发，避免误伤 ----
var midState = stateWithBlock(schema.nodes.paragraph.create(null, schema.text("foo ")))
var midAfter = typeString(midState, "lorem")
var midSpace = typeText(midAfter, " ")
assert("mid-paragraph lorem not handled", midSpace.handled === false)
var midTyped = midSpace.state.apply(midSpace.state.tr.insertText(" "))
assert("mid-paragraph text kept", paraText(midTyped) === "foo lorem ", paraText(midTyped))

// ---- 用例 5：code_block 内不触发 ----
var codeState = stateWithBlock(schema.nodes.code_block.create())
var codeAfter = typeString(codeState, "lorem")
var codeSpace = typeText(codeAfter, " ")
assert("code_block lorem not handled", codeSpace.handled === false)
var codeTyped = codeSpace.state.apply(codeSpace.state.tr.insertText(" "))
assert("code_block text kept", paraText(codeTyped) === "lorem ", paraText(codeTyped))

// ---- 用例 6：heading 内不触发（parent 非 paragraph） ----
var headingState = stateWithBlock(schema.nodes.heading.create())
var headingAfter = typeString(headingState, "lorem")
var headingSpace = typeText(headingAfter, " ")
assert("heading lorem not handled", headingSpace.handled === false)

// ---- 用例 7：lorem 后接的不是空格（如逗号）不触发 ----
var commaState = stateWithBlock(schema.nodes.paragraph.create())
var commaAfter = typeString(commaState, "lorem")
var commaResult = typeText(commaAfter, ",")
assert("lorem comma not handled", commaResult.handled === false)

// ---- 用例 8：规则不影响其他前缀输入（回归：段落起始正常输入） ----
var normalState = stateWithBlock(schema.nodes.paragraph.create())
var normalAfter = typeString(normalState, "hello world ")
assert("normal typing unaffected", paraText(normalAfter) === "hello world ", paraText(normalAfter))

if (failures > 0) {
  console.log(failures + " failure(s)")
  process.exit(1)
} else {
  console.log("ALL PASS")
}