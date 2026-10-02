import { getRawBlockKind } from "../src/prosemirror/nodeviews/kinds"
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

// 1. 用户报告的场景：div 包裹的单行公式 → math 预览
check(
  "div-wrapped inline $$ math",
  getRawBlockKind("<div>\n$$R∪S={t|t∈R∨t∈S}$$\n</div>"),
  "math"
)

// 2. div 包裹的多行 $$ 块 → math 预览
check(
  "div-wrapped block $$ math",
  getRawBlockKind("<div>\n$$\nR \\cup S = {t | t \\in R \\lor t \\in S}\n$$\n</div>"),
  "math"
)

// 3. 多层包裹（div + section）→ math 预览
check(
  "nested wrappers math",
  getRawBlockKind("<div>\n<section>\n$$\na+b\n$$\n</section>\n</div>"),
  "math"
)

// 4. 回归：裸 $$ 块仍识别为 math
check("plain block math", getRawBlockKind("$$\na+b\n$$"), "math")

// 5. 回归：普通 div 块（非公式）仍是代码块预览
check("plain div stays code", getRawBlockKind("<div>\nhello\n</div>"), "")

// 6. 病态场景：包裹后还有额外公式块 → 不应误判
check(
  "trailing extra math block stays code",
  getRawBlockKind("<div>\n$$\nx\n$$\n</div>\n$$\ny\n$$"),
  ""
)

// 7. 回归：iframe / frontmatter 预览不受影响
check("iframe still iframe", getRawBlockKind('<iframe src="https://example.com"></iframe>'), "iframe")
check("frontmatter still frontmatter", getRawBlockKind("---\ntitle: t\n---"), "frontmatter")

// 8. 端到端：用户输入 → raw_block 节点 → 序列化往返保持原样
var md = "<div>\n$$R∪S={t|t∈R∨t∈S}$$\n</div>"
var doc = parseMarkdown(schema, parser, md)
var first = doc.firstChild
check("parse into raw_block node", first && first.type.name, "raw_block")
check("raw_block text preserved", first && first.textContent, md)
check("roundtrip unchanged", serializer.serialize(doc), md)

if (failures > 0) {
  console.log(failures + " test(s) failed")
  process.exit(1)
}
console.log("All tests passed")