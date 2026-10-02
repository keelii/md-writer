// 代码块语法高亮：基于 Decoration 的方案。
// code_block 内容仍由 ProseMirror 原生 contentDOM 管理（不替换 DOM、不拦截选区），
// 本插件只对 code_block 文本做 highlight.js 分词，把结果作为 inline Decoration
// （class 标注）打到对应区间上。因此全选复制、光标移动、撤销重做等
// 原生文档操作完全不受影响——高亮只是"画在内容上"，不进文档模型。
import { Node as PMNode } from "prosemirror-model"
import { Plugin, PluginKey } from "prosemirror-state"
import { Decoration, DecorationSet } from "prosemirror-view"
import { createLowlight } from "lowlight"
import type { Element, Parent, Text as HastText } from "hast"
import typescript from "highlight.js/lib/languages/typescript"
import python from "highlight.js/lib/languages/python"
import java from "highlight.js/lib/languages/java"
import cLang from "highlight.js/lib/languages/c"
import php from "highlight.js/lib/languages/php"
import go from "highlight.js/lib/languages/go"
import cssLang from "highlight.js/lib/languages/css"
import xml from "highlight.js/lib/languages/xml"
import markdown from "highlight.js/lib/languages/markdown"
import bash from "highlight.js/lib/languages/bash"
import { isMermaidCodeBlock } from "./nodeviews/kinds"

// 只注册常用语言，控制包体积；围栏语言别名一并登记。
// 为进一步减小体积：javascript 复用 typescript（语法超集），
// csharp/c++ 复用 c（近似高亮），html/svg 复用 xml（hljs 官方即同一定义）。
var lowlight = createLowlight()
lowlight.register({
  typescript: typescript,
  python: python,
  java: java,
  c: cLang,
  php: php,
  go: go,
  css: cssLang,
  xml: xml,
  markdown: markdown,
  bash: bash
})
lowlight.registerAlias({
  typescript: ["ts", "tsx", "js", "jsx", "mjs", "javascript"],
  python: ["py"],
  c: ["cs", "c#", "csharp", "c++", "cpp"],
  go: ["golang"],
  xml: ["html", "svg"],
  markdown: ["md"],
  bash: ["sh", "shell", "zsh"]
})

// 语言切换菜单候选（值 = fence info 首词，均为已注册语言或其别名；"" 表示无语言纯文本）。
export var CODE_LANGUAGES: Array<{value: string, label: string}> = [
  {value: "ts", label: "TypeScript"},
  {value: "js", label: "JavaScript"},
  {value: "py", label: "Python"},
  {value: "java", label: "Java"},
  {value: "c", label: "C"},
  {value: "cpp", label: "C++"},
  {value: "cs", label: "C#"},
  {value: "php", label: "PHP"},
  {value: "go", label: "Go"},
  {value: "css", label: "CSS"},
  {value: "html", label: "HTML"},
  {value: "xml", label: "XML"},
  {value: "md", label: "Markdown"},
  {value: "sh", label: "Shell"},
  {value: "", label: "纯文本"}
]

// fence info 首词 → 语言切换主按钮显示的扩展名简写：
// 已收录语言原样返回（value 均为标准扩展名），常见别名归一到对应扩展名
// （python→py、javascript→js…），未收录的语言保持原词（如用户自写的 kotlin）。
// 只影响显示与候选高亮，不改变写回 params 的候选值。
var FENCE_WORD_ALIASES: Record<string, string> = {
  python: "py",
  javascript: "js",
  jsx: "js",
  mjs: "js",
  tsx: "ts",
  golang: "go",
  csharp: "cs",
  "c#": "cs",
  "c++": "cpp",
  bash: "sh",
  shell: "sh",
  zsh: "sh"
}

export function fenceWordShort(word: string): string {
  var lower = String(word == null ? "" : word).trim().toLowerCase()
  if (!lower) {
    return ""
  }
  for (var i = 0; i < CODE_LANGUAGES.length; i += 1) {
    if (CODE_LANGUAGES[i].value === lower) {
      return CODE_LANGUAGES[i].value
    }
  }
  return FENCE_WORD_ALIASES[lower] || word
}

// 围栏语言（fence info 首个词）→ 已注册的 highlight.js 语言名。
// 未注册的语言返回空串，跳过分词（保持纯文本）。
function languageNameFor(params: string | null | undefined): string {
  var name = String(params == null ? "" : params).trim().split(/\s+/)[0].toLowerCase()
  if (name && lowlight.registered(name)) {
    return name
  }
  return ""
}

interface CodeToken {
  from: number
  to: number
  cls: string
}

// 分词结果缓存：键 = 语言 + 全文，值 = 相对文本起点的 token 列表。
// 代码块内容未变时直接命中缓存，整篇文档扫描无需重复分词。
var tokenCache = new Map<string, CodeToken[]>()
var TOKEN_CACHE_LIMIT = 300

function tokenizeCode(language: string, text: string): CodeToken[] {
  var key = language + "\n" + text
  var cached = tokenCache.get(key)
  if (cached) {
    return cached
  }
  var tokens: CodeToken[] = []
  try {
    var root: Parent = lowlight.highlight(language, text)
    collectTokens(root as unknown as Element, 0, null, tokens)
  } catch (error) {
    // 单个语言分词失败不影响编辑，退化为纯文本
    console.warn("code highlight failed for", language, error)
  }
  if (tokenCache.size >= TOKEN_CACHE_LIMIT) {
    tokenCache.clear()
  }
  tokenCache.set(key, tokens)
  return tokens
}

// 深度优先遍历 HAST 树，累加文本长度得到每个 token 的 [from, to) 区间。
function collectTokens(node: Element | HastText, offset: number, cls: string | null, tokens: CodeToken[]) {
  if (node.type === "text") {
    return offset + (node as HastText).value.length
  }
  var element = node as Element
  var classNames = (element.properties && element.properties.className) || []
  var nextCls: string | null = cls
  if (classNames && classNames.length) {
    var own = classNames.join(" ")
    nextCls = cls ? cls + " " + own : own
  }
  var end = offset
  var children = element.children || []
  for (var i = 0; i < children.length; i++) {
    end = collectTokens(children[i] as Element | HastText, end, nextCls, tokens)
  }
  if (nextCls && end > offset) {
    tokens.push({ from: offset, to: end, cls: nextCls })
  }
  return end
}

interface CodeHighlightState {
  decorations: DecorationSet
}

export var codeHighlightKey = new PluginKey<CodeHighlightState>("codeHighlight")

export function createCodeHighlightPlugin(): Plugin<CodeHighlightState> {
  return new Plugin<CodeHighlightState>({
    key: codeHighlightKey,
    state: {
      init: function (_, state) {
        return { decorations: buildDecorations(state.doc) }
      },
      apply: function (tr, value) {
        if (!tr.docChanged) {
          return value
        }
        // 简化处理：文档变化时整篇重建（未变化的代码块命中缓存）。
        // 避免增量区间合并带来的边界错误。
        return { decorations: buildDecorations(tr.doc) }
      }
    },
    props: {
      decorations: function (state) {
        var pluginState = codeHighlightKey.getState(state)
        return pluginState ? pluginState.decorations : DecorationSet.empty
      }
    }
  })
}

// 遍历文档中所有 code_block，为每个块生成 inline 装饰（+1 跳过开节点）。
function buildDecorations(doc: PMNode): DecorationSet {
  var decorations: Decoration[] = []
  doc.descendants(function (node, pos) {
    if (node.type.name !== "code_block" || isMermaidCodeBlock(node)) {
      return
    }
    var language = languageNameFor(node.attrs && node.attrs.params)
    if (!language || !node.textContent) {
      return
    }
    var tokens = tokenizeCode(language, node.textContent)
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i]
      if (token.to > token.from) {
        decorations.push(Decoration.inline(pos + 1 + token.from, pos + 1 + token.to, {
          class: token.cls
        }))
      }
    }
  })
  return DecorationSet.create(doc, decorations)
}