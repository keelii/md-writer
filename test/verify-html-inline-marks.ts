import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer, parseMarkdown } from "../src/prosemirror/markdown"
import { Node as PMNode } from "prosemirror-model"

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

function roundtrip(md: string): string {
  var doc = parseMarkdown(schema, parser, md)
  return serializer.serialize(doc)
}

function inlineNodes(md: string): { types: string[]; text: string } {
  var doc = parseMarkdown(schema, parser, md)
  var para = doc.firstChild
  if (!para) {
    throw new Error("paragraph missing")
  }
  var out: string[] = []
  var text = ""
  para.forEach(function (child: PMNode) {
    out.push(child.type.name)
    text += child.textContent
  })
  return { types: out, text: text }
}

function textMarksInOrder(md: string): string[][] {
  var doc = parseMarkdown(schema, parser, md)
  var para = doc.firstChild
  if (!para) {
    throw new Error("paragraph missing")
  }
  var out: string[][] = []
  para.forEach(function (child: PMNode) {
    if (child.isText) {
      var names: string[] = []
      if (child.marks) {
        for (var i = 0; i < child.marks.length; i += 1) {
          names.push(child.marks[i].type.name)
        }
      }
      out.push(names)
    } else {
      out.push([child.type.name])
    }
  })
  return out
}

// 1. 用户场景：sub / sup
var subSup = inlineNodes("Chemical formulas: H<sub>2</sub>O, CO<sub>2</sub>Mathematical notation: x<sup>2</sup>, e<sup>iπ</sup>")
check("sub/sup text preserved", subSup.text, "Chemical formulas: H2O, CO2Mathematical notation: x2, eiπ")
check("sub/sup all plain text nodes", subSup.types.every(function (t) { return t === "text" }), true)
var subSupMarks = textMarksInOrder("H<sub>2</sub>O")
check("sub mark applied", JSON.stringify(subSupMarks), JSON.stringify([[], ["subscript"], []]))

// 2. kbd
var kbdMarks = textMarksInOrder("Press <kbd>Ctrl</kbd> + <kbd>B</kbd> for bold text.")
check("kbd mark applied", JSON.stringify(kbdMarks), JSON.stringify([[], ["kbd"], [], ["kbd"], []]))

// 3. abbr（含 title）
var abbrMarks = textMarksInOrder("<abbr title=\"Graphical User Interface\">GUI</abbr>")
check("abbr mark applied", JSON.stringify(abbrMarks), JSON.stringify([["abbreviation"]]))

// 4. u / mark
var uMarks = textMarksInOrder("<u>underline</u> and <mark>highlight</mark>")
check("u/mark marks applied", JSON.stringify(uMarks), JSON.stringify([["underline"], [], ["highlight"]]))

// 5. 嵌套标签：<u>H<sub>2</sub>O</u>
var nested = textMarksInOrder("<u>H<sub>2</sub>O</u>")
check("nested u+sub marks", JSON.stringify(nested), JSON.stringify([["underline"], ["underline", "subscript"], ["underline"]]))

// 6. roundtrip 保持原样
check("sub roundtrip", roundtrip("H<sub>2</sub>O"), "H<sub>2</sub>O")
check("sup roundtrip", roundtrip("x<sup>2</sup>"), "x<sup>2</sup>")
check("kbd roundtrip", roundtrip("Press <kbd>Ctrl</kbd> + <kbd>B</kbd> for bold text."), "Press <kbd>Ctrl</kbd> + <kbd>B</kbd> for bold text.")
check("abbr roundtrip", roundtrip('<abbr title="Graphical User Interface">GUI</abbr>'), '<abbr title="Graphical User Interface">GUI</abbr>')
check("u roundtrip", roundtrip("<u>underline</u>"), "<u>underline</u>")
check("mark roundtrip", roundtrip("<mark>highlight</mark>"), "<mark>highlight</mark>")

// 7. 与其他 markdown 语法共存（粗体 + sup）
check("bold+sup roundtrip", roundtrip("**bold** and x<sup>2</sup>"), "**bold** and x<sup>2</sup>")

// 8. 未配对标签保持原文本（不被吞掉）
var unmatched = inlineNodes("broken <sub> tag")
check("unmatched tag preserved", unmatched.text, "broken <sub> tag")

// 9. code mark 内不处理
check("code span unaffected", roundtrip("use `<sub>` literally"), "use `<sub>` literally")

// 10. 与 $$ 公式共存
check("math inline unaffected", roundtrip("$a+b$ and <kbd>K</kbd>"), "$a+b$ and <kbd>K</kbd>")

// 11. abbr title 单引号形式
check("abbr single-quote title", roundtrip("<abbr title='Tip'>T</abbr>"), '<abbr title="Tip">T</abbr>')

if (failures > 0) {
  console.log(failures + " test(s) failed")
  process.exit(1)
}
console.log("All tests passed")