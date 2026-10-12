// 链接按钮智能直达验证（createLinkAction + isCompleteHttpUrl）：
// - 选中文本恰好是完整链接地址（http/https，经 URL 构造器判定）且不含 link mark：
//   点击链接按钮直接对选区应用 link mark（href 即选中文本），不弹窗
// - 选区首尾带空白时，mark 范围收缩到地址部分（空白留在链接外）
// - 非完整地址（无协议 / 纯文本 / ftp / 含换行）：不直达，走弹窗路径
//   （Node 环境无 document，runManagedDialog 构建弹窗 DOM 时抛错，
//   以抛错佐证走到了弹窗分支而非静默直达）
// - isCompleteHttpUrl 纯函数判定表的各分支
// 运行：npx --yes tsx --import ./test/css-shim.mjs test/verify-link-url.ts
import { EditorState, TextSelection } from "prosemirror-state"
import { Node as PMNode } from "prosemirror-model"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, parseMarkdown } from "../src/prosemirror/markdown"
import { isCompleteHttpUrl } from "../src/prosemirror/commands"
import { actionByName } from "../src/prosemirror/actions"

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
var linkAction = actionByName(schema, "link", {})
if (typeof linkAction !== "function") {
  throw new Error("link action not found")
}

function fakeView(markdown: string, selectFrom: number, selectTo: number) {
  var doc = parseMarkdown(schema, parser, markdown)
  var state = EditorState.create({ schema: schema, doc: doc })
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, selectFrom, selectTo)))
  var focused = 0
  var view: any = {
    state: state,
    dom: { isConnected: true, contains: function () { return true } },
    dispatch: function (tr: any) {
      view.state = view.state.apply(tr)
    },
    focus: function () {
      focused += 1
    }
  }
  view.focused = function () {
    return focused
  }
  return view
}

// 计算文档顶层文本中目标子串的绝对位置（便于按内容定位选区）
function findTextPos(state: EditorState, needle: string): { from: number; to: number } | null {
  var found: { from: number; to: number } | null = null
  state.doc.descendants(function (node: PMNode, pos: number) {
    if (found || !node.isText || node.marks.length > 0) {
      return !found
    }
    var idx = node.textContent.indexOf(needle)
    if (idx >= 0) {
      found = { from: pos + idx, to: pos + idx + needle.length }
      return false
    }
    return true
  })
  return found
}

// 选中 markdown 中某段文本后点击链接按钮，返回 view 供检查结果
function clickLinkOn(markdown: string, needle: string) {
  var view = fakeView(markdown, 1, 1)
  var range = findTextPos(view.state, needle)
  if (!range) {
    throw new Error("needle not found in doc: " + needle)
  }
  var state = view.state as EditorState
  view.state = state.apply(
    state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to))
  )
  linkAction(view)
  return view
}

// 遍历选区内文本节点，收集 link mark 的 href 与其覆盖范围文本
function linkMarksInSelection(state: EditorState, from: number, to: number) {
  var results: Array<{ href: string; text: string }> = []
  state.doc.nodesBetween(from, to, function (node: PMNode, pos: number) {
    var link = node.marks.find(function (mark) { return mark.type.name === "link" })
    if (link) {
      results.push({ href: String(link.attrs.href), text: node.textContent })
    }
    return true
  })
  return results
}

// ---- 1. isCompleteHttpUrl 纯函数判定表 ----
console.log("--- 1. isCompleteHttpUrl 判定表 ---")
assert("1a https 地址", isCompleteHttpUrl("https://example.com/a?b=1") === true)
assert("1b http 地址", isCompleteHttpUrl("http://example.com") === true)
assert("1c 本机端口地址", isCompleteHttpUrl("http://127.0.0.1:8080/path") === true)
assert("1d 无协议不通过", isCompleteHttpUrl("example.com") === false)
assert("1e www 前缀无协议不通过", isCompleteHttpUrl("www.example.com") === false)
assert("1f 纯文本不通过", isCompleteHttpUrl("看看这段") === false)
assert("1g 空串不通过", isCompleteHttpUrl("") === false)
assert("1h ftp 协议不通过", isCompleteHttpUrl("ftp://example.com") === false)
assert("1i javascript: 伪协议不通过", isCompleteHttpUrl("javascript:alert(1)") === false)
assert("1j 含换行不通过（URL 构造器会剥离换行，需显式拒绝）", isCompleteHttpUrl("https://a.com\nx") === false)
assert("1k 含制表符不通过", isCompleteHttpUrl("https://a.com\tx") === false)

// ---- 2. 选区为完整 URL：点击链接按钮直达，不弹窗 ----
console.log("")
console.log("--- 2. 选区完整 URL 直达 ---")
{
  var view = clickLinkOn("参考 https://example.com/docs 收尾", "https://example.com/docs")
  var sel = view.state.selection
  var marks = linkMarksInSelection(view.state, 1, view.state.doc.content.size)
  assert("2a 直接应用 link mark（未弹窗）", marks.length === 1, JSON.stringify(marks))
  assert("2b href 即选中文本", marks[0] && marks[0].href === "https://example.com/docs")
  assert("2c 链接文本为选中的地址", marks[0] && marks[0].text === "https://example.com/docs")
  assert("2d 选区未被替换删除", view.state.doc.textContent.indexOf("参考") >= 0)
  assert("2e 收尾文本保留", view.state.doc.textContent.indexOf("收尾") >= 0)
  assert("2f 编辑器重新聚焦", view.focused() === 1)
  void sel
}

// ---- 3. 选区带首尾空白：mark 收缩到地址部分 ----
console.log("")
console.log("--- 3. 首尾空白收缩 ---")
{
  // " 参考 " 中间是地址：在文档里构造为 "看 https://a.com 落"，选中整段（含两端空格）
  var view = fakeView("看 https://a.com 落", 1, 1)
  var range = findTextPos(view.state, "https://a.com")
  if (!range) {
    throw new Error("setup failed")
  }
  // 选区含地址前后各一个空格
  var from = range.from - 1
  var to = range.to + 1
  var state = view.state as EditorState
  view.state = state.apply(state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
  linkAction(view)
  var marks = linkMarksInSelection(view.state, 1, view.state.doc.content.size)
  assert("3a 空白边缘选区仍直达", marks.length === 1, JSON.stringify(marks))
  assert("3b mark 只覆盖地址本身", marks[0] && marks[0].text === "https://a.com", marks[0] ? marks[0].text : "")
  assert("3c href 为 trim 后地址", marks[0] && marks[0].href === "https://a.com")
}

// ---- 4. 非完整地址：走弹窗分支（Node 无 document，runManagedDialog 抛错） ----
console.log("")
console.log("--- 4. 非完整地址走弹窗 ---")
{
  var threw = false
  try {
    clickLinkOn("看 www.example.com 落", "www.example.com")
  } catch (error) {
    threw = true
  }
  assert("4a 无协议地址进入弹窗分支（构建弹窗 DOM 抛错）", threw === true)
}

// ---- 5. 选区含 link mark：进入编辑弹窗分支（不会误直达） ----
console.log("")
console.log("--- 5. 已是链接的选区走编辑弹窗 ---")
{
  var threw2 = false
  try {
    clickLinkOn("[已有](https://a.com) 链接", "已有")
  } catch (error) {
    threw2 = true
  }
  assert("5a 链接 mark 选区进入编辑弹窗分支", threw2 === true)
}

console.log("")
if (failures > 0) {
  console.log("RESULT: " + failures + " FAILED")
  process.exit(1)
}
console.log("RESULT: ALL PASS")