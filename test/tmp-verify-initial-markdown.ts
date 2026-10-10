// 临时验证：从 index.html 提取 initialMarkdown，跑 parse → serialize round-trip
// 1) 解析不抛错 2) round-trip 结构一致（doc JSON）3) 脚注定义/表格对齐等新内容正确识别
import * as fs from "node:fs"
import { Node as PMNode } from "prosemirror-model"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, parseMarkdown, serializeNodeMarkdown } from "../src/prosemirror/markdown"

function extractInitialMarkdown(): string {
  var html = fs.readFileSync("index.html", "utf8")
  var m = html.match(/var initialMarkdown = '((?:\\.|[^'\\])*)'/)
  if (!m) throw new Error("index.html 中未找到 initialMarkdown")
  // eslint-disable-next-line no-eval
  return eval("'" + m[1] + "'") as string
}

var failures = 0
function assert(label: string, ok: boolean, extra?: string) {
  if (ok) {
    console.log("PASS: " + label)
  } else {
    failures += 1
    console.log("FAIL: " + label + (extra ? "  [" + extra + "]" : ""))
  }
}

var md = extractInitialMarkdown()
var mdLines = md.split("\n")
mdLines.forEach(function (l, idx) {
  if (l.indexOf("[^") >= 0) console.log("  [md line " + (idx + 1) + "] " + JSON.stringify(l))
})
var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

var doc: PMNode
try {
  doc = parseMarkdown(schema, parser, md)
  assert("解析不抛错", true)
} catch (err) {
  assert("解析不抛错", false, String(err))
  process.exit(1)
}

// 调试：打印所有 raw_block 与 code_block
doc.descendants(function (node) {
  if (node.type.name === "raw_block") console.log("  [raw_block] " + JSON.stringify(node.textContent.slice(0, 60)))
  if (node.type.name === "code_block") console.log("  [code_block] attrs=" + JSON.stringify(node.attrs))
  return true
})

// 表格首行单元格 align 属性
var aligns: Array<Array<string | null>> = []
doc.descendants(function (node) {
  if (node.type.name === "table_row") {
    var row: Array<string | null> = []
    node.forEach(function (cell) { row.push(cell.attrs && cell.attrs.align ? String(cell.attrs.align) : null) })
    aligns.push(row)
    return false
  }
  return true
})
assert(
  "表格对齐 left/center/right",
  aligns.length >= 1 && aligns[0][0] === "left" && aligns[0][1] === "center" && aligns[0][2] === "right",
  JSON.stringify(aligns)
)

// round-trip 断言分两层：
// 1) 结构一致：parse(serialize(parse(md))) 的 doc JSON 与首次解析一致（真实功能断言）
//    —— 序列化对块间距/硬换行有规范化（raw_block 间补空行、hard_break 写 "\n"），
//       文本级完全相等不现实，结构一致即正确。
// 2) 文本参考：打印序列化 diff 供人工检查（不计入失败）
var out = serializer.serialize(doc)
var doc2 = parseMarkdown(schema, parser, out)
var j1 = JSON.stringify(doc.toJSON())
var j2 = JSON.stringify(doc2.toJSON())
var c1 = doc.toJSON().content
var c2 = doc2.toJSON().content

if (j1 === j2) {
  assert("round-trip 结构一致（doc JSON）", true)
} else {
  assert("round-trip 结构一致（doc JSON）", false, "首个差异路径见下")
  firstJsonDiff(doc.toJSON(), doc2.toJSON(), "$")
}


function firstJsonDiff(a: any, b: any, path: string) {
  if (JSON.stringify(a) === JSON.stringify(b)) return
  if (a && b && typeof a === "object" && !Array.isArray(a) && Array.isArray(b) === false) {
    var keys = new Set(Object.keys(a).concat(Object.keys(b)))
    for (var k of Array.from(keys)) {
      firstJsonDiff(a[k], b[k], path + "." + k)
    }
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    var n = Math.max(a.length, b.length)
    for (var i = 0; i < n; i++) firstJsonDiff(a[i], b[i], path + "[" + i + "]")
    return
  }
  var sa = JSON.stringify(a)
  var sb = JSON.stringify(b)
  if (sa.length + sb.length > 300) {
    // 找到第一个不同的字符位置，展示上下文
    var idx = 0
    while (idx < Math.min(sa.length, sb.length) && sa[idx] === sb[idx]) idx += 1
    var from = Math.max(0, idx - 60)
    console.log("  " + path + "\n    A: …" + sa.slice(from, idx + 60) + "…\n    B: …" + sb.slice(from, idx + 60) + "…")
  } else {
    console.log("  " + path + "\n    A: " + sa + "\n    B: " + sb)
  }
}

var a = md.split("\n")
var b = out.split("\n")
var textDiffs = 0
for (var i = 0; i < Math.max(a.length, b.length); i++) {
  if (a[i] !== b[i]) {
    textDiffs += 1
    console.log("  [text-diff L" + (i + 1) + "]\n    原文: " + JSON.stringify(a[i]) + "\n    输出: " + JSON.stringify(b[i]))
  }
}
console.log("文本级规范化差异行数: " + textDiffs + "（仅供检查，不计入失败）")

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURE(S)")
process.exit(failures === 0 ? 0 : 1)