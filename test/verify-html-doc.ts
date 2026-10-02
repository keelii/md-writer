import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, parseMarkdown } from "../src/prosemirror/markdown"

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

var failures = 0
function check(name: string, actual: any, expected: any) {
  if (actual === expected) {
    console.log("PASS: " + name)
  } else {
    failures += 1
    console.log("FAIL: " + name)
    console.log("  expected: " + JSON.stringify(expected))
    console.log("  actual:   " + JSON.stringify(actual))
  }
}

// 1. 用户报告的原始输入：完整 HTML 文档 → 整体一个 raw_block，roundtrip 不变
var userDoc = [
  "<!DOCTYPE html>",
  "<html>",
  "  <head>",
  '    <meta charset="utf-8">',
  '    <script src="https://rawgit.com/fabricjs/fabric.js/master/dist/fabric.js"></script>',
  "  </head>",
  "  <body>",
  '    <canvas id="c" width="300" height="300" style="border:1px solid #ccc"></canvas>',
  "    <script>",
  "      (function() {",
  "        var canvas = new fabric.Canvas('c');",
  "      })();",
  "    </script>",
  "  </body>",
  "</html>"
].join("\n")
var parsed = parseMarkdown(schema, parser, userDoc)
check("user doc single raw_block", parsed.childCount, 1)
var parsedFirst = parsed.firstChild
check("user doc node type", parsedFirst && parsedFirst.type.name, "raw_block")
check("user doc text preserved", parsedFirst && parsedFirst.textContent, userDoc)
check("user doc roundtrip", serializer.serialize(parsed), userDoc)

// 2. 无 DOCTYPE，直接 <html> 开头
var htmlOnly = "<html>\n<head>\n<title>t</title>\n</head>\n<body>\n<p>hi</p>\n</body>\n</html>"
var parsedHtmlOnly = parseMarkdown(schema, parser, htmlOnly)
var parsedHtmlOnlyFirst = parsedHtmlOnly.firstChild
check("html-only single raw_block", parsedHtmlOnlyFirst && parsedHtmlOnlyFirst.type.name, "raw_block")
check("html-only roundtrip", serializer.serialize(parsedHtmlOnly), htmlOnly)

// 3. 缺少 </html>（截断粘贴）→ 收集到文档末尾
var truncated = "<!DOCTYPE html>\n<html>\n<body>\n<p>x</p>"
var parsedTrunc = parseMarkdown(schema, parser, truncated)
check("truncated doc raw text", parsedTrunc.firstChild && parsedTrunc.firstChild.textContent, truncated)

// 4. 单行完整文档
var singleLine = "<html><body><p>x</p></body></html>"
var parsedSingle = parseMarkdown(schema, parser, singleLine)
check("single line doc raw text", parsedSingle.firstChild && parsedSingle.firstChild.textContent, singleLine)

// 5. 文档结束后还有 markdown 文本 → 正常解析为段落
var docPlusMd = "<!DOCTYPE html>\n<html>\n<body>\n<p>x</p>\n</body>\n</html>\n\nafter text"
var parsedPlus = parseMarkdown(schema, parser, docPlusMd)
check("doc + md child count", parsedPlus.childCount, 2)
check("doc + md second is paragraph", parsedPlus.child(1).type.name, "paragraph")
check("doc + md second text", parsedPlus.child(1).textContent, "after text")
check("doc + md roundtrip", serializer.serialize(parsedPlus), docPlusMd)

// 6. 回归：普通 markdown 中夹杂 script 块不受影响
var mdScript = "# Title\n\n<script>\nvar a = 1\n</script>\n\ntail"
var parsedScript = parseMarkdown(schema, parser, mdScript)
check("markdown + script roundtrip", serializer.serialize(parsedScript), mdScript)

// 7. 回归：普通 div 块仍走原逻辑
var divBlock = "<div>\nhello\n</div>"
var parsedDiv = parseMarkdown(schema, parser, divBlock)
check("div block still raw", parsedDiv.firstChild && parsedDiv.firstChild.type.name, "raw_block")
check("div block roundtrip", serializer.serialize(parsedDiv), divBlock)

// 8. 回归：frontmatter 优先于文档分支
var fmDoc = "---\ntitle: t\n---\n\n# H"
var parsedFm = parseMarkdown(schema, parser, fmDoc)
check("frontmatter roundtrip", serializer.serialize(parsedFm), fmDoc)

// 9. 用户实际场景：```html 围栏包裹的完整 HTML 文档 → 保持为 code fence，roundtrip 不变
var fencedDoc = "```html\n" + userDoc + "\n```"
var parsedFenced = parseMarkdown(schema, parser, fencedDoc)
var fencedFirst = parsedFenced.firstChild
check("fenced doc is code_block", fencedFirst && fencedFirst.type.name, "code_block")
check("fenced doc roundtrip", serializer.serialize(parsedFenced), fencedDoc)

// 10. 围栏包裹 div 块 → 不被 raw block 分支抽走
var fencedDiv = "```\n<div>\nhello\n</div>\n```"
var parsedFencedDiv = parseMarkdown(schema, parser, fencedDiv)
check("fenced div is code_block", parsedFencedDiv.firstChild && parsedFencedDiv.firstChild.type.name, "code_block")
check("fenced div roundtrip", serializer.serialize(parsedFencedDiv), fencedDiv)

// 11. 围栏包裹 $$ 公式块 → 不被公式分支抽走
//（注：序列化器统一把围栏输出为 ```，~~~ 与 ``` 在 markdown 中等价）
var fencedMath = "~~~\n$$\nx\n$$\n~~~"
var parsedFencedMath = parseMarkdown(schema, parser, fencedMath)
check("fenced math is code_block", parsedFencedMath.firstChild && parsedFencedMath.firstChild.type.name, "code_block")
check("fenced math roundtrip", serializer.serialize(parsedFencedMath), "```\n$$\nx\n$$\n```")

// 12. 闭围栏比开围栏长 → 仍识别为闭合
var unevenFence = "```\ncode\n`````"
var parsedUneven = parseMarkdown(schema, parser, unevenFence)
check("uneven fence closed", parsedUneven.firstChild && parsedUneven.firstChild.type.name, "code_block")

// 13. 围栏前后夹 markdown → 三段各自正确
var mixed = "# H\n\n```html\n" + userDoc + "\n```\n\ntail"
var parsedMixed = parseMarkdown(schema, parser, mixed)
check("mixed child count", parsedMixed.childCount, 3)
check("mixed first heading", parsedMixed.child(0).type.name, "heading")
check("mixed second code_block", parsedMixed.child(1).type.name, "code_block")
check("mixed third paragraph", parsedMixed.child(2).type.name, "paragraph")
check("mixed roundtrip", serializer.serialize(parsedMixed), mixed)

// 14. 行内双反引号不误判为围栏（验证是段落而非 code_block）
var inlineCode = "use ``code`` here"
var parsedInline = parseMarkdown(schema, parser, inlineCode)
check("inline double backtick not fence", parsedInline.firstChild && parsedInline.firstChild.type.name, "paragraph")

if (failures > 0) {
  console.log(failures + " test(s) failed")
  process.exit(1)
}
console.log("All tests passed")