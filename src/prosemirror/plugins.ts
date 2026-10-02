import { Mark, Schema, Slice } from "prosemirror-model"
import { EditorState, Plugin, TextSelection } from "prosemirror-state"
import { Decoration, DecorationSet, EditorView } from "prosemirror-view"
import { MarkdownParser } from "prosemirror-markdown"
import { baseKeymap, chainCommands, createParagraphNear, liftEmptyBlock, newlineInCode, splitBlock, toggleMark } from "prosemirror-commands"
import { history, redo, undo } from "prosemirror-history"
import { InputRule, inputRules, wrappingInputRule } from "prosemirror-inputrules"
import { keymap } from "prosemirror-keymap"
import { gapCursor } from "prosemirror-gapcursor"
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list"
import { EditorCommand, EditorDispatch, MDWriterInitOptions } from "../types"
import { parseMarkdown } from "./markdown"
import { applyTableMutation, deleteSingleCellTableOnBackspace, deleteTableRowOnBackspace, createExitTableCellRule, getTableContext, guardTableCellDeletion, isLastTableCell, moveTableCellSelection, mutateTableAddRowFirstCell } from "./table"
import { deletePreviewRawBlockOnBackspace, deletePreviewRawBlockOnDelete } from "./nodeviews/kinds"
import { BlockMenuRegistration, createBlockMenuPlugin } from "./block-menu"
import { createHeadingMenuRegistration } from "./heading-menu"
import { createParagraphMenuRegistration } from "./paragraph-menu"
import { createTableMenuRegistration } from "./table-menu"
import { createListMenuRegistration } from "./list-menu"
import { createBlockquoteMenuRegistration } from "./blockquote-menu"
import { createCodeBlockMenuRegistration } from "./code-block-menu"
import { createPreviewBlockOpMenuRegistration } from "./nodeviews/node-op-menu"
import { createCodeHighlightPlugin } from "./code-highlight"
import { createImageMenuRegistration, createImageRhythmPlugin } from "./image-rhythm"
import "./plugins.css"

// 与源码模式 indentUnit 保持一致的两空格缩进。
var CODE_INDENT_UNIT = "  "

function isInCodeLikeBlock(state: EditorState): boolean {
  var parent = state.selection.$from.parent
  if (!parent || !parent.type) {
    return false
  }
  var name = parent.type.name
  return name === "code_block" || name === "raw_block"
}

// code block 内 Tab：光标处插入两空格；多行选区时对每个被选中的行行首插入缩进。
export function indentCodeBlockCommand(state: EditorState, dispatch?: EditorDispatch): boolean {
  var selection = state.selection
  var $from = selection.$from
  var $to = selection.$to
  if (!isInCodeLikeBlock(state) || $from.parent !== $to.parent) {
    return false
  }
  if (dispatch) {
    var tr = state.tr
    if (selection.empty) {
      tr.insertText(CODE_INDENT_UNIT)
    } else {
      var block = $from.parent
      var blockStart = $from.pos - $from.parentOffset
      var text = block.textBetween(0, block.content.size)
      var lineStarts = collectCodeBlockLineStarts(text, $from.parentOffset, $to.parentOffset)
      // 从后往前插入，避免位置偏移
      for (var i = lineStarts.length - 1; i >= 0; i -= 1) {
        tr.insertText(CODE_INDENT_UNIT, blockStart + lineStarts[i])
      }
    }
    dispatch(tr.scrollIntoView())
  }
  return true
}

// 计算选区（block 内偏移）覆盖到的所有行的行首偏移。
// 空选区取光标所在行；非空选区取所有与选区相交的行（选区终点恰为行首时不包含该行，与 CodeMirror 行为一致）。
function collectCodeBlockLineStarts(text: string, selStart: number, selEnd: number): number[] {
  var starts: number[] = []
  var lineStart = 0
  for (var i = 0; i <= text.length; i += 1) {
    var atEnd = i === text.length
    if (!atEnd && text.charAt(i) !== "\n") {
      continue
    }
    var lineEnd = i
    if (selStart === selEnd) {
      var include = false
      if (lineStart === lineEnd) {
        // 空行：仅当光标正好在该行上
        include = lineStart === selStart
      } else {
        include = (lineStart <= selStart && selStart < lineEnd)
          || (selStart === text.length && lineEnd === text.length)
      }
      if (include) {
        starts.push(lineStart)
      }
    } else if (lineStart < selEnd && lineEnd > selStart) {
      starts.push(lineStart)
    }
    lineStart = i + 1
  }
  return starts
}

// code block 内 Shift-Tab：光标处删除最多一个缩进单位的前导空格；多行选区时对每个选中行行首反缩进。
export function dedentCodeBlockCommand(state: EditorState, dispatch?: EditorDispatch): boolean {
  var selection = state.selection
  var $from = selection.$from
  var $to = selection.$to
  if (!isInCodeLikeBlock(state) || $from.parent !== $to.parent) {
    return false
  }
  if (!dispatch) {
    return true
  }
  var block = $from.parent
  var blockStart = $from.pos - $from.parentOffset
  var text = block.textBetween(0, block.content.size)
  var tr = state.tr
  var changed = false
  if (selection.empty) {
    var before = text.slice(0, $from.parentOffset)
    var maxRemove = Math.min(CODE_INDENT_UNIT.length, before.length, $from.pos - $from.start())
    var remove = 0
    while (remove < maxRemove && before.charAt(before.length - remove - 1) === " ") {
      remove += 1
    }
    if (remove) {
      tr.delete($from.pos - remove, $from.pos)
      changed = true
    }
  } else {
    var lineStarts = collectCodeBlockLineStarts(text, $from.parentOffset, $to.parentOffset)
    for (var i = lineStarts.length - 1; i >= 0; i -= 1) {
      var lineStart = lineStarts[i]
      var lineRemove = 0
      while (lineRemove < CODE_INDENT_UNIT.length
        && lineStart + lineRemove < text.length
        && text.charAt(lineStart + lineRemove) === " ") {
        lineRemove += 1
      }
      if (lineRemove) {
        tr.delete(blockStart + lineStart, blockStart + lineStart + lineRemove)
        changed = true
      }
    }
  }
  if (changed) {
    dispatch(tr.scrollIntoView())
  }
  return true
}

function createPlaceholderPlugin(schema: Schema, placeholder?: string): Plugin | null {
  var text = String(placeholder == null ? "" : placeholder).trim()
  if (!text) {
    return null
  }

  return new Plugin({
    props: {
      decorations: function (state) {
        var doc = state.doc
        if (doc.childCount !== 1) {
          return null
        }
        var first = doc.firstChild
        if (!first || !first.isTextblock || first.content.size !== 0) {
          return null
        }
        var deco = Decoration.node(0, first.nodeSize, {
          "data-placeholder": text,
          class: "md-editor-placeholder-block"
        })
        return DecorationSet.create(doc, [deco])
      }
    }
  })
}

export interface HeadingAnchor {
  pos: number
  nodeSize: number
  level: number
  text: string
  id: string
}

// 收集文档中全部 heading 的锚点信息，并保证 id 在文档内唯一：
// 基础 id 为 "h" + encodeURIComponent(text)，同名文本第 n 次出现追加 "-n"（n 从 2 起）。
// 不用层级做唯一性来源：同层同名仍会冲突，去重序号才能保证唯一。
export function collectHeadingAnchors(state: EditorState): HeadingAnchor[] {
  var headingType = state.schema.nodes.heading
  if (!headingType) {
    return []
  }
  var entries: { pos: number; nodeSize: number; level: number; text: string; id: string }[] = []
  state.doc.descendants(function (node, pos) {
    if (node.type !== headingType) {
      return true
    }
    entries.push({
      pos: pos,
      nodeSize: node.nodeSize,
      level: Number((node.attrs && node.attrs.level) || 1),
      text: node.textContent || "",
      id: ""
    })
    return false
  })
  var counts: { [key: string]: number } = {}
  for (var i = 0; i < entries.length; i += 1) {
    var base = "h" + encodeURIComponent(String(entries[i].text == null ? "" : entries[i].text).trim())
    var seen = counts[base] || 0
    counts[base] = seen + 1
    entries[i].id = seen === 0 ? base : base + "-" + (seen + 1)
  }
  return entries
}

function createHeadingIDSyncPlugin(schema: Schema): Plugin | null {
  if (!schema.nodes.heading) {
    return null
  }

  return new Plugin({
    props: {
      decorations: function (state) {
        var anchors = collectHeadingAnchors(state)
        if (!anchors.length) {
          return null
        }
        var decorations: Decoration[] = []
        for (var i = 0; i < anchors.length; i += 1) {
          decorations.push(
            Decoration.node(anchors[i].pos, anchors[i].pos + anchors[i].nodeSize, {
              id: anchors[i].id
            })
          )
        }
        return DecorationSet.create(state.doc, decorations)
      }
    }
  })
}

// 行内 mark 末尾连输两个空格：跳出该 mark。
// 触发时机是输入第二个空格：第一个空格已带 mark 写入文档，第二个尚未插入。
// handler 删除已插入的空格并清除待输入 mark，使光标与其后的输入落在 mark 边界之外。
function createExitInlineMarkRule(schema: Schema): InputRule | null {
  if (!Object.keys(schema.marks).length) {
    return null
  }
  return new InputRule(/[ \u00a0]{2}$/, function (state, match, start, end) {
    // 仅处理空选区下的纯输入；非空选区替换交给默认行为
    if (start + 1 !== end) {
      return null
    }
    var $from = state.doc.resolve(end)
    if (!$from.parent.isTextblock) {
      return null
    }
    var before = $from.nodeBefore
    if (!before || !before.marks.length) {
      return null
    }
    var after = $from.nodeAfter
    // 光标在 mark 内部（如 code 内容中间）时，nodeAfter 延续相同 mark，不触发；
    // 收集跨越光标延续的 mark（如 strong 内嵌 em 的场景），跳出时予以保留。
    var continued: Mark[] = []
    var exiting: Mark[] = []
    var beforeMarks = before.marks
    for (var i = 0; i < beforeMarks.length; i += 1) {
      var mark = beforeMarks[i]
      if (after && mark.isInSet(after.marks)) {
        continued.push(mark)
      } else {
        exiting.push(mark)
      }
    }
    if (!exiting.length) {
      return null
    }
    // 第一个空格保留，但移除待跳出的 mark，使其成为 mark 之外的普通文本，
    // 光标随之渲染在 mark 元素之后（跳出立即生效）；
    // 第二个空格是触发手势，被本规则消费，不插入文档。
    var tr = state.tr
    for (var j = 0; j < exiting.length; j += 1) {
      tr.removeMark(start, end, exiting[j])
    }
    return tr.setStoredMarks(continued)
  })
}

// 检测纯文本是否为大段 Markdown 源码：多行且含 ATX heading 行。
function looksLikeMarkdownSource(text: string): boolean {
  if (!text || text.length < 8) {
    return false
  }
  var lines = text.split(/\r\n|\r|\n/)
  if (lines.length < 2) {
    return false
  }
  for (var i = 0; i < lines.length; i += 1) {
    if (/^#{1,6}[ \t]+\S/.test(lines[i])) {
      return true
    }
  }
  return false
}

// 可视模式粘贴：剪贴板内容是大段 md 源码（含 heading）时，
// 直接走 markdown 解析管线重新渲染（等效于把这段源码设置进源码编辑器再渲染出来），
// 避免被当作纯文本插入导致 heading 等语法不生效。
export function createMarkdownPastePlugin(schema: Schema, markdownParser: MarkdownParser): Plugin {
  return new Plugin({
    props: {
      handlePaste: function (view: EditorView, event: ClipboardEvent) {
        var clipboardData = event.clipboardData
        if (!clipboardData) {
          return false
        }
        var text = clipboardData.getData("text/plain")
        if (!looksLikeMarkdownSource(text)) {
          return false
        }
        // 代码类块内粘贴保持纯文本（源码示例不应被转换）
        if (isInCodeLikeBlock(view.state)) {
          return false
        }
        var doc
        try {
          doc = parseMarkdown(schema, markdownParser, text)
        } catch (error) {
          return false
        }
        if (!doc || !doc.content.size) {
          return false
        }
        var tr = view.state.tr.replaceSelection(new Slice(doc.content, 0, 0))
        view.dispatch(tr.scrollIntoView())
        return true
      }
    }
  })
}

export function buildPlugins(schema: Schema, options?: MDWriterInitOptions): Plugin[] {
  var opts: Partial<MDWriterInitOptions> = options || {}
  var listItem = schema.nodes.list_item
  var splitListItemCommand = listItem ? splitListItem(listItem) : null
  var sinkListItemCommand = listItem ? sinkListItem(listItem) : null
  var liftListItemCommand = listItem ? liftListItem(listItem) : null
  var placeholderPlugin = createPlaceholderPlugin(schema, opts.placeholder)
  var headingIDSyncPlugin = createHeadingIDSyncPlugin(schema)
  // 块级左侧悬浮菜单：标题/段落类型切换 + 表格行列操作 + 列表切换 + 引用转正文 +
  // 代码块删除 + 预览块操作入口，共用同一 decoration 核心
  // 工厂按此数组顺序依次 unshift，最终数组顺序为倒序（code-block 在前、preview-op 在后）。
  var menuFactories: Array<(schema: Schema) => BlockMenuRegistration | null> = [
    createHeadingMenuRegistration,
    createParagraphMenuRegistration,
    createImageMenuRegistration,
    createTableMenuRegistration,
    createListMenuRegistration,
    createBlockquoteMenuRegistration,
    createCodeBlockMenuRegistration
  ]
  var blockMenuRegistrations: BlockMenuRegistration[] = [createPreviewBlockOpMenuRegistration(options)]
  for (var mi = 0; mi < menuFactories.length; mi += 1) {
    var menuRegistration = menuFactories[mi](schema)
    if (menuRegistration) {
      blockMenuRegistrations.unshift(menuRegistration)
    }
  }
  var blockMenuPlugin = createBlockMenuPlugin(blockMenuRegistrations)

  var headingRule: InputRule | null = null
  if (schema.nodes.heading && schema.nodes.paragraph) {
    headingRule = new InputRule(/^(#{1,6})\s$/, function (state, match, start, end) {
      var $start = state.doc.resolve(start)
      if ($start.parent.type !== schema.nodes.paragraph) {
        return null
      }

      var level = match[1].length
      if (level < 1 || level > 6) {
        return null
      }

      var headingType = schema.nodes.heading
      var depth = $start.depth
      var parent = depth > 0 ? $start.node(depth - 1) : null
      var index = $start.index(depth)
      if (!parent || !parent.canReplaceWith(index, index + 1, headingType)) {
        return null
      }

      return state.tr.delete(start, end).setBlockType(start, start, headingType, {level: level})
    })
  }

  var inputRuleList: InputRule[] = []
  var exitInlineMarkRule = createExitInlineMarkRule(schema)
  if (exitInlineMarkRule) {
    inputRuleList.push(exitInlineMarkRule)
  }
  // 表格末格双空格退出：排在 mark 退出之后，带 mark 的文本先跳出 mark，再跳一次出表
  var exitTableCellRule = createExitTableCellRule(schema)
  if (exitTableCellRule) {
    inputRuleList.push(exitTableCellRule)
  }
  if (headingRule) {
    inputRuleList.push(headingRule)
  }
  if (schema.nodes.ordered_list) {
    inputRuleList.push(
      wrappingInputRule(
        /^(\d+)\.\s$/,
        schema.nodes.ordered_list,
        function (match) {
          return {order: Number(match[1] || 1) || 1}
        },
        function (match, node) {
          return node.childCount + node.attrs.order === (Number(match[1] || 1) || 1)
        }
      )
    )
  }
  if (schema.nodes.bullet_list) {
    inputRuleList.push(wrappingInputRule(/^\*\s$/, schema.nodes.bullet_list))
  }
  if (schema.nodes.blockquote) {
    inputRuleList.push(wrappingInputRule(/^>\s$/, schema.nodes.blockquote))
  }

  var hardBreakType = schema.nodes.hard_break
  var insertHardBreakCommand: EditorCommand | null = hardBreakType
    ? function (state, dispatch) {
        if (!hardBreakType) {
          return false
        }
        if (!state.selection.empty) {
          return false
        }
        var hardBreakNode = hardBreakType.create()
        if (!hardBreakNode) {
          return false
        }
        if (!dispatch) {
          return true
        }
        dispatch(state.tr.replaceSelectionWith(hardBreakNode).scrollIntoView())
        return true
      }
    : null

  var keyBindings: Record<string, EditorCommand> = {
    "Mod-z": undo,
    "Shift-Mod-z": redo,
    "Mod-y": redo,
    "Mod-b": toggleMark(schema.marks.strong),
    "Mod-i": toggleMark(schema.marks.em),
    Backspace: function (state, dispatch, view) {
      // 单格空表格整表删除；行首格整行删除；单元格删除守卫（跨格选区清空
      // 触及 cell 内容保留网格；NodeSelection 选中 cell 清空其内容；格内
      // 边界空选区吞掉——cell 网格只能靠结构命令改）；
      // 预览类节点（$$ 公式 / iframe / frontmatter / mermaid）整块删除；
      // 其余回落到 baseKeymap（deleteSelection / joinBackward /
      // selectNodeBackward）。
      if (deleteSingleCellTableOnBackspace(state, dispatch)) {
        return true
      }
      if (deleteTableRowOnBackspace(state, dispatch)) {
        return true
      }
      if (guardTableCellDeletion(state, dispatch, true)) {
        return true
      }
      if (deletePreviewRawBlockOnBackspace(state, dispatch)) {
        return true
      }
      return false
    },
    // Delete：预览类节点整块删除；单元格删除守卫（同 Backspace，方向为
    // 向后）；其余回落 baseKeymap
    Delete: function (state, dispatch, view) {
      if (deletePreviewRawBlockOnDelete(state, dispatch)) {
        return true
      }
      if (guardTableCellDeletion(state, dispatch, false)) {
        return true
      }
      return false
    },
    Tab: function (state, dispatch, view) {
      if (moveTableCellSelection(state, dispatch, 1)) {
        return true
      }
      if (indentCodeBlockCommand(state, dispatch)) {
        return true
      }
      if (sinkListItemCommand && sinkListItemCommand(state, dispatch, view)) {
        return true
      }
      // 段落等非列表块：吞掉 Tab，避免焦点跳出编辑器
      return true
    },
    "Shift-Tab": function (state, dispatch, view) {
      if (moveTableCellSelection(state, dispatch, -1)) {
        return true
      }
      if (dedentCodeBlockCommand(state, dispatch)) {
        return true
      }
      if (liftListItemCommand && liftListItemCommand(state, dispatch, view)) {
        return true
      }
      return true
    }
  }
  // baseKeymap 的 Enter 链：Mod-Enter 在段落中无块可跳出时回落到与 Enter 一致的拆分行为
  var baseEnterCommand: EditorCommand = chainCommands(
    newlineInCode,
    createParagraphNear,
    liftEmptyBlock,
    splitBlock
  )

  // Mod-Enter：跳出当前块（table / blockquote / 列表 / code_block / heading / raw_block），
  // 在该块之后新建段落并选中；顶层段落等无容器块时与 Enter 一致（拆分当前文本块）。
  var exitBlockCommand: EditorCommand = function (state, dispatch) {
    var $from = state.selection.$from
    var paragraphType = schema.nodes.paragraph
    if (!paragraphType) {
      return false
    }
    var exitable = ["table", "blockquote", "bullet_list", "ordered_list", "code_block", "heading", "raw_block"]
    var exitDepth = -1
    for (var depth = 1; depth <= $from.depth; depth += 1) {
      if (exitable.indexOf($from.node(depth).type.name) >= 0) {
        exitDepth = depth
        break
      }
    }
    if (exitDepth < 0) {
      return baseEnterCommand(state, dispatch)
    }
    if (!dispatch) {
      return true
    }
    var after = $from.after(exitDepth)
    var $after = state.doc.resolve(after)
    if (!$after.parent.canReplaceWith($after.indexAfter(), $after.indexAfter(), paragraphType)) {
      return false
    }
    var tr = state.tr.insert(after, paragraphType.create())
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)))
    dispatch(tr.scrollIntoView())
    return true
  }

  // Enter：表格最后单元格新建一行 / 其余单元格软回车 / 列表拆分列表项 / 其他回落 baseKeymap
  if (insertHardBreakCommand || splitListItemCommand) {
    var enterCommand: EditorCommand = function (state, dispatch, view) {
      var context = getTableContext(state)
      if (context) {
        // 最后一个单元格（最后一行最后一列）：Enter 新建一行，光标落到新行第一个单元格
        if (isLastTableCell(state, context)) {
          return applyTableMutation(state, dispatch, mutateTableAddRowFirstCell)
        }
        // 其余单元格：软回车
        return insertHardBreakCommand ? insertHardBreakCommand(state, dispatch, view) : false
      }
      if (!splitListItemCommand) {
        return false
      }
      return splitListItemCommand(state, dispatch, view)
    }
    keyBindings.Enter = enterCommand
  }
  if (insertHardBreakCommand) {
    keyBindings["Shift-Enter"] = insertHardBreakCommand
    // Alt-Enter：软回车（段落与表格单元格内均插入硬换行）
    keyBindings["Alt-Enter"] = insertHardBreakCommand
  }
  // Mod-Enter：跳出当前块（段落中与 Enter 一致）
  keyBindings["Mod-Enter"] = exitBlockCommand

  return [
    placeholderPlugin,
    headingIDSyncPlugin,
    blockMenuPlugin,
    createCodeHighlightPlugin(),
    createImageRhythmPlugin(),
    inputRuleList.length ? inputRules({rules: inputRuleList}) : null,
    gapCursor(),
    history(),
    keymap(keyBindings),
    keymap(baseKeymap)
  ].filter(function (plugin): plugin is Plugin {
    return plugin != null
  })
}