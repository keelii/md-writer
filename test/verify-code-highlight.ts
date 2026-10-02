// 验证代码块 Decoration 高亮插件：
// 1. 已注册语言生成 token 装饰且区间落在代码块内容内
// 2. 文档模型不受影响（textContent 不变）
// 3. 代码块内编辑后装饰重建且不越界
// 4. 未注册语言/mermaid 块不产生装饰
import { EditorState } from "prosemirror-state"
import { buildSchema } from "../src/prosemirror/schema"
import { codeHighlightKey, createCodeHighlightPlugin } from "../src/prosemirror/code-highlight"

var pass = 0
var fail = 0

function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    pass += 1
    console.log("PASS: " + name)
  } else {
    fail += 1
    console.log("FAIL: " + name + "\n  expected: " + JSON.stringify(expected) + "\n  actual:   " + JSON.stringify(actual))
  }
}

var schema = buildSchema()

function makeState(params: string, code: string) {
  var doc = schema.nodes.doc.create(null, [
    schema.nodes.code_block.create({ params: params }, schema.text(code))
  ])
  return EditorState.create({ doc: doc, plugins: [createCodeHighlightPlugin()] })
}

function decos(state: EditorState) {
  var pluginState = codeHighlightKey.getState(state)
  if (!pluginState) {
    return []
  }
  return pluginState.decorations.find()
}

function decoClass(dec: any): string {
  return dec && dec.type && dec.type.attrs ? String(dec.type.attrs.class) : ""
}

var jsCode = "var MD5 = function (str) {\n  return crypto(str)\n}"
var state = makeState("js", jsCode)

// 1. 装饰存在且区间都在代码块内容（pos 1 起）内
var list = decos(state)
check("js code block has tokens", list.length > 0, true)
var inRange = true
var i: number
for (i = 0; i < list.length; i++) {
  if (list[i].from < 1 || list[i].to > 1 + jsCode.length) {
    inRange = false
  }
}
check("decorations within code content", inRange, true)

// 存在关键字 token 且恰好覆盖 "var"（0-3）
var hasVarKeyword = false
var hasFnTitle = false
for (i = 0; i < list.length; i++) {
  var cls = decoClass(list[i])
  if (cls.indexOf("hljs-keyword") >= 0 && list[i].from === 1 && list[i].to === 4) {
    hasVarKeyword = true
  }
  if (cls.indexOf("hljs-title") >= 0) {
    hasFnTitle = true
  }
}
check("keyword token covers 'var'", hasVarKeyword, true)
check("function title token present", hasFnTitle, true)

// 2. 装饰不改变文档模型
check("doc text unchanged", state.doc.textContent, jsCode)

// 3. 代码块内编辑：装饰重建且不越界，文档文本更新
var tr = state.tr.insertText("x", 2)
var newState = state.apply(tr)
var newList = decos(newState)
var newInRange = true
for (i = 0; i < newList.length; i++) {
  if (newList[i].from < 1 || newList[i].to > 1 + newState.doc.textContent.length) {
    newInRange = false
  }
}
check("decorations rebuilt after edit", newList.length > 0, true)
check("decorations in range after edit", newInRange, true)
check("doc text updated", newState.doc.textContent, "vxar MD5 = function (str) {\n  return crypto(str)\n}")

// 4. 未注册语言 → 无装饰
check("unknown language no tokens", decos(makeState("fortran77", jsCode)).length, 0)
check("no language no tokens", decos(makeState("", jsCode)).length, 0)
check("mermaid excluded", decos(makeState("mermaid", "graph TD\nA-->B")).length, 0)

// 5. 其他常用语言别名可用（样例须包含该语言的 token 结构）
var aliasCases: Array<[string, string]> = [
  ["py", "def fib(n):\n    return 1"],
  ["python", "def fib(n):\n    return 1"],
  ["ts", "var x: string = \"a\""],
  ["tsx", "var x: string = \"a\""],
  ["java", "public class A { }"],
  ["cs", "public class A { }"],
  ["csharp", "public class A { }"],
  ["cpp", "#include <cstdio>\nint main() { return 0 }"],
  ["c", "#include <stdio.h>\nint main() { return 0 }"],
  ["php", "<?php echo 1; ?>"],
  ["go", "func main() { }"],
  ["golang", "func main() { }"],
  ["css", "a { color: red }"],
  ["html", "<div class=\"a\">hi</div>"],
  ["xml", "<tag attr=\"1\">hi</tag>"],
  ["md", "# Title\n\n*em*"],
  ["sh", "echo hello\nls -la | grep foo"],
  ["bash", "echo hello\nls -la | grep foo"],
  ["shell", "echo hello\nls -la | grep foo"],
  ["zsh", "echo hello\nls -la | grep foo"]
]
var aliasOk = true
for (i = 0; i < aliasCases.length; i++) {
  var s = makeState(aliasCases[i][0], aliasCases[i][1])
  if (decos(s).length === 0) {
    aliasOk = false
    console.log("  alias failed: " + aliasCases[i][0])
  }
}
check("language aliases", aliasOk, true)

console.log("\nresult: " + pass + " passed, " + fail + " failed")
process.exit(fail > 0 ? 1 : 0)