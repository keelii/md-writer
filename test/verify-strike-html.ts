import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, parseMarkdown } from "../src/prosemirror/markdown"

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

function roundtrip(md: string): string {
  var doc = parseMarkdown(schema, parser, md)
  return serializer.serialize(doc)
}

var failures = 0
function check(name: string, actual: string, expected: string) {
  if (actual === expected) {
    console.log("PASS: " + name)
  } else {
    failures += 1
    console.log("FAIL: " + name)
    console.log("  expected: " + JSON.stringify(expected))
    console.log("  actual:   " + JSON.stringify(actual))
  }
}

// 1. strikethrough 解析为 strike mark
var strikeDoc = parseMarkdown(schema, parser, "~~strikethrough~~")
var strikePara = strikeDoc.firstChild
if (!strikePara) {
  throw new Error("strike paragraph missing")
}
var strikeText = strikePara.firstChild
if (!strikeText || !strikeText.marks || strikeText.marks.length !== 1 || strikeText.marks[0].type.name !== "strike") {
  failures += 1
  console.log("FAIL: strike mark parse, marks=" + JSON.stringify(strikeText && strikeText.marks ? strikeText.marks.map(function (m) { return m.type.name }) : null))
} else {
  console.log("PASS: strike mark parse")
}

// 2. strikethrough roundtrip
check("strike roundtrip", roundtrip("~~strikethrough~~"), "~~strikethrough~~")

// 3. strike 与 bold 混合
check("strike with bold roundtrip", roundtrip("**bold** and ~~strike~~"), "**bold** and ~~strike~~")

// 4. 块级 div 单行保留
check("single-line div raw", roundtrip("<div>test</div>"), "<div>test</div>")

// 5. 块级 div 多行保留
var multiLineHtml = "<div class=\"box\">\n  <p>inner</p>\n</div>"
check("multi-line div raw", roundtrip(multiLineHtml), multiLineHtml)

// 6. div 前后 markdown 段落不受影响
var mixedMd = "before\n\n<div>test</div>\n\nafter"
var mixedOut = roundtrip(mixedMd)
if (mixedOut.indexOf("<div>test</div>") >= 0 && mixedOut.indexOf("before") >= 0 && mixedOut.indexOf("after") >= 0) {
  console.log("PASS: mixed div context")
} else {
  failures += 1
  console.log("FAIL: mixed div context, actual=" + JSON.stringify(mixedOut))
}

// 7. svg 原样保留
var svgHtml = "<svg width=\"10\" height=\"10\"><circle cx=\"5\" cy=\"5\" r=\"4\"></circle></svg>"
check("svg raw", roundtrip(svgHtml), svgHtml)

// 8. 原有表格功能回归
var tableMd = "| H1 | H2 |\n| --- | --- |\n| a | b |"
check("table roundtrip", roundtrip(tableMd), tableMd)

// 9. 原有行内 code 回归
check("code inline roundtrip", roundtrip("use `code` here"), "use `code` here")

if (failures > 0) {
  console.log("\n" + failures + " test(s) failed")
  process.exit(1)
}
console.log("\nAll tests passed")