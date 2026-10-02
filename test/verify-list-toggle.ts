// 列表互转功能验证：光标在有序列表上点击无序列表命令应转换列表类型（内容保留），反之亦然
import { EditorState, TextSelection } from "prosemirror-state"
import { commandByName } from "../src/prosemirror/commands"
import { buildMarkdownParser, buildMarkdownSerializer, parseMarkdown } from "../src/prosemirror/markdown"
import { buildSchema } from "../src/prosemirror/schema"

var failures = 0

function assertEqual(actual: any, expected: any, label: string) {
  if (actual === expected) {
    console.log("PASS: " + label)
  } else {
    failures += 1
    console.log("FAIL: " + label)
    console.log("  expected: " + JSON.stringify(expected))
    console.log("  actual:   " + JSON.stringify(actual))
  }
}

function runCommandOnDoc(markdown: string, cursorOffsetInText: number, commandName: string) {
  var schema = buildSchema()
  var parser = buildMarkdownParser(schema)
  var serializer = buildMarkdownSerializer(schema)
  var doc = parseMarkdown(schema, parser, markdown)
  if (!doc) {
    throw new Error("parse failed for: " + markdown)
  }
  // 在正文第一个文本中定位光标
  var textPos = -1
  doc.descendants(function (node, pos) {
    if (textPos < 0 && node.isText && node.text) {
      textPos = pos + Math.min(cursorOffsetInText, node.text.length)
    }
    return true
  })
  var state = EditorState.create({
    doc: doc,
    selection: TextSelection.create(doc, textPos)
  })
  var cmd = commandByName(schema, commandName)
  if (!cmd) {
    throw new Error("command not found: " + commandName)
  }
  var applied = cmd(state, function (tr) {
    state = state.apply(tr)
  })
  return { applied: applied, state: state, serializer: serializer }
}

// 用例 1：光标在有序列表上，执行 bullet_list 命令 → 转换为无序列表
function testOrderedToBullet() {
  var result = runCommandOnDoc("1. first\n2. second\n", 2, "bullet_list")
  assertEqual(result.applied, true, "ordered→bullet applied")
  var out = result.serializer.serialize(result.state.doc)
  // 项目 serializer 的 bullet 默认输出 "*"（prosemirror-markdown 库默认），与既有行为一致
  assertEqual(out, "* first\n* second", "ordered→bullet serialize")
}

// 用例 2：光标在无序列表上，执行 ordered_list 命令 → 转换为有序列表
function testBulletToOrdered() {
  var result = runCommandOnDoc("- first\n- second\n", 2, "ordered_list")
  assertEqual(result.applied, true, "bullet→ordered applied")
  var out = result.serializer.serialize(result.state.doc)
  assertEqual(out, "1. first\n2. second", "bullet→ordered serialize")
}

// 用例 3：光标在段落上，执行 bullet_list 命令 → 正常包裹（回归）
function testParagraphWrapBullet() {
  var result = runCommandOnDoc("plain paragraph\n", 2, "bullet_list")
  assertEqual(result.applied, true, "paragraph→bullet applied")
  var out = result.serializer.serialize(result.state.doc)
  assertEqual(out, "* plain paragraph", "paragraph→bullet serialize")
}

// 用例 4：光标在段落上，执行 ordered_list 命令 → 正常包裹（回归）
function testParagraphWrapOrdered() {
  var result = runCommandOnDoc("plain paragraph\n", 2, "ordered_list")
  assertEqual(result.applied, true, "paragraph→ordered applied")
  var out = result.serializer.serialize(result.state.doc)
  assertEqual(out, "1. plain paragraph", "paragraph→ordered serialize")
}

// 用例 5：互转后再次执行同命令（光标在 bullet_list 上点 bullet_list）→ wrapInList 回退路径
function testBulletOnBullet() {
  var result = runCommandOnDoc("- first\n", 2, "bullet_list")
  // wrapInList 在已处于同类型列表时返回 false 且不修改文档（库既有行为）
  assertEqual(result.applied, false, "bullet→bullet not applied (wrapInList no-op)")
  var out = result.serializer.serialize(result.state.doc)
  assertEqual(out, "* first", "bullet→bullet serialize unchanged")
}

// 用例 6：光标在无序列表上，再点一次无序列表（undo 回退路径由 wrapInList 处理）
function testOrderedOnOrdered() {
  var result = runCommandOnDoc("1. first\n", 2, "ordered_list")
  assertEqual(result.applied, false, "ordered→ordered not applied (wrapInList no-op)")
  var out = result.serializer.serialize(result.state.doc)
  assertEqual(out, "1. first", "ordered→ordered serialize unchanged")
}

testOrderedToBullet()
testBulletToOrdered()
testParagraphWrapBullet()
testParagraphWrapOrdered()
testBulletOnBullet()
testOrderedOnOrdered()

if (failures > 0) {
  console.log(failures + " failure(s)")
  process.exit(1)
} else {
  console.log("ALL PASS")
}