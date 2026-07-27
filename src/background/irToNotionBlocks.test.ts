import { describe, expect, it } from "vitest";
import { irNodesToNotionBlocks, type ImageResolver } from "./irToNotionBlocks";
import type { IRNode } from "../shared/types";

const noImages: ImageResolver = () => undefined;

describe("irNodesToNotionBlocks", () => {
  it("converts headings to heading_1/2/3 blocks", () => {
    const nodes: IRNode[] = [
      { type: "heading", level: 1, text: [{ text: "标题一" }] },
      { type: "heading", level: 2, text: [{ text: "标题二" }] },
      { type: "heading", level: 3, text: [{ text: "标题三" }] },
    ];
    const blocks = irNodesToNotionBlocks(nodes, noImages);
    expect(blocks[0]).toMatchObject({ type: "heading_1", heading_1: { rich_text: [{ text: { content: "标题一" } }] } });
    expect(blocks[1].type).toBe("heading_2");
    expect(blocks[2].type).toBe("heading_3");
  });

  it("carries bold/italic/strikethrough/code/link marks into annotations and link", () => {
    const nodes: IRNode[] = [
      {
        type: "paragraph",
        text: [
          { text: "普通" },
          { text: "粗体", bold: true },
          { text: "链接", link: "https://example.com" },
        ],
      },
    ];
    const [block] = irNodesToNotionBlocks(nodes, noImages);
    const richText = (block as unknown as { paragraph: { rich_text: unknown[] } }).paragraph.rich_text;
    expect(richText).toEqual([
      { type: "text", text: { content: "普通" }, annotations: { bold: undefined, italic: undefined, strikethrough: undefined, code: undefined } },
      { type: "text", text: { content: "粗体" }, annotations: { bold: true, italic: undefined, strikethrough: undefined, code: undefined } },
      {
        type: "text",
        text: { content: "链接", link: { url: "https://example.com" } },
        annotations: { bold: undefined, italic: undefined, strikethrough: undefined, code: undefined },
      },
    ]);
  });

  it("maps known code languages and falls back to plain text for unknown ones", () => {
    const nodes: IRNode[] = [
      { type: "code", language: "python", text: "print(1)" },
      { type: "code", language: "some_weird_lang", text: "??" },
    ];
    const blocks = irNodesToNotionBlocks(nodes, noImages);
    expect((blocks[0] as unknown as { code: { language: string } }).code.language).toBe("python");
    expect((blocks[1] as unknown as { code: { language: string } }).code.language).toBe("plain text");
  });

  it("converts a divider with no payload", () => {
    const blocks = irNodesToNotionBlocks([{ type: "divider" }], noImages);
    expect(blocks[0]).toEqual({ object: "block", type: "divider", divider: {} });
  });

  it("builds a table block with table_row children matching the IR rows", () => {
    const nodes: IRNode[] = [
      {
        type: "table",
        rows: [
          [[{ text: "A1" }], [{ text: "B1" }]],
          [[{ text: "A2" }], [{ text: "B2" }]],
        ],
      },
    ];
    const [block] = irNodesToNotionBlocks(nodes, noImages);
    const table = (block as unknown as { table: { table_width: number; children: unknown[] } }).table;
    expect(table.table_width).toBe(2);
    expect(table.children).toHaveLength(2);
  });

  it("attaches the resolved file_upload id for an image node", () => {
    const resolve: ImageResolver = (assetId) =>
      assetId === "https://feishu.cn/img/1" ? { fileUploadId: "upload-123" } : undefined;
    const [block] = irNodesToNotionBlocks([{ type: "image", assetId: "https://feishu.cn/img/1" }], resolve);
    expect(block).toEqual({
      object: "block",
      type: "image",
      image: { type: "file_upload", file_upload: { id: "upload-123" } },
    });
  });

  it("falls back to a visible text note when an image failed to resolve, instead of dropping it", () => {
    const [block] = irNodesToNotionBlocks([{ type: "image", assetId: "https://feishu.cn/img/2" }], noImages);
    expect(block.type).toBe("paragraph");
    const text = (block as unknown as { paragraph: { rich_text: Array<{ text: { content: string } }> } }).paragraph
      .rich_text[0].text.content;
    expect(text).toContain("https://feishu.cn/img/2");
  });

  it("keeps unsupported block content visible as a paragraph instead of silently dropping it", () => {
    const [block] = irNodesToNotionBlocks(
      [{ type: "unsupported", originalType: "mind_note", fallbackText: "思维笔记内容" }],
      noImages,
    );
    expect(block.type).toBe("paragraph");
    const text = (block as unknown as { paragraph: { rich_text: Array<{ text: { content: string } }> } }).paragraph
      .rich_text[0].text.content;
    expect(text).toContain("mind_note");
    expect(text).toContain("思维笔记内容");
  });

  it("excludes attachment nodes from the body blocks entirely (they're handled by the zip pipeline)", () => {
    const nodes: IRNode[] = [
      { type: "paragraph", text: [{ text: "前面的段落" }] },
      { type: "attachment", fileToken: "TOKEN", filename: "工具.zip" },
      { type: "paragraph", text: [{ text: "后面的段落" }] },
    ];
    const blocks = irNodesToNotionBlocks(nodes, noImages);
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.type === "paragraph")).toBe(true);
  });

  it("chunks a rich text run longer than 2000 characters into multiple text objects", () => {
    const longText = "a".repeat(4500);
    const [block] = irNodesToNotionBlocks([{ type: "paragraph", text: [{ text: longText }] }], noImages);
    const richText = (block as unknown as { paragraph: { rich_text: Array<{ text: { content: string } }> } }).paragraph
      .rich_text;
    expect(richText).toHaveLength(3);
    expect(richText.map((r) => r.text.content.length)).toEqual([2000, 2000, 500]);
  });
});
