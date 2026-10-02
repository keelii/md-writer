// 验证：不同 mime 的 data URL 经 parseMarkdown 后能否解析为 image 节点（检查嵌套子节点）
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, parseMarkdown } from "../src/prosemirror/markdown"
import { buildMarkdownSerializer } from "../src/prosemirror/markdown"
import { Node as PMNode } from "prosemirror-model"

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

var b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

function containsImage(node: PMNode): boolean {
  var found = false
  node.descendants(function (n) {
    if (n.type.name === "image") {
      found = true
    }
  })
  return found
}

var cases: Array<[string, string]> = [
  ["png", "data:image/png;base64," + b64],
  ["jpeg", "data:image/jpeg;base64," + b64],
  ["gif", "data:image/gif;base64," + b64],
  ["webp", "data:image/webp;base64," + b64],
  ["svg+xml", "data:image/svg+xml;base64," + b64],
  ["jpg(非标准)", "data:image/jpg;base64," + b64],
  ["heic", "data:image/heic;base64," + b64],
  ["avif", "data:image/avif;base64," + b64],
  ["bmp", "data:image/bmp;base64," + b64],
]

for (var i = 0; i < cases.length; i += 1) {
  var name = cases[i][0]
  var src = cases[i][1]
  var md = "![" + name + "](" + src + ")"
  var doc = parseMarkdown(schema, parser, md)
  var out = serializer.serialize(doc)
  var hasImage = containsImage(doc)
  console.log(
    (hasImage ? "PASS" : "FAIL") +
      "  mime=" + name +
      "  serialize还原=" + (out === md ? "无损" : "有损")
  )
}