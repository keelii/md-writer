import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer } from "../src/prosemirror/markdown"
import { isImageOnlyParagraph, createImageBlockNodeView } from "../src/prosemirror/image-rhythm"
import { Node as PMNode } from "prosemirror-model"

var passed = 0

function assert(label: string, ok: boolean) {
  console.log((ok ? "PASS" : "FAIL") + " - " + label)
  if (!ok) {
    throw new Error("BUG: " + label)
  }
  passed += 1
}

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)

function firstNode(md: string, typeName: string): PMNode | null {
  var found: PMNode | null = null
  parser.parse(md).descendants(function (node: PMNode) {
    if (!found && node.type.name === typeName) {
      found = node
    }
    return !found
  })
  return found
}

// 1. 仅含一张图片的段落 → true
var imgPara = firstNode("![alt](https://example.com/a.png)", "paragraph")
assert("image-only paragraph detected", !!imgPara && isImageOnlyParagraph(imgPara as PMNode))

// 2. 图片 + 文字 → false
var textImgPara = firstNode("![alt](https://example.com/a.png) tail text", "paragraph")
assert("image with text not detected", !!textImgPara && !isImageOnlyParagraph(textImgPara as PMNode))

// 3. 空段落 → false
var emptyPara = firstNode("before\n\nafter", "paragraph")
assert("empty paragraph not detected", !isImageOnlyParagraph(emptyPara as PMNode))

// 4. 两张图片 → false
var twoImgPara = firstNode("![a](u1)![b](u2)", "paragraph")
assert("two images not detected", !!twoImgPara && !isImageOnlyParagraph(twoImgPara as PMNode))

// 5. 非段落节点 → false（heading 等）
var heading = firstNode("# Title", "heading")
assert("non-paragraph node not detected", !isImageOnlyParagraph(heading as PMNode))

// 6. NodeView：image-only 段落返回 div 结构
// fake document：createImageBlockNodeView 走 JSX h()，需支持 createElement/setAttribute
var created: { tag: string; className: string }[] = []
;(globalThis as any).document = {
  createElement: function (tag: string) {
    var el = {
      tag: tag,
      className: "",
      setAttribute: function (name: string, value: string) {
        if (name === "class") {
          el.className = value
        }
      }
    }
    created.push(el)
    return el
  }
}
var nodeView = createImageBlockNodeView(imgPara as PMNode)
assert("image-only paragraph gets node view", !!nodeView)
assert("node view renders div", !!nodeView && (nodeView as any).dom.tag === "div")
assert("node view has class md-editor-image-block", !!nodeView && (nodeView as any).dom.className === "md-editor-image-block")
assert("node view contentDOM is dom", !!nodeView && (nodeView as any).contentDOM === (nodeView as any).dom)

// 7. NodeView：非 image-only 段落返回 null（保持默认 p 渲染）
assert("text paragraph gets no node view", createImageBlockNodeView(textImgPara as PMNode) === null)

// 8. update：仍是 image-only 时返回 true（复用 NodeView，不重建）
assert("update keeps view while still image-only", !!(nodeView && nodeView.update(imgPara as PMNode)))
// 变成图片+文字后返回 false（交回默认 p 渲染）
assert("update drops view once text added", !!(nodeView && !nodeView.update(textImgPara as PMNode)))

// 9. 文档模型不变：markdown 往返仍是纯图片语法
var md = "![alt](https://example.com/a.png)"
assert(
  "markdown round-trip unchanged",
  serializer.serialize(parser.parse(md)) === md
)

console.log("ALL_IMAGE_BLOCK_TESTS_PASSED (" + passed + " assertions)")