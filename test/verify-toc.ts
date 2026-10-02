// TOC 面板功能验证（无头，fake DOM/view）：
// 1. collectTocItems 采集 heading（层级、文本、pos）并遵守 maxDepth
// 2. normalizeTocMaxDepth 边界值
// 3. 面板渲染（HTML 转义、缩进、maxDepth）
// 4. 点击 TOC 项跳转（纯原生锚点：不拦截默认行为、不派发事务）
// 5. 源码模式 refresh 置灰；文档变更后 refresh 更新列表
// 6. destroy 清理
import { EditorState } from "prosemirror-state"
import { buildSchema } from "../src/prosemirror/schema"
import { buildMarkdownParser, parseMarkdown } from "../src/prosemirror/markdown"
import { buildPlugins } from "../src/prosemirror/plugins"
import { collectTocItems, normalizeTocMaxDepth, bindTocPanel, tocHeadingStartLevel } from "../src/prosemirror/toc"
import { SvgIcon } from "../src/icons"

var failures = 0

function assert(label: string, ok: boolean, extra?: string) {
  if (ok) {
    console.log("PASS: " + label)
  } else {
    failures += 1
    console.log("FAIL: " + label + (extra ? "  [" + extra + "]" : ""))
  }
}

// ---------- 极简 DOM 桩 ----------
class FakeElementClass {
  owner: any
  innerHTML = ""
  textContent = ""
  style: { paddingLeft: string }
  listeners: Record<string, Function> = {}
  attrs: Record<string, string> = {}
  classList = {
    _set: new Set<string>(),
    add(c: string) { this._set.add(c) },
    remove(c: string) { this._set.delete(c) },
    toggle(c: string, force?: boolean) {
      var on = force === undefined ? !this._set.has(c) : !!force
      if (on) { this._set.add(c) } else { this._set.delete(c) }
    },
    contains(c: string) { return this._set.has(c) }
  }
  constructor(owner?: any) {
    this.owner = owner || null
    this.style = { paddingLeft: "" }
  }
  getAttribute(name: string) { return this.attrs[name] }
  addEventListener(type: string, fn: Function) { this.listeners[type] = fn }
  removeEventListener(type: string) { delete this.listeners[type] }
  closest(sel: string) {
    if (sel.indexOf("data-md-editor-toc-toggle") !== -1) {
      return this.attrs["data-md-editor-toc-toggle"] ? this : null
    }
    if (sel.indexOf("data-md-editor-toc-item") !== -1) {
      return this.attrs["data-md-editor-toc-item"] ? this : null
    }
    return null
  }
}

var stubWindow = {
  getComputedStyle: function () { return { overflowY: "visible" } },
  addEventListener: function () {},
  removeEventListener: function () {}
}
;(globalThis as any).window = stubWindow
;(globalThis as any).Element = function FakeElementStub() {}

// ---------- 极简 document 桩（供 JSX 运行时 h() 构建面板结构） ----------
class FakeTextNode {
  nodeType = 3
  text = ""
  constructor(text: string) { this.text = text }
}

class FakeDomElement {
  nodeType = 1
  tagName = ""
  innerHTML = ""
  children: Array<FakeDomElement | FakeTextNode> = []
  attrs: Record<string, string> = {}
  style: Record<string, string> = {}
  parentNode: FakeDomElement | null = null
  constructor(tag: string) { this.tagName = tag }
  appendChild(node: any) {
    node.parentNode = this
    this.children.push(node)
    return node
  }
  insertBefore(node: any, ref: any) {
    node.parentNode = this
    var idx = ref ? this.children.indexOf(ref) : -1
    if (idx === -1) {
      this.children.push(node)
    } else {
      this.children.splice(idx, 0, node)
    }
    return node
  }
  get firstChild() {
    return this.children.length ? this.children[0] : null
  }
  get firstElementChild() {
    for (var i = 0; i < this.children.length; i += 1) {
      if ((this.children[i] as any).nodeType === 1) {
        return this.children[i] as FakeDomElement
      }
    }
    return null
  }
  setAttribute(name: string, value: string) { this.attrs[name] = value }
  getAttribute(name: string) { return name in this.attrs ? this.attrs[name] : null }
  get outerHTML() { return serializeFakeDom(this) }
}

// 序列化规则对齐浏览器 outerHTML：属性保持插入顺序、文本/属性值转义
function escapeFakeAttr(value: string) {
  return String(value).split("&").join("&amp;").split('"').join("&quot;")
}

function escapeFakeText(text: string) {
  return String(text).split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;")
}

function serializeFakeDom(node: any): string {
  if (node.nodeType === 3) { return escapeFakeText(node.text) }
  var html = ""
  if (node.tagName) {
    html += "<" + node.tagName
    for (var attrName in node.attrs) {
      html += " " + attrName + '="' + escapeFakeAttr(node.attrs[attrName]) + '"'
    }
    html += ">"
  }
  if (node.innerHTML) {
    html += node.innerHTML
  } else {
    for (var i = 0; i < node.children.length; i += 1) {
      html += serializeFakeDom(node.children[i])
    }
  }
  if (node.tagName) {
    html += "</" + node.tagName + ">"
  }
  return html
}

var stubDocument = {
  createElement: function (tag: string) { return new FakeDomElement(tag) },
  createDocumentFragment: function () { return new FakeDomElement("") },
  createTextNode: function (text: string) { return new FakeTextNode(text) },
  // 已存在样式桩：让 ensureStyles 之类提前返回，不真正插 <style>
  getElementById: function () { return { tagName: "style" } },
  body: null,
  documentElement: null,
  head: null
}
;(globalThis as any).document = stubDocument

// 解析 buildTocPanelHTML 生成的锚点
function parseTocLinks(html: string) {
  var out: FakeElementClass[] = []
  var re = /<a class="md-editor-toc-item" data-md-editor-toc-item="1" data-pos="(\d+)" href="#([^"]*)">([\s\S]*?)<\/a>/g
  var m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    var el: any = new FakeElementClass()
    el.attrs = { "data-md-editor-toc-item": "1", "data-pos": m[1] }
    el.textContent = m[3]
    out.push(el)
  }
  return out
}

class FakeRoot extends FakeElementClass {
  replaceChildren(node: any) { this.innerHTML = node ? node.outerHTML : "" }
  querySelectorAll() { return parseTocLinks(this.innerHTML) }
  querySelector(sel: string) {
    var m = sel.match(/data-pos="(\d+)"/)
    if (!m) { return null }
    var all = parseTocLinks(this.innerHTML)
    for (var i = 0; i < all.length; i += 1) {
      var el: any = all[i]
      if (el.attrs["data-pos"] === m[1]) { return el }
    }
    return null
  }
  contains(el: any) { return !!(el && el.owner === this) }
  fireClick(target: any) {
    if (!this.listeners.click) {
      return null
    }
    var ev: any = { target: target, defaultPrevented: false }
    ev.preventDefault = function () { ev.defaultPrevented = true }
    this.listeners.click(ev)
    return ev
  }
}

// ---------- 数据准备 ----------
var schema = buildSchema()
var parser = buildMarkdownParser(schema)
var markdown = [
  "# 一级 & <b>标签</b>",
  "",
  "正文段落",
  "",
  "## 二级甲 & <b>粗</b>",
  "",
  "### 三级深",
  "",
  "## 二级乙",
  "",
  "#### 四级更深"
].join("\n")
var state = EditorState.create({
  schema: schema,
  doc: parseMarkdown(schema, parser, markdown),
  plugins: buildPlugins(schema)
})

// 1. 采集：文档有 h1 -> 起始层级 1，h1 也进 TOC
var items = collectTocItems(state, 6)
assert("采集 5 个 heading（含 h1）", items.length === 5, "got " + items.length)
assert("层级正确", items[0].level === 1 && items[1].level === 2 && items[2].level === 3 && items[3].level === 2 && items[4].level === 4)
assert("文本为原文", items[1].text === "二级甲 & <b>粗</b>", "got " + JSON.stringify(items[1].text))
assert("起始层级取最小 heading 层级", tocHeadingStartLevel(items) === 1, "got " + tocHeadingStartLevel(items))
assert("空文档起始层级退化 2", tocHeadingStartLevel([]) === 2)
assert("仅 h2 及以上起始层级为 2", tocHeadingStartLevel([{level: 2}, {level: 3}]) === 2)
var shallow = collectTocItems(state, 2)
assert("maxDepth=2 过滤深层", shallow.length === 3, "got " + shallow.length)
assert("pos 指向 heading 节点", state.doc.nodeAt(items[1].pos)!.type.name === "heading")

// 2. 边界
assert("默认深度 6", normalizeTocMaxDepth(undefined) === 6)
assert("clamp 到 [2,6]", normalizeTocMaxDepth(0) === 2 && normalizeTocMaxDepth(1) === 2 && normalizeTocMaxDepth(9) === 6)
assert("非法值回退 6", normalizeTocMaxDepth(Number("x")) === 6)

// ---------- 面板行为 ----------
var viewState = state
var dispatchCount = 0
var view: any = {
  get state() { return viewState },
  dom: { parentElement: null },
  nodeDOM: function () { return null },
  dispatch: function (tr: any) { dispatchCount += 1; viewState = viewState.apply(tr) },
  focus: function () {},
  hasFocus: function () { return false }
}

var sourceMode = false
var runtime: any = { isSourceMode: function () { return sourceMode } }

var tocRoot: any = new FakeRoot()
var panel = bindTocPanel(tocRoot, view, { tocMaxDepth: 6 }, runtime)

var links = tocRoot.querySelectorAll()
assert("面板渲染 5 个链接", links.length === 5, "got " + links.length)
// 可折叠项（h1、二级甲、二级乙）链接文本前带指示符，叶子项（三级深、四级更深）不带
var branchMarkerHTML = '<span class="md-editor-toc-branch-marker" aria-hidden="true">' + SvgIcon.chevronRight + "</span>"
assert("标题文本已转义", links[1].textContent === branchMarkerHTML + "二级甲 &amp; &lt;b&gt;粗&lt;/b&gt;", "got " + links[1].textContent)
assert("有子菜单的项带折叠指示符", links[0].textContent.indexOf("md-editor-toc-branch-marker") !== -1 && links[1].textContent.indexOf("md-editor-toc-branch-marker") !== -1 && links[3].textContent.indexOf("md-editor-toc-branch-marker") !== -1)
assert("无子菜单的项无折叠指示符", links[2].textContent.indexOf("md-editor-toc-branch-marker") === -1 && links[4].textContent.indexOf("md-editor-toc-branch-marker") === -1)
assert("原始 HTML 无注入", tocRoot.innerHTML.indexOf("<b>") === -1)
assert("文档有 h1 时 h1 出现在面板顶层", tocRoot.innerHTML.indexOf("一级 &amp;") !== -1)
assert("href 填真实锚点 id", tocRoot.innerHTML.indexOf('href="#h%E4%BA%8C%E7%BA%A7%E7%94%B2%20%26%20%3Cb%3E%E7%B2%97%3C%2Fb%3E"') !== -1, "got " + tocRoot.innerHTML.slice(0, 200))

// 嵌套 ol 结构：root + h1 内 1 个（含二级甲/乙及其子层）+ 二级甲内 1 个（含三级深）+ 二级乙内 1 个（含四级）
var tocHTML = tocRoot.innerHTML
assert("内容包裹在 inner 容器内", tocHTML.indexOf('<div class="md-editor-toc-inner">') === 0 && tocHTML.lastIndexOf("</div>") > tocHTML.lastIndexOf("</ol>"), "got head=" + tocHTML.slice(0, 40))
assert("列表包裹在 content 容器内", tocHTML.indexOf('<div class="md-editor-toc-content"><ol class="md-editor-toc-list">') !== -1 && tocHTML.lastIndexOf("</ol></div></div>") === tocHTML.length - "</ol></div></div>".length, "got tail=" + tocHTML.slice(-40))
assert("根列表为 ol", tocHTML.indexOf('<ol class="md-editor-toc-list">') === tocHTML.indexOf("<ol"))
assert("共 4 个 ol（root+3 嵌套）", tocHTML.split("<ol").length - 1 === 4, "got " + (tocHTML.split("<ol").length - 1))
assert("h1 为顶层第一项", tocHTML.indexOf('<li class="open"><a class="md-editor-toc-item" data-md-editor-toc-item="1" data-pos="' + items[0].pos + '"') !== -1, "got head=" + tocHTML.slice(0, 200))
assert("无内联缩进样式", tocHTML.indexOf("padding-left") === -1)
var idxH2a = tocHTML.indexOf("二级甲")
var idxNestedAfterH2a = tocHTML.indexOf("md-editor-toc-nested", idxH2a)
var idxH3 = tocHTML.indexOf("三级深")
var idxH2b = tocHTML.indexOf("二级乙")
assert("三级深嵌套在二级甲内", idxH2a !== -1 && idxH2a < idxNestedAfterH2a && idxNestedAfterH2a < idxH3)
assert("二级乙前嵌套已闭合", tocHTML.indexOf("</li></ol></li><li class=\"open\"><a") !== -1 && idxH3 < idxH2b)

// 展开态：有子菜单的 li 渲染时即带 open 类（默认全开），无子菜单的 li 不带
assert(
  "展开态有子菜单的 li 默认带 open 类",
  tocHTML.indexOf('<li class="open"><a class="md-editor-toc-item" data-md-editor-toc-item="1" data-pos="' + items[0].pos + '"') !== -1 &&
    tocHTML.indexOf('<li class="open"><a class="md-editor-toc-item" data-md-editor-toc-item="1" data-pos="' + items[1].pos + '"') !== -1 &&
    tocHTML.indexOf('<li class="open"><a class="md-editor-toc-item" data-md-editor-toc-item="1" data-pos="' + items[3].pos + '"') !== -1,
  "got head=" + tocHTML.slice(0, 200)
)
assert("展开态无子菜单的 li 不带 open 类", tocHTML.indexOf('<li class="open"><a class="md-editor-toc-item" data-md-editor-toc-item="1" data-pos="' + items[2].pos + '"') === -1)

// 全部折叠/展开按钮
assert("标题区含折叠按钮", tocHTML.indexOf('data-md-editor-toc-toggle="1"') !== -1)
assert("展开态显示收起指示图标", tocHTML.indexOf('data-name="list-chevrons-down-up"') !== -1 && tocHTML.indexOf('data-name="list-chevrons-up-down"') === -1)
var toggleBtn: any = new FakeElementClass(tocRoot)
toggleBtn.attrs = { "data-md-editor-toc-toggle": "1" }
tocRoot.fireClick(toggleBtn)
assert("点击折叠后 root 加 collapsed 类", tocRoot.classList.contains("collapsed"))
assert("折叠态显示展开指示图标", tocRoot.innerHTML.indexOf('data-name="list-chevrons-up-down"') !== -1 && tocRoot.innerHTML.indexOf('data-name="list-chevrons-down-up"') === -1)
assert("折叠态 aria-pressed", tocRoot.innerHTML.indexOf('data-md-editor-toc-toggle="1" aria-pressed="true"') !== -1)
tocRoot.fireClick(toggleBtn)
assert("再次点击恢复展开", !tocRoot.classList.contains("collapsed") && tocRoot.innerHTML.indexOf('data-name="list-chevrons-down-up"') !== -1)

// 展开态点击单项收起其子菜单、再次点击恢复
var h2aLinkExpanded: any = tocRoot.querySelector('[data-pos="' + items[0].pos + '"]')
h2aLinkExpanded.owner = tocRoot
h2aLinkExpanded.parentElement = new FakeElementClass()
h2aLinkExpanded.parentElement.classList.add("open")
tocRoot.fireClick(h2aLinkExpanded)
assert("展开态点击单项收起子菜单", !h2aLinkExpanded.parentElement.classList.contains("open"))
tocRoot.fireClick(h2aLinkExpanded)
assert("展开态再次点击单项恢复展开", h2aLinkExpanded.parentElement.classList.contains("open"))

// 折叠态点击单项切换其子菜单展开/收起
tocRoot.fireClick(toggleBtn)
var h2aLink: any = tocRoot.querySelector('[data-pos="' + items[0].pos + '"]')
h2aLink.owner = tocRoot
h2aLink.parentElement = new FakeElementClass()
tocRoot.fireClick(h2aLink)
assert("点击单项后 li 加 open 类", h2aLink.parentElement.classList.contains("open"))
tocRoot.fireClick(h2aLink)
assert("再次点击单项收起子菜单", !h2aLink.parentElement.classList.contains("open"))

// 全部收起须清空单项展开状态、全部展开须重置单项状态（右侧按钮与链接操作保持一致）
tocRoot.fireClick(h2aLink)
assert("折叠态单项展开子菜单", h2aLink.parentElement.classList.contains("open"))
tocRoot.fireClick(toggleBtn)
var reopenLink: any = tocRoot.querySelector('[data-pos="' + items[0].pos + '"]')
reopenLink.owner = tocRoot
reopenLink.parentElement = new FakeElementClass()
reopenLink.parentElement.classList.add("open")
tocRoot.fireClick(reopenLink)
assert("全部展开后单项点击收起子菜单", !reopenLink.parentElement.classList.contains("open"))
assert("全部展开态 root 无 collapsed 类", !tocRoot.classList.contains("collapsed"))

// maxDepth 面板
var tocRoot2: any = new FakeRoot()
var panel2 = bindTocPanel(tocRoot2, view, { tocMaxDepth: 2 }, runtime)
assert("面板遵守 maxDepth=2（h1+两个 h2）", tocRoot2.querySelectorAll().length === 3, "got " + tocRoot2.querySelectorAll().length)
panel2.destroy()
assert("destroy 清空并移除类", tocRoot2.innerHTML === "" && !tocRoot2.classList.contains("md-editor-toc"))
assert("destroy 解绑点击", tocRoot2.listeners.click === undefined)

// 点击跳转：纯原生锚点
var secondHeadingPos = items[1].pos
var jumpLink: any = tocRoot.querySelector('[data-pos="' + secondHeadingPos + '"]')
jumpLink.owner = tocRoot
jumpLink.parentElement = new FakeElementClass()
var dispatchBefore = dispatchCount
var clickEv = tocRoot.fireClick(jumpLink)
assert("点击链接不阻止默认行为（交给浏览器原生锚点跳转）", !!(clickEv && !clickEv.defaultPrevented))
assert("点击链接不派发编辑器事务", dispatchCount === dispatchBefore, "dispatch +" + (dispatchCount - dispatchBefore))
assert("点击链接不抢占编辑器焦点", !view.hasFocus())

// 伪造 data-pos 不应崩（仅切换面板展开状态）
var badLink: any = new FakeElementClass(tocRoot)
badLink.attrs = { "data-pos": "99999" }
tocRoot.fireClick(badLink)

// 源码模式置灰
sourceMode = true
panel.refresh()
assert("源码模式置灰", tocRoot.classList.contains("disabled"))

// 文档变更后 refresh 更新列表；展开态手动收起的项重渲染后保持收起
sourceMode = false
panel.refresh()
var closeLink: any = tocRoot.querySelector('[data-pos="' + items[0].pos + '"]')
closeLink.owner = tocRoot
closeLink.parentElement = new FakeElementClass()
closeLink.parentElement.classList.add("open")
tocRoot.fireClick(closeLink)
assert("展开态收起单项子菜单", !closeLink.parentElement.classList.contains("open"))
var before = tocRoot.querySelectorAll().length
var headingNode = schema.nodes.heading.createAndFill({ level: 2 }, schema.text("新增标题"))
view.dispatch(view.state.tr.insert(view.state.doc.content.size, headingNode!))
panel.refresh()
assert("文档变更后 refresh 更新列表", tocRoot.querySelectorAll().length === before + 1, "got " + tocRoot.querySelectorAll().length)
assert(
  "重渲染后收起状态恢复",
  tocRoot.innerHTML.indexOf('<li class="open"><a class="md-editor-toc-item" data-md-editor-toc-item="1" data-pos="' + items[0].pos + '"') === -1
)
assert(
  "重渲染后未收起项保持展开",
  tocRoot.innerHTML.indexOf('<li class="open"><a class="md-editor-toc-item" data-md-editor-toc-item="1" data-pos="' + items[1].pos + '"') !== -1
)

panel.destroy()
assert("主面板 destroy 清理", tocRoot.innerHTML === "" && !tocRoot.classList.contains("md-editor-toc"))

// 重复标题锚点唯一性：同名第 n 次出现追加 -n
var dupState = EditorState.create({
  schema: schema,
  doc: schema.nodes.doc.create(null, [
    schema.nodes.heading.create({level: 2}, schema.text("重复标题")),
    schema.nodes.paragraph.create(null, schema.text("a")),
    schema.nodes.heading.create({level: 3}, schema.text("重复标题")),
    schema.nodes.paragraph.create(null, schema.text("b")),
    schema.nodes.heading.create({level: 2}, schema.text("重复标题"))
  ])
})
var dupItems = collectTocItems(dupState, 6)
assert("重复标题采集 3 项", dupItems.length === 3, "got " + dupItems.length)
assert("首个同名用基础 id", dupItems[0].anchorId === "h" + encodeURIComponent("重复标题"), "got " + dupItems[0].anchorId)
assert("第二个同名追加 -2", dupItems[1].anchorId === "h" + encodeURIComponent("重复标题") + "-2", "got " + dupItems[1].anchorId)
assert("第三个同名追加 -3", dupItems[2].anchorId === "h" + encodeURIComponent("重复标题") + "-3", "got " + dupItems[2].anchorId)
var dupView: any = {
  get state() { return dupState },
  dom: { parentElement: null },
  nodeDOM: function () { return null },
  dispatch: function () {},
  focus: function () {},
  hasFocus: function () { return false }
}
var dupRoot: any = new FakeRoot()
bindTocPanel(dupRoot, dupView, {tocMaxDepth: 6}, runtime)
var dupHTML = dupRoot.innerHTML
assert("面板 href 使用唯一 id", dupHTML.indexOf('href="#' + "h" + encodeURIComponent("重复标题") + '-2"') !== -1, "got " + dupHTML.slice(0, 300))
var dupPanelIds = [dupItems[0].anchorId, dupItems[1].anchorId, dupItems[2].anchorId]
assert("三个 id 互不相同", dupPanelIds[0] !== dupPanelIds[1] && dupPanelIds[1] !== dupPanelIds[2] && dupPanelIds[0] !== dupPanelIds[2])

if (failures) {
  console.log("FAILURES: " + failures)
  process.exit(1)
}
console.log("ALL TOC TESTS PASSED")