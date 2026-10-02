// 韵律网格切换按钮验证（无头，fake DOM）：
// 1. renderViewButtons 渲染 toggle_rhythm 按钮（lucide-grid-3x3 图标、aria-label）
// 2. 点击 toggle_rhythm -> runtime.toggleRhythm 被调用（body 加/去 rhythm-grid 类）
// 3. refresh 按钮态跟随 isRhythmVisible：selected + aria-pressed
// 4. 二次点击还原
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
class FakeDomElement {
  nodeType = 1
  tagName = ""
  innerHTML = ""
  children: FakeDomElement[] = []
  attrs: Record<string, string> = {}
  listeners: Record<string, Array<(event: any) => void>> = {}
  classSet = new Set<string>()
  style: Record<string, string> = {}

  constructor(tag: string) {
    this.tagName = tag
  }

  get classList() {
    var self = this
    return {
      add: function (c: string) { self.classSet.add(c) },
      remove: function (c: string) { self.classSet.delete(c) },
      contains: function (c: string) { return self.classSet.has(c) },
      toggle: function (c: string, force?: boolean) {
        var on = force === undefined ? !self.classSet.has(c) : !!force
        if (on) {
          self.classSet.add(c)
        } else {
          self.classSet.delete(c)
        }
      }
    }
  }

  setAttribute(name: string, value: string) {
    this.attrs[name] = String(value)
  }

  getAttribute(name: string) {
    return name in this.attrs ? this.attrs[name] : null
  }

  addEventListener(type: string, fn: (event: any) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = []
    }
    this.listeners[type].push(fn)
  }

  appendChild(node: FakeDomElement) {
    this.children.push(node)
    return node
  }

  replaceChildren(...nodes: FakeDomElement[]) {
    this.children = nodes.slice()
  }

  querySelectorAll(selector: string) {
    if (selector === "[data-md-editor-view]") {
      return this.children.filter(function (el) {
        return !!el.getAttribute("data-md-editor-view")
      })
    }
    return []
  }
}

class FakeTextNode {
  nodeType = 3
  text: string

  constructor(text: string) {
    this.text = text
  }
}

var fakeBody = new FakeDomElement("body")

var stubDocument = {
  createElement: function (tag: string) { return new FakeDomElement(tag) },
  createDocumentFragment: function () { return new FakeDomElement("#document-fragment") },
  createTextNode: function (text: string) { return new FakeTextNode(text) },
  body: fakeBody,
  head: { appendChild: function () {} },
  documentElement: { style: {} }
}

;(globalThis as any).document = stubDocument
;(globalThis as any).Element = FakeDomElement
;(globalThis as any).window = {
  getComputedStyle: function () { return {} },
  addEventListener: function () {},
  removeEventListener: function () {}
}

function click(el: FakeDomElement) {
  var handlers = el.listeners["click"] || []
  for (var i = 0; i < handlers.length; i += 1) {
    handlers[i]({ preventDefault: function () {}, currentTarget: el })
  }
}

async function main() {
  const { renderViewButtons, bindViewButtons } = await import("../src/prosemirror/buttons")

  // 1. 渲染视图按钮区
  var root = new FakeDomElement("div")
  renderViewButtons(root)
  var viewNames = root.children.map(function (el) {
    return String(el.getAttribute("data-md-editor-view"))
  })
  assert("view buttons contain toggle_source", viewNames.indexOf("toggle_source") !== -1)
  assert("view buttons contain toggle_toc", viewNames.indexOf("toggle_toc") !== -1)
  assert("view buttons contain toggle_rhythm", viewNames.indexOf("toggle_rhythm") !== -1)

  var rhythmBtn: FakeDomElement | null = null
  for (var i = 0; i < root.children.length; i += 1) {
    if (root.children[i].getAttribute("data-md-editor-view") === "toggle_rhythm") {
      rhythmBtn = root.children[i]
      break
    }
  }
  assert("toggle_rhythm button rendered", !!rhythmBtn)
  if (!rhythmBtn) {
    console.log("FAILED: missing toggle_rhythm button")
    process.exit(1)
  }
  assert(
    "toggle_rhythm uses grid-3x3 icon",
    rhythmBtn.innerHTML.indexOf("lucide-grid-3x3") !== -1,
    rhythmBtn.innerHTML.slice(0, 80)
  )
  assert(
    "toggle_rhythm aria-label is 切换韵律网格",
    rhythmBtn.getAttribute("aria-label") === "切换韵律网格",
    String(rhythmBtn.getAttribute("aria-label"))
  )

  // 2. 绑定 + runtime 模拟 index.tsx 中的 body.rhythm-grid 切换
  var rhythmVisible = false
  var runtime = {
    toggleRhythm: function () {
      rhythmVisible = !rhythmVisible
      fakeBody.classList.toggle("rhythm-grid", rhythmVisible)
    },
    isRhythmVisible: function () {
      return rhythmVisible
    }
  }
  var controls = bindViewButtons(root as any, runtime)
  assert("initially aria-pressed false", rhythmBtn.getAttribute("aria-pressed") === "false")
  assert("initially not selected", !rhythmBtn.classSet.has("selected"))
  assert("initially body has no rhythm-grid", !fakeBody.classSet.has("rhythm-grid"))

  // 3. 首次点击：body 加类，refresh 后按钮选中
  click(rhythmBtn)
  assert("after first click body has rhythm-grid", fakeBody.classSet.has("rhythm-grid"))
  controls.refresh()
  assert("after refresh aria-pressed true", rhythmBtn.getAttribute("aria-pressed") === "true")
  assert("after refresh selected", rhythmBtn.classSet.has("selected"))

  // 4. 二次点击：还原
  click(rhythmBtn)
  assert("after second click body has no rhythm-grid", !fakeBody.classSet.has("rhythm-grid"))
  controls.refresh()
  assert("after second refresh aria-pressed false", rhythmBtn.getAttribute("aria-pressed") === "false")
  assert("after second refresh not selected", !rhythmBtn.classSet.has("selected"))

  if (failures > 0) {
    console.log("FAILED: " + failures)
    process.exit(1)
  }
  console.log("ALL RHYTHM GRID TESTS PASSED")
}

main()