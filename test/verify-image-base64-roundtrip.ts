import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, parseMarkdown } from "../src/prosemirror/markdown"

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

function describeDoc(doc: any): string {
  var out: string[] = []
  doc.descendants(function (node: any) {
    out.push(node.type.name + (node.type.name === "text" ? "(" + JSON.stringify(node.text).slice(0, 80) + ")" : ""))
    return true
  })
  return out.join(", ")
}

// 模拟真实图片：长 base64（~500KB 字符，覆盖完整字母表 +/=）
var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
var long: string[] = []
for (var i = 0; i < 500000; i += 1) {
  long.push(alphabet[(i * 31 + 7) % alphabet.length])
}
var base64 = long.join("") + "=="
var cases: Array<[string, string]> = [
  ["short base64", "![alt](data:image/png;base64," + base64.slice(0, 100) + ")"],
  ["long base64 500k", "![alt](data:image/png;base64," + base64 + ")"],
  ["chinese filename alt", "![屏幕截图 2026-10-07 上午10.30.33.png](data:image/png;base64," + base64 + ")"],
  ["jpeg mime", "![alt](data:image/jpeg;base64," + base64 + ")"],
]

for (var i = 0; i < cases.length; i += 1) {
  var label = cases[i][0]
  var md = cases[i][1]
  var doc = parseMarkdown(schema, parser, md)
  console.log("== " + label + " ==")
  console.log("parsed doc: " + describeDoc(doc))
  var serialized = serializer.serialize(doc)
  console.log("serialized: " + serialized.slice(0, 120))
  console.log("")
}