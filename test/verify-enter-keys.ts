import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, buildMarkdownSerializer } from "../src/prosemirror/markdown"
import { buildPlugins } from "../src/prosemirror/plugins"
import { getTableContext } from "../src/prosemirror/table"
import { EditorState, Selection } from "prosemirror-state"

var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var serializer = buildMarkdownSerializer(schema)
var plugins = buildPlugins(schema)

var passed = 0

function assert(label: string, ok: boolean) {
  console.log((ok ? "PASS" : "FAIL") + " - " + label)
  if (!ok) {
    throw new Error("BUG: " + label)
  }
  passed += 1
}

// 构造类 KeyboardEvent 对象（keymap 只读 key/altKey/ctrlKey/metaKey/shiftKey）
function enterEvent(mods?: any) {
  return Object.assign({
    key: "Enter",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false
  }, mods || {})
}

// 模拟 EditorView 按键分发：按插件顺序调用 handleKeyDown，直到某个插件处理
function pressKey(state: EditorState, event: any): { handled: boolean, state: EditorState } {
  var current = state
  var view: any = {
    state: current,
    dispatch: function (tr: any) {
      current = current.apply(tr)
      view.state = current
    },
    endOfTextblock: function () {
      return true
    }
  }
  for (var i = 0; i < plugins.length; i += 1) {
    var plugin: any = plugins[i]
    var handler = plugin && plugin.props && plugin.props.handleKeyDown
    if (typeof handler === "function" && handler(view, event)) {
      return { handled: true, state: current }
    }
  }
  return { handled: false, state: current }
}

function makeState(md: string, setCursor?: (doc: any) => number) {
  var doc = parser.parse(md)
  var st = EditorState.create({ doc: doc, schema: schema })
  if (setCursor) {
    var pos = setCursor(doc)
    st = st.apply(st.tr.setSelection(Selection.near(st.doc.resolve(pos))))
  }
  return st
}

function findNodePos(doc: any, typeName: string, text: string): number {
  var found = -1
  doc.descendants(function (node: any, pos: number) {
    if (found < 0 && node.type.name === typeName && node.textContent === text) {
      found = pos
    }
    return true
  })
  return found
}

function hasNode(state: EditorState, typeName: string): boolean {
  var found = false
  state.doc.descendants(function (node: any) {
    if (node.type.name === typeName) {
      found = true
    }
    return !found
  })
  return found
}

var TABLE_MD = "| a | b |\n| --- | --- |\n| c | d |\n| e | f |"

// 1. 表格非末格 Enter：软回车（hard_break），不新建行
{
  var st = makeState(TABLE_MD, function (doc) {
    return findNodePos(doc, "table_cell", "c") + 2
  })
  var result = pressKey(st, enterEvent())
  assert("table non-last cell Enter handled", result.handled)
  assert("table non-last cell Enter inserts hard_break", hasNode(result.state, "hard_break"))
  var lines = serializer.serialize(result.state.doc).split("\n")
  assert("table non-last cell Enter keeps 4 rows", lines.length === 4)
}

// 2. 表格末格 Enter：新建一行
{
  var st2 = makeState(TABLE_MD, function (doc) {
    return findNodePos(doc, "table_cell", "f") + 2
  })
  var result2 = pressKey(st2, enterEvent())
  assert("table last cell Enter handled", result2.handled)
  var lines2 = serializer.serialize(result2.state.doc).split("\n")
  assert("table last cell Enter adds a row (5 rows)", lines2.length === 5)
  assert("table last cell Enter cursor stays in table", hasNode(result2.state, "table_cell"))
  var ctx2 = getTableContext(result2.state)
  if (!ctx2) {
    throw new Error("BUG: cursor left table after Enter")
  }
  assert("table last cell Enter cursor at new row first cell", ctx2.rowIndex === 3 && ctx2.colIndex === 0)
}

// 3. 表格内 Mod-Enter：跳出表格新建段落
{
  var st3 = makeState(TABLE_MD, function (doc) {
    return findNodePos(doc, "table_cell", "d") + 2
  })
  var result3 = pressKey(st3, enterEvent({ metaKey: true }))
  assert("table Mod-Enter handled", result3.handled)
  var parent3 = result3.state.selection.$from.parent
  assert("table Mod-Enter lands in paragraph", parent3.type.name === "paragraph")
  assert("table Mod-Enter paragraph after table", result3.state.selection.$from.pos > findNodePos(result3.state.doc, "table", ""))
  assert("table Mod-Enter paragraph is empty", parent3.content.size === 0)
}

// 4. 表格内 Alt-Enter：软回车
{
  var st4 = makeState(TABLE_MD, function (doc) {
    return findNodePos(doc, "table_cell", "c") + 2
  })
  var result4 = pressKey(st4, enterEvent({ altKey: true }))
  assert("table Alt-Enter handled", result4.handled)
  assert("table Alt-Enter inserts hard_break", hasNode(result4.state, "hard_break"))
}

// 5. 段落中 Alt-Enter：软回车
{
  var st5 = makeState("hello world", function (doc) {
    return findNodePos(doc, "paragraph", "hello world") + 6
  })
  var result5 = pressKey(st5, enterEvent({ altKey: true }))
  assert("paragraph Alt-Enter handled", result5.handled)
  assert("paragraph Alt-Enter inserts hard_break", hasNode(result5.state, "hard_break"))
  assert("paragraph Alt-Enter stays one paragraph", result5.state.doc.childCount === 1)
}

// 6. 段落中 Mod-Enter：与 Enter 一致（拆分段落）
{
  var st6 = makeState("hello world", function (doc) {
    return findNodePos(doc, "paragraph", "hello world") + 6
  })
  var byMod = pressKey(st6, enterEvent({ metaKey: true }))
  var byPlain = pressKey(st6, enterEvent())
  assert("paragraph Mod-Enter handled", byMod.handled)
  assert("paragraph plain Enter handled", byPlain.handled)
  var modText = serializer.serialize(byMod.state.doc)
  var plainText = serializer.serialize(byPlain.state.doc)
  assert("paragraph Mod-Enter matches Enter: " + JSON.stringify(modText), modText === plainText)
  assert("paragraph Enter splits into two paragraphs", byPlain.state.doc.childCount === 2)
}

// 7. blockquote 中 Mod-Enter：跳出引用新建段落
{
  var st7 = makeState("> quote text\n\nafter", function (doc) {
    return findNodePos(doc, "paragraph", "quote text") + 1 + "quote text".length
  })
  var result7 = pressKey(st7, enterEvent({ metaKey: true }))
  assert("blockquote Mod-Enter handled", result7.handled)
  var $from7 = result7.state.selection.$from
  var inQuote = false
  for (var d = 1; d <= $from7.depth; d += 1) {
    if ($from7.node(d).type.name === "blockquote") {
      inQuote = true
    }
  }
  assert("blockquote Mod-Enter exits quote", !inQuote)
  assert("blockquote Mod-Enter lands in paragraph", $from7.parent.type.name === "paragraph")
}

// 8. 列表中 Enter：拆分列表项
{
  var st8 = makeState("- item one", function (doc) {
    return findNodePos(doc, "paragraph", "item one") + 5
  })
  var result8 = pressKey(st8, enterEvent())
  assert("list Enter handled", result8.handled)
  var items = 0
  result8.state.doc.descendants(function (node: any) {
    if (node.type.name === "list_item") {
      items += 1
    }
    return true
  })
  assert("list Enter splits into two list items", items === 2)
}

// 9. 列表中 Mod-Enter：跳出列表新建段落
{
  var st9 = makeState("- item one", function (doc) {
    return findNodePos(doc, "paragraph", "item one") + 5
  })
  var result9 = pressKey(st9, enterEvent({ metaKey: true }))
  assert("list Mod-Enter handled", result9.handled)
  var $from9 = result9.state.selection.$from
  var inList = false
  for (var d9 = 1; d9 <= $from9.depth; d9 += 1) {
    if ($from9.node(d9).type.name === "bullet_list" || $from9.node(d9).type.name === "list_item") {
      inList = true
    }
  }
  assert("list Mod-Enter exits list", !inList)
  assert("list Mod-Enter lands in paragraph", $from9.parent.type.name === "paragraph")
}

// 10. heading 中 Mod-Enter：跳出标题新建段落
{
  var st10 = makeState("# Title\n\nafter", function (doc) {
    return findNodePos(doc, "heading", "Title") + 2
  })
  var result10 = pressKey(st10, enterEvent({ metaKey: true }))
  assert("heading Mod-Enter handled", result10.handled)
  assert("heading Mod-Enter lands in paragraph", result10.state.selection.$from.parent.type.name === "paragraph")
}

// 11. code_block 中 Enter：插入换行文本（回落 baseKeymap 的 newlineInCode）
{
  var st11 = makeState("```\nlet a = 1\n```\n\nafter", function (doc) {
    var pos = -1
    doc.descendants(function (node: any, p: number) {
      if (pos < 0 && node.type.name === "code_block") {
        pos = p
      }
      return true
    })
    return pos + 1 + "let a = 1".length
  })
  var result11 = pressKey(st11, enterEvent())
  assert("code_block Enter handled", result11.handled)
  assert("code_block Enter inserts newline text", /a = 1\n/.test(result11.state.doc.textContent))
}

// 构造 Backspace 事件
function backspaceEvent() {
  return {
    key: "Backspace",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false
  }
}

// 12. 行首单元格内容开头 Backspace（非首行）：删除整行，光标落上一行最后一个单元格
{
  var st12 = makeState(TABLE_MD, function (doc) {
    return findNodePos(doc, "table_cell", "e") + 1
  })
  var result12 = pressKey(st12, backspaceEvent())
  assert("row-start Backspace deletes the row", result12.handled)
  var lines12 = serializer.serialize(result12.state.doc).trim().split("\n")
  assert("row-start Backspace keeps 3 lines", lines12.length === 3)
  assert("row-start Backspace removes deleted row content", lines12.join("\n").indexOf("| e |") < 0)
  var ctx12 = getTableContext(result12.state)
  if (!ctx12) {
    throw new Error("BUG: cursor left table after row-delete Backspace")
  }
  assert("row-start Backspace cursor at previous row last cell (row 1 col 1)", ctx12.rowIndex === 1 && ctx12.colIndex === 1)
  assert("row-start Backspace remaining rows count", ctx12.tableNode.childCount === 2)
}

// 13. 非行首单元格内容开头 Backspace：不删除整行
{
  var st13 = makeState(TABLE_MD, function (doc) {
    return findNodePos(doc, "table_cell", "f") + 1
  })
  var result13 = pressKey(st13, backspaceEvent())
  var lines13 = serializer.serialize(result13.state.doc).trim().split("\n")
  assert("non-row-start Backspace keeps 4 lines", lines13.length === 4)
  // 注：非行首格内容开头的默认 joinBackward 会跨格 join（如 "e"|"f" 变 "ef"），
  // 属默认行为，本测试只验证不触发整行删除。
}

// 14. 首行行首单元格内容开头 Backspace：不删除整行
{
  var st14 = makeState(TABLE_MD, function (doc) {
    return findNodePos(doc, "table_cell", "a") + 1
  })
  var result14 = pressKey(st14, backspaceEvent())
  var lines14 = serializer.serialize(result14.state.doc).trim().split("\n")
  assert("first-row Backspace keeps 4 lines", lines14.length === 4)
  assert("first-row Backspace keeps header", lines14[0] === "| a | b |")
}

// 15. head + 唯一 body 行：行首 Backspace 连同整个 table_body 一起删（section 要求至少一行），表格变为仅 head
{
  var st15 = makeState("| H1 | H2 |\n| --- | --- |\n| b1 | b2 |", function (doc) {
    return findNodePos(doc, "table_cell", "b1") + 1
  })
  var result15 = pressKey(st15, backspaceEvent())
  assert("single-body-row Backspace handled", result15.handled)
  var ctx15 = getTableContext(result15.state)
  if (!ctx15) {
    throw new Error("BUG: cursor left table after single-body-row Backspace")
  }
  assert("single-body-row Backspace removes table_body section", ctx15.tableNode.childCount === 1 && ctx15.tableNode.child(0).type.name === "table_head")
  assert("single-body-row Backspace cursor at head last cell (row 0 col 1)", ctx15.rowIndex === 0 && ctx15.colIndex === 1)
  var lines15 = serializer.serialize(result15.state.doc).trim().split("\n")
  assert("single-body-row Backspace keeps head only", lines15.length === 2 && lines15[0] === "| H1 | H2 |")
}

console.log("ALL_ENTER_KEY_TESTS_PASSED (" + passed + " assertions)")
