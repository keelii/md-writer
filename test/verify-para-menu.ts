// 段落/标题菜单验证：顶层段落与顶层 heading 各自由独立注册装饰（paragraph-menu /
// heading-menu），列表/表格/引用内的段落不应有装饰，单图段落由图片菜单接管、
// 不命中段落菜单。装饰由 block-menu 核心生成：每个命中的块 = 一个 node decoration
//（source 类）+ 一个 widget 装饰。
import { EditorState } from "prosemirror-state"
import { DecorationSet } from "prosemirror-view"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, parseMarkdown } from "../src/prosemirror/markdown"
import { createHeadingMenuRegistration } from "../src/prosemirror/heading-menu"
import { createParagraphMenuRegistration } from "../src/prosemirror/paragraph-menu"
import { createBlockMenuPlugin } from "../src/prosemirror/block-menu"

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

function getDecoratedPos(markdown: string) {
  var schema = buildSchema()
  var parser = buildMarkdownParser(schema)
  var headingRegistration = createHeadingMenuRegistration(schema)
  var paragraphRegistration = createParagraphMenuRegistration(schema)
  if (!headingRegistration || !paragraphRegistration) {
    throw new Error("registration is null")
  }
  var plugin = createBlockMenuPlugin([headingRegistration, paragraphRegistration])
  var doc = parseMarkdown(schema, parser, markdown)
  if (!doc) {
    throw new Error("parse failed for: " + markdown)
  }
  var state = EditorState.create({ schema: schema, doc: doc })
  var decorations = (plugin.props as any).decorations(state)
  if (!decorations) {
    return []
  }
  var set = decorations as DecorationSet
  var found = set.find()
  var positions: number[] = []
  for (var i = 0; i < found.length; i += 1) {
    // 只取菜单 widget（点装饰 from == to），忽略来源块的 node decoration
    if (found[i].from === found[i].to) {
      positions.push(found[i].from)
    }
  }
  return positions.sort(function (a, b) { return a - b })
}

// 两个顶层段落 + 一个 heading：应有 3 个 widget（2 段落 + 1 标题）
var p1 = getDecoratedPos("# 标题\n\n第一段\n\n第二段")
assertEqual(p1.length, 3, "heading + 2 paragraphs => 3 widgets")
assertEqual(p1[0], 1, "heading widget pos 1")
assertEqual(p1[1], 5, "first paragraph widget pos 5")
assertEqual(p1[2], 10, "second paragraph widget pos 10")

// 列表内的段落：顶层列表项不算段落装饰，仅顶层无段落
var p2 = getDecoratedPos("- a\n- b")
assertEqual(p2.length, 0, "list items produce no paragraph widgets")

// 引用块内段落不装饰
var p3 = getDecoratedPos("> quoted")
assertEqual(p3.length, 0, "blockquote paragraph produces no widget")

// 表格单元格内段落不装饰
var p4 = getDecoratedPos("| a | b |\n| --- | --- |\n| c | d |")
assertEqual(p4.length, 0, "table cell paragraph produces no widget")

// 单图独占段落：由图片菜单接管，不命中段落/标题菜单
var p5 = getDecoratedPos("![alt](https://example.com/a.png)")
assertEqual(p5.length, 0, "image-only paragraph produces no paragraph widget")

if (failures > 0) {
  console.log("FAILED: " + failures)
  process.exit(1)
}
console.log("ALL PARAGRAPH MENU TESTS PASSED")