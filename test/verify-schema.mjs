import { Schema } from "prosemirror-model"
import { schema as base } from "prosemirror-markdown"

var marks = base.spec.marks
var codeSpec = marks.get("code")
if (!codeSpec) {
  throw new Error("code mark spec missing")
}
var updated = marks.update("code", Object.assign({}, codeSpec, { excludes: "code" }))

var schema = new Schema({
  nodes: base.spec.nodes,
  marks: updated
})

var codeMark = schema.marks.code.create()
var linkMark = schema.marks.link.create({ href: "https://example.com" })

// 先测试 mark 组合本身：code 是否会把 link 从集合中排除
var set = codeMark.addToSet([linkMark])
var hasLinkAfterAddCode = linkMark.isInSet(set) != null
console.log("code.addToSet([link]) 后 link 是否保留:", hasLinkAfterAddCode)
if (!hasLinkAfterAddCode) {
  throw new Error("code mark 仍然排除 link mark")
}

// 反向：link 加到 code 集合
var set2 = linkMark.addToSet([codeMark])
var hasCodeAfterAddLink = codeMark.isInSet(set2) != null
console.log("link.addToSet([code]) 后 code 是否保留:", hasCodeAfterAddLink)
if (!hasCodeAfterAddLink) {
  throw new Error("link mark 排除了 code mark")
}

// 创建带两种 mark 的文本节点
var textNode = schema.text("hello", [codeMark, linkMark])
var hasCode = schema.marks.code.isInSet(textNode.marks) != null
var hasLink = schema.marks.link.isInSet(textNode.marks) != null
console.log("文本节点 marks:", textNode.marks.map(function (m) { return m.type.name }).join(", "))
if (!hasCode || !hasLink) {
  throw new Error("code and link cannot coexist on text node")
}

console.log("PASS: code mark 与 link mark 可以共存")