// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parseBlockElement, parseRichText } from "./blockParser";

function elFromHtml(html: string): Element {
  const container = document.createElement("div");
  container.innerHTML = html;
  const el = container.firstElementChild;
  if (!el) throw new Error("test fixture produced no element");
  return el;
}

describe("parseBlockElement", () => {
  it("parses heading1/2/3 with plain text", () => {
    const el = elFromHtml('<div data-block-type="heading2">生财总文档</div>');
    expect(parseBlockElement(el)).toEqual({
      type: "heading",
      level: 2,
      text: [{ text: "生财总文档" }],
    });
  });

  it("parses a quote block", () => {
    const el = elFromHtml('<div data-block-type="quote">重点提示</div>');
    expect(parseBlockElement(el)).toEqual({ type: "quote", text: [{ text: "重点提示" }] });
  });

  it("parses a divider block with no text", () => {
    const el = elFromHtml('<div data-block-type="divider"></div>');
    expect(parseBlockElement(el)).toEqual({ type: "divider" });
  });

  it("parses bullet and ordered list items", () => {
    const bullet = elFromHtml('<div data-block-type="bullet">第一条</div>');
    const ordered = elFromHtml('<div data-block-type="ordered">第一步</div>');
    expect(parseBlockElement(bullet)).toEqual({
      type: "bulleted_list_item",
      text: [{ text: "第一条" }],
    });
    expect(parseBlockElement(ordered)).toEqual({
      type: "numbered_list_item",
      text: [{ text: "第一步" }],
    });
  });

  it("parses a code block, preferring the data-language attribute", () => {
    const el = elFromHtml('<div data-block-type="code" data-language="python">print(1)</div>');
    expect(parseBlockElement(el)).toEqual({
      type: "code",
      language: "python",
      text: "print(1)",
    });
  });

  it("defaults code language to plaintext when missing", () => {
    const el = elFromHtml('<div data-block-type="code">echo hi</div>');
    expect(parseBlockElement(el)).toEqual({
      type: "code",
      language: "plaintext",
      text: "echo hi",
    });
  });

  it("parses an image block by reading the <img> src", () => {
    const el = elFromHtml('<div data-block-type="image"><img src="https://example.com/a.png" /></div>');
    expect(parseBlockElement(el)).toEqual({ type: "image", assetId: "https://example.com/a.png" });
  });

  it("falls back to unsupported when an image block has no <img>", () => {
    const el = elFromHtml('<div data-block-type="image"></div>');
    expect(parseBlockElement(el)).toEqual({
      type: "unsupported",
      originalType: "image",
      fallbackText: "[图片，未能取到地址]",
    });
  });

  it("parses a file (attachment) block by reading data-record-id and .file-name", () => {
    const el = elFromHtml(
      '<div data-block-type="file" data-record-id="POhrdg21yoPDFMxy0T0c24GCnGh"><div class="file-name">B站拆视频工具.exe</div><div>28.16MB</div></div>',
    );
    expect(parseBlockElement(el)).toEqual({
      type: "attachment",
      fileToken: "POhrdg21yoPDFMxy0T0c24GCnGh",
      filename: "B站拆视频工具.exe",
    });
  });

  it("falls back to unsupported when a file block is missing the record id or filename", () => {
    const el = elFromHtml('<div data-block-type="file"></div>');
    expect(parseBlockElement(el)).toEqual({
      type: "unsupported",
      originalType: "file",
      fallbackText: "[附件，未能取到文件信息]",
    });
  });

  it("parses a simple table into rows of rich text cells", () => {
    const el = elFromHtml(
      '<table data-block-type="table"><tr><td>A1</td><td>B1</td></tr><tr><td>A2</td><td>B2</td></tr></table>',
    );
    expect(parseBlockElement(el)).toEqual({
      type: "table",
      rows: [
        [[{ text: "A1" }], [{ text: "B1" }]],
        [[{ text: "A2" }], [{ text: "B2" }]],
      ],
    });
  });

  it("falls back to unsupported with the raw type and text for anything unrecognized", () => {
    const el = elFromHtml('<div data-block-type="mind_note">未知块内容</div>');
    expect(parseBlockElement(el)).toEqual({
      type: "unsupported",
      originalType: "mind_note",
      fallbackText: "未知块内容",
    });
  });
});

describe("parseRichText", () => {
  it("marks bold/italic/strikethrough/code/link and merges adjacent identical runs", () => {
    const el = elFromHtml(
      '<div>普通<strong>加粗</strong><em>斜体</em><s>删除线</s><code>code</code><a href="https://x.com">链接</a></div>',
    );
    expect(parseRichText(el)).toEqual([
      { text: "普通" },
      { text: "加粗", bold: true },
      { text: "斜体", italic: true },
      { text: "删除线", strikethrough: true },
      { text: "code", code: true },
      { text: "链接", link: "https://x.com" },
    ]);
  });

  it("combines nested marks, e.g. bold inside a link", () => {
    const el = elFromHtml('<div><a href="https://x.com">前<strong>粗体链接</strong>后</a></div>');
    expect(parseRichText(el)).toEqual([
      { text: "前", link: "https://x.com" },
      { text: "粗体链接", link: "https://x.com", bold: true },
      { text: "后", link: "https://x.com" },
    ]);
  });

  it("merges two adjacent plain-text nodes into one run", () => {
    const el = elFromHtml("<div>第一段<!-- comment -->第二段</div>");
    expect(parseRichText(el)).toEqual([{ text: "第一段第二段" }]);
  });
});
