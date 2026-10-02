import { EditorState } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Node as PMNode } from "prosemirror-model"
import { collectHeadingAnchors } from "./plugins"
import { CommandRuntimeState } from "../types"
import { SvgIcon } from "../icons"
import { hasClass, addClass, removeClass, toggleClass } from "../utils"
import { h } from "../jsx"

export interface TocItem {
  level: number
  text: string
  pos: number
  anchorId: string
}

// 计算目录起始层级：文档中出现过的最小 heading 层级。
// 有 h1 就是 1，只有 h2 及以上就是 2，以此类推；空列表退化为 2。
export function tocHeadingStartLevel(items: { level: number }[]): number {
  var startLevel = 2
  for (var i = 0; i < items.length; i += 1) {
    if (items[i].level < startLevel) {
      startLevel = items[i].level
    }
  }
  return startLevel
}

// 收集文档中的 heading（从 tocHeadingStartLevel 起始层到 maxDepth 层）。
// anchorId 与 heading 装饰 id 同源（文档内唯一），供 href 锚点使用。
export function collectTocItems(state: EditorState, maxDepth: number): TocItem[] {
  var anchors = collectHeadingAnchors(state)
  var startLevel = tocHeadingStartLevel(anchors)
  var items: TocItem[] = []
  for (var i = 0; i < anchors.length; i += 1) {
    var anchor = anchors[i]
    if (anchor.level >= startLevel && anchor.level <= maxDepth) {
      items.push({
        level: anchor.level,
        text: anchor.text,
        pos: anchor.pos,
        anchorId: anchor.id
      })
    }
  }
  return items
}

export function normalizeTocMaxDepth(maxDepth?: number) {
  var value = Number(maxDepth)
  if (!Number.isFinite(value)) {
    return 6
  }
  var level = Math.floor(value)
  if (level < 2) {
    return 2
  }
  if (level > 6) {
    return 6
  }
  return level
}

// 全部展开/全部折叠切换按钮（标题右侧）：展开态显示收起指示，折叠态显示展开指示
function buildToggleElement(collapsed: boolean) {
  return (
    <button
      type="button"
      className={"md-editor-toc-toggle" + (collapsed ? " collapsed" : "")}
      data-md-editor-toc-toggle="1"
      aria-pressed={collapsed ? "true" : "false"}
      title={collapsed ? "展开全部" : "折叠全部"}
      innerHTML={collapsed ? SvgIcon.listChevronsUpDown : SvgIcon.listChevronsDownUp}
    />
  )
}

// 含子菜单的项在渲染时即带 open 初始类（展开态默认全开、openPositions 显式 false
// 才收起；折叠态默认全收、显式 true 才展开）。空容器 li（列表首项即深层标题）无对应
// 项，open 仅随面板整体状态。
function isOpenItem(item: TocItem | null, collapsed: boolean, openPositions: { [key: string]: boolean }) {
  if (!item) {
    return !collapsed
  }
  var open = openPositions[String(item.pos)]
  return collapsed ? !!open : open !== false
}

// 可折叠项（含子菜单）的展开/收起指示符：右箭头，展开时由 CSS 旋转 90° 为下箭头；
// 无子菜单的项不渲染。空容器 li（列表首项即深层标题）无链接，指示符直接挂 li。
function buildBranchMarker() {
  return (
    <span className="md-editor-toc-branch-marker" aria-hidden="true" innerHTML={SvgIcon.chevronRight} />
  )
}

// 渲染为嵌套 ol：heading 层级映射为列表嵌套深度，顶层基准为 tocHeadingStartLevel
// （文档有 h1 时 h1 为顶层，只有 h2 及以上时 h2 为顶层）
// ols 记录各深度当前未换行的 ol；lis/liItems 记录各深度最近一条 li 及其目录项（用于挂嵌套 ol）
function buildTocListElement(items: TocItem[], collapsed: boolean, openPositions: { [key: string]: boolean }) {
  var list = <ol className="md-editor-toc-list" />
  var ols: HTMLElement[] = [list]
  var levels: number[] = [tocHeadingStartLevel(items)]
  var lis: (HTMLElement | null)[] = [null]
  var liItems: (TocItem | null)[] = [null]
  for (var i = 0; i < items.length; i += 1) {
    var item = items[i]
    var level = item.level
    while (levels.length > 1 && levels[levels.length - 1] > level) {
      levels.pop()
      ols.pop()
      lis.pop()
      liItems.pop()
    }
    if (level > levels[levels.length - 1]) {
      var parentLi = lis[levels.length - 1]
      var parentItem = liItems[levels.length - 1]
      if (!parentLi) {
        // 列表首项即深层标题（如文档以 h3 开头）：补一个空 li 作嵌套容器，
        // 指示符直接挂 li（后续 nested ol 追加其后，保持指示符在首位）
        parentLi = <li />
        parentLi.appendChild(buildBranchMarker())
        ols[ols.length - 1].appendChild(parentLi)
        lis[levels.length - 1] = parentLi
        liItems[levels.length - 1] = null
      } else {
        // 有子菜单的项：指示符插到链接文本之前，点击链接时一并切换展开/收起
        var parentLink = parentLi.firstElementChild
        if (parentLink && parentLink.tagName.toUpperCase() === "A") {
          parentLink.insertBefore(buildBranchMarker(), parentLink.firstChild)
        }
      }
      if (isOpenItem(parentItem, collapsed, openPositions)) {
        parentLi.setAttribute("class", "open")
      }
      var nested = <ol className="md-editor-toc-nested" />
      parentLi.appendChild(nested)
      ols.push(nested)
      levels.push(level)
      lis.push(null)
      liItems.push(null)
    }
    var li = (
      <li>
        <a
          className="md-editor-toc-item"
          data-md-editor-toc-item="1"
          data-pos={String(item.pos)}
          href={"#" + item.anchorId}
        >
          {item.text}
        </a>
      </li>
    )
    ols[ols.length - 1].appendChild(li)
    lis[levels.length - 1] = li
    liItems[levels.length - 1] = item
  }
  return list
}

function buildTocPanel(items: TocItem[], collapsed: boolean, openPositions: { [key: string]: boolean }) {
  return (
    <div className="md-editor-toc-inner">
      <div className="md-editor-toc-title">
        <strong>目录</strong>
        {items.length ? buildToggleElement(collapsed) : null}
      </div>
      {items.length ? (
        <div className="md-editor-toc-content">{buildTocListElement(items, collapsed, openPositions)}</div>
      ) : (
        <div className="md-editor-toc-empty">无标题</div>
      )}
    </div>
  )
}

function findScrollParent(el: Element): Element | null {
  var node = el.parentElement
  while (node && node !== document.body && node !== document.documentElement) {
    var overflowY = window.getComputedStyle(node).overflowY
    if (overflowY === "auto" || overflowY === "scroll") {
      return node
    }
    node = node.parentElement
  }
  return null
}

// TOC 面板：渲染标题列表、点击跳转、滚动时高亮当前章节
export function bindTocPanel(
  root: Element,
  view: EditorView,
  opts: { tocMaxDepth?: number },
  runtime?: CommandRuntimeState
): { refresh: () => void; destroy: () => void } {
  var maxDepth = normalizeTocMaxDepth(opts && opts.tocMaxDepth)
  var items: TocItem[] = []
  var activeElement: Element | null = null
  var collapsed = false
  // 记录各目录项子菜单的展开状态（按 data-pos 索引）：
  // 展开态下 openPositions 显式 false 表示该项被手动收起、其余默认展开；
  // 折叠态下显式 true 表示该项被手动展开、其余默认收起。
  // 文档变更触发 refresh 重渲染面板，借此恢复 open 类
  var openPositions: { [key: string]: boolean } = {}
  var lastRenderedDoc: PMNode | null = null

  addClass(root, "md-editor-toc")

  function render() {
    items = collectTocItems(view.state, maxDepth)
    root.replaceChildren(buildTocPanel(items, collapsed, openPositions))
    activeElement = null
    lastRenderedDoc = view.state.doc
  }

  // 右侧按钮语义是“全部展开/全部收起”，须与单项链接的展开状态保持一致：
  // 全部收起时清空所有单项展开状态；全部展开时把所有单项置为展开
  function setCollapsed(next: boolean) {
    if (collapsed === next) {
      return
    }
    collapsed = next
    toggleClass(root, "collapsed", collapsed)
    openPositions = {}
    if (!next) {
      for (var i = 0; i < items.length; i += 1) {
        openPositions[String(items[i].pos)] = true
      }
    }
    render()
  }

  function setActive(el: Element | null) {
    if (activeElement === el) {
      return
    }
    if (activeElement && activeElement.classList) {
      removeClass(activeElement, "active")
    }
    activeElement = el
    if (el && el.classList) {
      addClass(el, "active")
    }
  }

  function updateActive() {
    if (hasClass(root, "disabled")) {
      return
    }
    // 滚动高亮的锚线：视口内 top <= anchorLine 的最后一个标题视为当前章节
    var anchorLine = 96
    var matched: Element | null = null
    for (var i = 0; i < items.length; i += 1) {
      var dom = view.nodeDOM(items[i].pos)
      if (!(dom instanceof Element)) {
        continue
      }
      var rect = dom.getBoundingClientRect()
      if (rect.top <= anchorLine) {
        var link = root.querySelector('[data-md-editor-toc-item][data-pos="' + items[i].pos + '"]')
        if (link) {
          matched = link
        }
      } else {
        break
      }
    }
    setActive(matched)
  }

  function onScroll() {
    updateActive()
  }

  function onClick(event: Event) {
    if (hasClass(root, "disabled")) {
      return
    }
    var target = event.target as Element | null
    var toggle = target && target.closest ? target.closest("[data-md-editor-toc-toggle]") : null
    if (toggle && root.contains(toggle)) {
      event.preventDefault()
      setCollapsed(!collapsed)
      return
    }
    var link = target && target.closest ? target.closest("[data-md-editor-toc-item]") : null
    if (!link || !root.contains(link)) {
      return
    }
    // 跳转完全交给浏览器原生锚点导航（href 指向 heading 装饰 id），不拦截默认行为、
    // 不派发事务也不抢占焦点；这里只负责切换单项子菜单的展开/收起：
    // 以 li 当前 open 类取反（展开态默认开、点击收起；折叠态默认收、点击展开），
    // 状态记入 openPositions 供文档变更重渲染后恢复
    var li = link.parentElement
    if (!li || !li.classList) {
      return
    }
    var posAttr = link.getAttribute("data-pos") || ""
    var nextOpen = !hasClass(li, "open")
    openPositions[posAttr] = nextOpen
    toggleClass(li, "open", nextOpen)
  }

  function refresh() {
    var sourceMode = !!(runtime && runtime.isSourceMode && runtime.isSourceMode())
    toggleClass(root, "disabled", sourceMode)
    if (sourceMode) {
      return
    }
    // 文档未变化（如仅选区变化的事务）时跳过重渲染，保留单项展开状态与面板滚动位置
    if (view.state.doc !== lastRenderedDoc) {
      render()
    }
    updateActive()
  }

  root.addEventListener("click", onClick)
  var scrollTarget: Element | Window = findScrollParent(view.dom) || window
  scrollTarget.addEventListener("scroll", onScroll, {passive: true})

  render()
  updateActive()

  return {
    refresh: refresh,
    destroy: function () {
      root.removeEventListener("click", onClick)
      scrollTarget.removeEventListener("scroll", onScroll)
      root.innerHTML = ""
      removeClass(root, "md-editor-toc")
      removeClass(root, "collapsed")
      items = []
      activeElement = null
      collapsed = false
      openPositions = {}
      lastRenderedDoc = null
    }
  }
}
