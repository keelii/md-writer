// 快捷键帮助弹窗：分组表格展示全部快捷键，含软回车、双空格退出表格等无按钮的隐形功能。
// 复用 runManagedDialog 的 Escape / 遮罩点击 / 关闭按钮处理，footer 只保留一个"关闭"按钮。
import { runManagedDialog } from "./dialog"
import { h, Fragment, JSXChild } from "../jsx"

interface HelpSection {
  title: string;
  items: Array<Array<string>>;
}

var helpSections: HelpSection[] = [
  {
    title: "基础",
    items: [
      ["Meta+Z", "撤销"],
      ["Shift+Meta+Z / Meta+Y", "重做"],
      ["Meta+B", "加粗"],
      ["Meta+I", "斜体"],
      ["Meta+E", "切换源码模式"]
    ]
  },
  {
    title: "段落与块",
    items: [
      ["Shift+Enter / Alt+Enter", "软回车：段落或表格单元格内插入换行，不拆分段落"],
      ["Meta+Enter", "跳出当前块（表格 / 引用 / 列表 / 代码块 / 标题），在块后新建段落"],
      ["Enter", "表格末格新建一行；非末格软回车；列表中拆分列表项"],
      ["行内元素末尾连输两个空格", "退出当前行内格式（加粗 / 斜体 / 行内代码等）"]
    ]
  },
  {
    title: "表格",
    items: [
      ["Tab / Shift+Tab", "移到下一格 / 上一格"],
      ["Backspace（行首）", "删除当前行（光标在该行第一个单元格内容开头时）"],
      ["Backspace", "删除整个表格（表格仅剩一个空单元格时）"],
      ["Backspace / Delete（跨格选区）", "清空所选单元格内容（保留单元格，格内选区正常删除）"],
      ["Backspace / Delete（格内边界）", "无操作——单元格只能随整行 / 整列 / 整表删除，格内边界处不与相邻单元格合并"],
      ["末尾连输两个空格", "退出表格并在表后新建段落（两个空格均不保留在文档中）"]
    ]
  },
  {
    title: "列表与代码块",
    items: [
      ["Tab / Shift+Tab", "列表项降级 / 升级；代码块内缩进 / 反缩进"],
      ["Backspace / Delete", "删除整块预览（$$ 公式 / iframe / frontmatter / Mermaid 图 / SVG 块）"],
      ["鼠标悬停 · 删除按钮", "预览块左侧出现删除按钮，点击删除整块"]
    ]
  },
  {
    title: "预览交互",
    items: [
      ["Meta+滚轮", "缩放全屏预览中的 Mermaid 图 / SVG 块"],
      ["Esc", "退出全屏预览（Mermaid 图 / SVG 块）"]
    ]
  }
]

// 把快捷键文本拆成多个 kbd：组合键按 "+" 拆（如 Meta+Z → <kbd>Meta</kbd>+<kbd>Z</kbd>），
// 备选键按 " / " 拆（如 Tab / Shift+Tab → <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd>），
// 分隔符以纯文本呈现；不含分隔符的条目（如"末尾连输两个空格"）仍是单个 kbd。
function renderShortcutKeys(keyText: string): JSXChild[] {
  var out: JSXChild[] = []
  var alternatives = keyText.split(" / ")
  for (var ai = 0; ai < alternatives.length; ai += 1) {
    if (ai > 0) {
      out.push(" / ")
    }
    var keys = alternatives[ai].split("+")
    for (var ki = 0; ki < keys.length; ki += 1) {
      if (ki > 0) {
        out.push(" + ")
      }
      out.push(<kbd>{keys[ki]}</kbd>)
    }
  }
  return out
}

export function buildHelpBody(): Node {
  return (
    <div className="ui-shortcut-body">
      {helpSections.map(function (section) {
        return (
          <>
            <div className="ui-shortcut-section-title">{section.title}</div>
            <table className="ui-shortcut-table theme-default">
              <tbody>
                {section.items.map(function (item) {
                  return (
                    <tr>
                      <td className="ui-shortcut-key">{renderShortcutKeys(item[0])}</td>
                      <td>{item[1]}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )
      })}
    </div>
  )
}

export function openHelpDialog(opener: Element | null) {
  return runManagedDialog({
    id: "md-editor-help-dialog",
    title: "快捷键帮助",
    bodyElement: buildHelpBody(),
    width: "800px",
    buttonExtra: <small><a href="https://user-images.githubusercontent.com/458894/32358969-179e7a28-c085-11e7-882a-485164168f74.png" target="_blank">buy me a coffee</a> ❤️</small>,
    confirmLabel: "关闭",
    cancelLabel: "关闭",
    opener: opener || null,
    focusSelector: '[data-role~="md-editor-dialog-confirm"]',
    onOpen: function (backdrop) {
      // 帮助弹窗无取消语义，隐藏 footer 的取消按钮，只保留"关闭"
      var cancel = backdrop.querySelector('[data-role~="md-editor-dialog-cancel"]') as HTMLElement | null
      if (cancel) {
        cancel.hidden = true
      }
    }
  })
}
