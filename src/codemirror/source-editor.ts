import { EditorState } from "@codemirror/state"
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands"
import { defaultHighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language"
import { markdown } from "@codemirror/lang-markdown"
import { drawSelection, EditorView, keymap } from "@codemirror/view"

export interface SourceEditorAdapter {
  getValue: () => string;
  setValue: (value: string) => void;
  focus: () => void;
  refresh: () => void;
  getWrapperElement: () => HTMLElement;
  destroy: () => void;
}

export function createCodeMirrorSourceEditor(
  container: HTMLElement,
  initialValue: string,
  onChange?: (value: string) => void
): SourceEditorAdapter {
  var updateListener = EditorView.updateListener.of(function (update) {
    if (!update.docChanged || typeof onChange !== "function") {
      return
    }
    onChange(update.state.doc.toString())
  })

  var state = EditorState.create({
    doc: String(initialValue == null ? "" : initialValue),
    extensions: [
      drawSelection(),
      history(),
      keymap.of(defaultKeymap.concat(historyKeymap, indentWithTab)),
      indentUnit.of("  "),
      markdown(),
      syntaxHighlighting(defaultHighlightStyle),
      EditorView.lineWrapping,
      updateListener
    ]
  })
  var editor = new EditorView({
    state: state,
    parent: container
  })

  function replaceDoc(value: string) {
    var current = editor.state.doc.toString()
    if (current === value) {
      return
    }
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: value
      }
    })
  }

  return {
    getValue: function () {
      return editor.state.doc.toString()
    },
    setValue: function (value: string) {
      replaceDoc(value)
    },
    focus: function () {
      editor.focus()
    },
    refresh: function () {
      editor.requestMeasure()
    },
    getWrapperElement: function () {
      return editor.dom
    },
    destroy: function () {
      editor.destroy()
    }
  }
}