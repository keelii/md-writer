// 极简 JSX 运行时,配合 esbuild / tsc 的 --jsx-factory=h --jsx-fragment=Fragment 使用:
//   <div className="x" onClick={fn}>text{child}</div>
// 会被编译为 h("div", {className: "x", onClick: fn}, "text", child)

export type JSXChild = Node | string | number | null | undefined | false | Array<JSXChild>

export interface JSXAttrs {
  className?: string
  class?: string
  style?: string | Partial<CSSStyleDeclaration>
  // 内联 HTML 字符串(如 SvgIcon 中的 SVG),等价于 node.innerHTML = value
  innerHTML?: string
  [name: string]: unknown
}

// 空标签 <></> 的运行时标记:h(Fragment, null, ...children) 返回 DocumentFragment
// 声明为 any:tsc --jsx react 要求 fragment 工厂有构造/调用签名,Symbol() 类型会报 TS2604
export var Fragment: any = Symbol("Fragment")

export function h(tag: symbol, attrs?: JSXAttrs | null, ...children: JSXChild[]): DocumentFragment
export function h(tag: string, attrs?: JSXAttrs | null, ...children: JSXChild[]): HTMLElement
export function h(tag: any, attrs?: any, ...children: any[]): any {
  var node: Node
  if (tag === Fragment) {
    node = document.createDocumentFragment()
  } else {
    node = document.createElement(tag)
  }
  if (attrs) {
    for (var name in attrs) {
      applyAttr(node, name, attrs[name])
    }
  }
  appendChildren(node, children)
  return node
}

function applyAttr(node: Node, name: string, value: unknown) {
  if (value == null || value === false) {
    return
  }
  if (name === "className" || name === "class") {
    setAttr(node, "class", String(value))
    return
  }
  if (name === "innerHTML") {
    ;(node as HTMLElement).innerHTML = String(value)
    return
  }
  if (name === "style") {
    if (typeof value === "string") {
      setAttr(node, "style", value)
    } else if (value) {
      var style = (node as HTMLElement).style
      var props = value as Record<string, string>
      for (var prop in props) {
        style.setProperty(kebabCase(prop), String(props[prop]))
      }
    }
    return
  }
  if (name.slice(0, 2) === "on" && typeof value === "function") {
    ;(node as HTMLElement).addEventListener(name.slice(2).toLowerCase(), value as EventListener)
    return
  }
  setAttr(node, name, value === true ? "" : String(value))
}

function setAttr(node: Node, name: string, value: string) {
  if (typeof (node as HTMLElement).setAttribute === "function") {
    ;(node as HTMLElement).setAttribute(name, value)
  }
}

function kebabCase(prop: string) {
  return prop.replace(/[A-Z]/g, function (ch) {
    return "-" + ch.toLowerCase()
  })
}

function appendChildren(parent: Node, children: JSXChild[]) {
  for (var i = 0; i < children.length; i += 1) {
    appendChild(parent, children[i])
  }
}

function appendChild(parent: Node, child: JSXChild) {
  if (child == null || child === false) {
    return
  }
  if (Array.isArray(child)) {
    appendChildren(parent, child)
    return
  }
  if (typeof (child as any).nodeType === "number") {
    parent.appendChild(child as Node)
    return
  }
  parent.appendChild(document.createTextNode(String(child)))
}

// classic JSX 类型声明:任意标签可用、属性不做强校验;
// 元素类型取自 JSX.Element,继承 HTMLElement 使 <div/> 等可直接当 HTMLElement 使用
declare global {
  namespace JSX {
    interface Element extends HTMLElement {}
    interface ElementChildrenAttribute {
      children: {}
    }
    interface IntrinsicElements {
      [name: string]: JSXAttrs
    }
  }
}