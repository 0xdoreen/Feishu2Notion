/** 插件本地保存的配置 */
export interface ExtensionConfig {
  notionToken: string | null;
  databaseId: string | null;
}

/** 中间表示 (IR)：飞书块结构解析后的统一格式，与飞书/Notion 具体 API 解耦 */
export type IRNode =
  | { type: "heading"; level: 1 | 2 | 3; text: RichText[] }
  | { type: "paragraph"; text: RichText[] }
  | { type: "bulleted_list_item"; text: RichText[] }
  | { type: "numbered_list_item"; text: RichText[] }
  | { type: "code"; language: string; text: string }
  | { type: "quote"; text: RichText[] }
  | { type: "divider" }
  | { type: "table"; rows: RichText[][][] }
  | { type: "image"; assetId: string; caption?: string }
  | { type: "attachment"; fileToken: string; filename: string }
  | { type: "unsupported"; originalType: string; fallbackText: string };

export interface RichText {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  link?: string;
}

/** 抓取到的一篇飞书文档 */
export interface ExtractedDocument {
  docToken: string;
  title: string;
  url: string;
  nodes: IRNode[];
  images: FetchedAsset[];
  attachments: FetchedAsset[];
}

export interface FetchedAsset {
  assetId: string;
  filename: string;
  mimeType: string;
  /** background 侧用 ArrayBuffer 更方便序列化传输 */
  data: ArrayBuffer;
}

/** content script <-> background 之间的消息协议。chrome.runtime 消息走结构化克隆，
 * ArrayBuffer 可以直接传，不需要先转成 number[] 再拼回去。 */
export type ExtensionMessage =
  | { kind: "EXTRACT_CURRENT_DOC" }
  | { kind: "CHECK_EXISTING_DOC"; docToken: string }
  | { kind: "SAVE_TO_NOTION"; document: ExtractedDocument; mode: "create" | "update"; existingPageId?: string };

export interface CheckExistingDocResult {
  ok: true;
  existing: boolean;
  pageId?: string;
  title?: string;
}

export interface SaveToNotionResult {
  ok: true;
  pageId: string;
}

export interface ErrorResult {
  ok: false;
  error: string;
}
