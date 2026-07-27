import type { IRNode, RichText } from "../shared/types";

const MAX_RICH_TEXT_CHARS = 2000;

/** Notion 内容块对象的最小公共形状，具体 payload 字段用 unknown 收敛，调用方按 type 使用。 */
export interface NotionBlock {
  object: "block";
  type: string;
  [key: string]: unknown;
}

interface NotionRichTextObject {
  type: "text";
  text: { content: string; link?: { url: string } };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  };
}

/** 已经上传到 Notion 的图片，用 IR 里的 assetId（原始图片地址）去查它对应的 file_upload id。 */
export type ImageResolver = (assetId: string) => { fileUploadId: string } | undefined;

const CODE_LANGUAGE_MAP: Record<string, string> = {
  python: "python",
  javascript: "javascript",
  typescript: "typescript",
  java: "java",
  c: "c",
  cpp: "c++",
  "c++": "c++",
  csharp: "c#",
  "c#": "c#",
  go: "go",
  golang: "go",
  rust: "rust",
  ruby: "ruby",
  php: "php",
  sql: "sql",
  bash: "shell",
  shell: "shell",
  sh: "shell",
  json: "json",
  yaml: "yaml",
  html: "html",
  css: "css",
  markdown: "markdown",
  plaintext: "plain text",
};

function mapCodeLanguage(language: string): string {
  return CODE_LANGUAGE_MAP[language.toLowerCase()] ?? "plain text";
}

function chunkText(text: string, maxLen = MAX_RICH_TEXT_CHARS): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}

function richTextToNotion(runs: RichText[]): NotionRichTextObject[] {
  const result: NotionRichTextObject[] = [];
  for (const run of runs) {
    for (const chunk of chunkText(run.text)) {
      result.push({
        type: "text",
        text: { content: chunk, ...(run.link ? { link: { url: run.link } } : {}) },
        annotations: {
          bold: run.bold,
          italic: run.italic,
          strikethrough: run.strikethrough,
          code: run.code,
        },
      });
    }
  }
  // Notion 不接受空的 rich_text 数组用在必填场景，用一个空文本占位好过直接报错
  return result.length > 0 ? result : [{ type: "text", text: { content: "" } }];
}

function plainTextBlock(text: string): NotionBlock {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: richTextToNotion([{ text }]) },
  };
}

/**
 * 把插件内部的 IR 节点数组转换成可以直接传给 Notion `children` 的内容块数组。
 * attachment 节点不在这里处理——附件是打包成一个 zip 单独挂到条目上的（见附件管线），
 * 不会在正文里逐个渲染成块，所以先过滤掉，避免正文里重复出现"[无法转换的内容]"占位文字。
 */
export function irNodesToNotionBlocks(nodes: IRNode[], resolveImage: ImageResolver): NotionBlock[] {
  return nodes.filter((node) => node.type !== "attachment").map((node) => irNodeToNotionBlock(node, resolveImage));
}

function irNodeToNotionBlock(node: IRNode, resolveImage: ImageResolver): NotionBlock {
  switch (node.type) {
    case "heading": {
      const key = `heading_${node.level}` as const;
      return { object: "block", type: key, [key]: { rich_text: richTextToNotion(node.text) } };
    }
    case "paragraph":
      return { object: "block", type: "paragraph", paragraph: { rich_text: richTextToNotion(node.text) } };
    case "bulleted_list_item":
      return {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richTextToNotion(node.text) },
      };
    case "numbered_list_item":
      return {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: richTextToNotion(node.text) },
      };
    case "quote":
      return { object: "block", type: "quote", quote: { rich_text: richTextToNotion(node.text) } };
    case "divider":
      return { object: "block", type: "divider", divider: {} };
    case "code":
      return {
        object: "block",
        type: "code",
        code: {
          rich_text: richTextToNotion([{ text: node.text }]),
          language: mapCodeLanguage(node.language),
        },
      };
    case "table": {
      const columnCount = Math.max(1, ...node.rows.map((row) => row.length));
      return {
        object: "block",
        type: "table",
        table: {
          table_width: columnCount,
          has_column_header: false,
          has_row_header: false,
          children: node.rows.map((row) => ({
            object: "block",
            type: "table_row",
            table_row: { cells: row.map((cell) => richTextToNotion(cell)) },
          })),
        },
      };
    }
    case "image": {
      const resolved = resolveImage(node.assetId);
      if (!resolved) {
        return plainTextBlock(`[图片未能上传成功，原文档中的图片地址: ${node.assetId}]`);
      }
      return {
        object: "block",
        type: "image",
        image: { type: "file_upload", file_upload: { id: resolved.fileUploadId } },
      };
    }
    case "attachment":
      // irNodesToNotionBlocks 已经把 attachment 过滤掉了，正常不会走到这里。
      throw new Error("attachment 节点不应该被传给 irNodeToNotionBlock，应该在附件管线里单独处理");
    case "unsupported":
      return plainTextBlock(`[无法转换的内容 (${node.originalType})] ${node.fallbackText}`);
  }
}
