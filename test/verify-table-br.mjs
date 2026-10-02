import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer } from "../src/prosemirror/markdown"

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

var md = "| a<br>b | c |\n| --- | --- |\n| x<br/>y | z |"
var doc = parser.parse(md)

var hardBreakCount = 0
doc.descendants(function (node) {
  if (node.type.name === "hard_break") {
    hardBreakCount += 1
  }
  return true
})
console.log("hard_break count:", hardBreakCount)

var out = serializer.serialize(doc)
console.log("serialized:", JSON.stringify(out))

if (hardBreakCount !== 2) {
  throw new Error("expected 2 hard_break nodes, got " + hardBreakCount)
}
if (out.indexOf("a<br>b") < 0 || out.indexOf("x<br>y") < 0) {
  throw new Error("round-trip lost <br>: " + JSON.stringify(out))
}
console.log("ROUND_TRIP_OK")