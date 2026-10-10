// 持久存储层（第一波仅 localStorage 作为存储源）：
//   md-writer:content —— markdown 源内容（纯字符串）
//   md-writer:state  —— 视图状态 JSON（源码态 / 目录 / 韵律网格）
// 读写全部 try/catch：隐私模式、配额超限、JSON 损坏一律静默降级为「无存储」，
// 存储不可用不影响编辑器本身的功能。

export type StorageBackend = "localStorage"

export interface MDWriterViewState {
  sourceMode: boolean;
  showToc: boolean;
  showRhythmGrid: boolean;
}

export var STORAGE_CONTENT_KEY = "md-writer:content"
export var STORAGE_STATE_KEY = "md-writer:state"

// 读取存储的 markdown 源内容；无存储 / 异常返回 null（空字符串是合法存储值）
export function readStoredContent(backend: StorageBackend): string | null {
  try {
    var raw = window.localStorage.getItem(STORAGE_CONTENT_KEY)
    return typeof raw === "string" ? raw : null
  } catch (error) {
    return null
  }
}

export function writeStoredContent(backend: StorageBackend, markdown: string): void {
  try {
    window.localStorage.setItem(STORAGE_CONTENT_KEY, markdown)
  } catch (error) {
    // 配额超限 / 隐私模式：放弃本次写入
  }
}

// 读取存储的视图状态；无存储 / JSON 损坏 / 非对象返回 null
export function readStoredState(backend: StorageBackend): Partial<MDWriterViewState> | null {
  try {
    var raw = window.localStorage.getItem(STORAGE_STATE_KEY)
    if (typeof raw !== "string" || raw === "") {
      return null
    }
    var parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") {
      return null
    }
    return parsed as Partial<MDWriterViewState>
  } catch (error) {
    return null
  }
}

export function writeStoredState(backend: StorageBackend, state: MDWriterViewState): void {
  try {
    window.localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify(state))
  } catch (error) {
    // 写入失败不影响编辑器功能
  }
}