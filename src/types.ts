import { Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Node as PMNode } from "prosemirror-model";

export type ElementTarget = string | Element | null | undefined;
export type ImageUploadResult =
  | string
  | {
  src?: string;
  url?: string;
  alt?: string | null;
  title?: string | null;
};

export interface MDWriterInitOptions {
  mount: ElementTarget;
  initialMarkdown?: string;
  placeholder?: string;
  onChange?: (markdown: string) => void;
  formatBarRoot?: ElementTarget;
  viewBarRoot?: ElementTarget;
  tocRoot?: ElementTarget;
  tocMaxDepth?: number;
  // 初始是否展开目录面板（默认 false）
  defaultShowTOC?: boolean;
  // 初始是否显示垂直韵律网格（默认 false）
  defaultShowRhythmGrid?: boolean;
  rawPreview?: boolean;
  mermaidAssets?: string[];
  katexAssets?: string[];
  onImageUpload?: (file: File) => Promise<ImageUploadResult> | ImageUploadResult;
}

export interface MDWriterInstance {
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  focus: () => void;
  refreshMermaidPreviews: () => void;
  destroy: () => void;
}

export type EditorDispatch = ((tr: Transaction) => void) | undefined;
export type EditorCommand = (state: import("prosemirror-state").EditorState, dispatch?: EditorDispatch, view?: EditorView) => boolean;
// Action = 产品交互编排（打开 Dialog、等待 Promise），完成后调用纯 Command；允许异步
export type EditorAction = (view: EditorView) => void;

export interface MermaidRenderResult {
  svg: string;
  bindFunctions?: (element: HTMLElement) => void;
}

export interface MermaidRuntime {
  initialize: (opts: { startOnLoad: boolean; securityLevel: string }) => void;
  render: (id: string, source: string) => Promise<MermaidRenderResult> | MermaidRenderResult;
}

export interface SvgPanZoomInstance {
  resize?: () => void;
  fit?: () => void;
  center?: () => void;
  resetZoom?: () => void;
  resetPan?: () => void;
  zoomAtPointBy?: (scale: number, point: { x: number; y: number }) => void;
  destroy?: () => void;
}

export interface CommandButtonConfig {
  name: string;
  code: string;
  svg: string;
  shortcut?: string;
  visibleWhen?: "table";
  disabled?: boolean;
}

export interface ViewButtonConfig {
  name: string;
  code: string;
  svg: string;
  shortcut?: string;
}

export type AssetPromiseMap = Partial<Record<string, Promise<void>>>;
export type RawBlockSegment = { kind: "markdown" | "raw_block"; text: string };
export type RawInlineSegment = { kind: "text" | "raw_inline"; text: string };
export type RawInlinePlaceholder = { token: string; raw: string };
export type JSONMark = { type: string; attrs?: Record<string, unknown> };
export type JSONNodeData = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: JSONMark[];
  content?: JSONNodeData[];
  [key: string]: any;
};
export type TableSectionType = string;
export type TableRowMeta = { rowNode: PMNode; sectionType: TableSectionType; rowIndexInSection: number; startOffset: number };
export type TableRowJSONMeta = { row: JSONNodeData; sectionType: TableSectionType; rowIndexInSection: number };
export type TableSections = { headRows: JSONNodeData[]; bodyRows: JSONNodeData[] };
export type TableContext = {
  tableNode: PMNode;
  tablePos: number;
  cellDepth: number;
  rowIndex: number;
  rowIndexInSection: number;
  sectionType: TableSectionType;
  colIndex: number;
};
export type TableMutationResult = { ok: boolean; targetRow?: number; targetCol?: number };
export type TableMutation = (tableJSON: JSONNodeData, context: TableContext) => TableMutationResult;
export type LinkDialogResult = {
  action: "confirm" | "remove" | "cancel";
  href: string;
};

export type DialogAction = "confirm" | "cancel" | "remove";
export type DialogResult = { action: DialogAction; value: string };
export interface ManagedDialog {
  id: string;
  backdrop: HTMLElement;
}

export interface CommandRuntimeState {
  toggleSourceMode?: () => void;
  isSourceMode?: () => boolean;
  toggleToc?: () => void;
  isTocVisible?: () => boolean;
  toggleRhythm?: () => void;
  isRhythmVisible?: () => boolean;
}

declare global {
  interface Window {
    __swavesAssetLoadPromises?: AssetPromiseMap;
    mermaid: MermaidRuntime;
    svgPanZoom: (svg: SVGSVGElement, options?: Record<string, unknown>) => SvgPanZoomInstance;
    katex?: {
      render: (expression: string, element: HTMLElement, options?: Record<string, unknown>) => void;
    };
    DashAppUI?: {
      dialog?: {
        open: (dialogID: string, opener: Element | null) => boolean;
        close: (dialogID: string) => boolean;
      };
    };
  }
}