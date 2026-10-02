// dropdown 关闭行为验证（最小 DOM stub）：
// 1. 点击 .md-editor-block-menu 之外的元素 -> 关闭所有 open 菜单
// 2. 点击菜单内部（closest 命中）-> 不关闭
// 3. plugin view destroy 后 -> 移除 document 监听，点击不再关闭

class FakeElement {
  className: string
  classes: Set<string>
  closestResult: FakeElement | null

  constructor(classes: string[], closestResult: FakeElement | null) {
    this.classes = new Set(classes)
    this.closestResult = closestResult
  }

  get classList() {
    var self = this
    return {
      add: function (c: string) { self.classes.add(c) },
      remove: function (c: string) { self.classes.delete(c) },
      contains: function (c: string) { return self.classes.has(c) },
      toggle: function (c: string) {
        if (self.classes.has(c)) {
          self.classes.delete(c)
        } else {
          self.classes.add(c)
        }
      }
    }
  }

  closest(_selector: string): FakeElement | null {
    return this.closestResult
  }
}

class FakeDocument {
  clickHandlers: Array<(event: any) => void>
  queryAllResult: FakeElement[]

  constructor() {
    this.clickHandlers = []
    this.queryAllResult = []
  }

  addEventListener(_type: string, fn: (event: any) => void) {
    this.clickHandlers.push(fn)
  }

  removeEventListener(_type: string, fn: (event: any) => void) {
    var idx = this.clickHandlers.indexOf(fn)
    if (idx >= 0) {
      this.clickHandlers.splice(idx, 1)
    }
  }

  querySelectorAll(_selector: string): FakeElement[] {
    return this.queryAllResult
  }

  getElementById(_id: string): FakeElement | null {
    return null
  }

  createElement(_tag: string): FakeElement {
    return new FakeElement([], null)
  }

  head = { appendChild: function (_el: any) {} }
  documentElement = { style: {} }
}

(globalThis as any).Element = FakeElement
var fakeDoc = new FakeDocument()
;(globalThis as any).document = fakeDoc

async function main() {
  const { createBlockMenuPlugin } = await import("../src/prosemirror/block-menu")

  var failures = 0
  function assertTrue(cond: boolean, label: string) {
    if (cond) {
      console.log("PASS: " + label)
    } else {
      failures += 1
      console.log("FAIL: " + label)
    }
  }

  var plugin = createBlockMenuPlugin([])
  if (!plugin) {
    throw new Error("plugin is null")
  }

  // 模拟 plugin view 生命周期
  var viewHandle = (plugin as any).spec.view({ state: null, dispatch: function () {}, focus: function () {} })

  function dispatchClick(target: FakeElement) {
    for (var i = 0; i < fakeDoc.clickHandlers.length; i += 1) {
      fakeDoc.clickHandlers[i]({ target: target })
    }
  }

  var openHost = new FakeElement(["md-editor-block-menu-open"], null)
  fakeDoc.queryAllResult = [openHost]

  // 1. 点击菜单外 -> 关闭
  dispatchClick(new FakeElement([], null))
  assertTrue(!openHost.classList.contains("md-editor-block-menu-open"), "outside click closes open menu")

  // 2. 点击菜单内（closest 命中菜单）-> 不关闭
  openHost.classList.add("md-editor-block-menu-open")
  var menuHost = new FakeElement(["md-editor-block-menu"], null)
  dispatchClick(new FakeElement([], menuHost))
  assertTrue(openHost.classList.contains("md-editor-block-menu-open"), "click inside menu keeps it open")

  // 3. destroy 后监听移除，点击不再关闭
  viewHandle.destroy()
  openHost.classList.add("md-editor-block-menu-open")
  dispatchClick(new FakeElement([], null))
  assertTrue(
    fakeDoc.clickHandlers.length === 0,
    "destroy removes document listener"
  )
  assertTrue(openHost.classList.contains("md-editor-block-menu-open"), "after destroy, outside click no longer closes")

  if (failures === 0) {
    console.log("ALL MENU CLOSE TESTS PASSED")
  } else {
    console.log(failures + " FAILURES")
    process.exit(1)
  }
}

main().catch(function (err) {
  console.error(err)
  process.exit(1)
})