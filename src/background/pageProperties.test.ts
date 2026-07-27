import { describe, expect, it } from "vitest";
import { buildPageProperties } from "./pageProperties";
import type { ExtractedDocument } from "../shared/types";

const doc: ExtractedDocument = {
  docToken: "TOKEN123",
  title: "我的文档",
  url: "https://x.feishu.cn/docx/TOKEN123",
  nodes: [],
  images: [],
  attachments: [],
};

describe("buildPageProperties", () => {
  it("fills in title/url/doc-token/saved-at using the given title property name", () => {
    const properties = buildPageProperties("Name", doc, "2026-07-18T00:00:00.000Z");
    expect(properties).toMatchObject({
      Name: { title: [{ type: "text", text: { content: "我的文档" } }] },
      "Feishu URL": { url: "https://x.feishu.cn/docx/TOKEN123" },
      "飞书文档 Token": { rich_text: [{ type: "text", text: { content: "TOKEN123" } }] },
      保存时间: { date: { start: "2026-07-18T00:00:00.000Z" } },
    });
  });

  it("attaches the zip's file_upload id when one is given", () => {
    const properties = buildPageProperties("Name", doc, "2026-07-18T00:00:00.000Z", "upload-zip-1");
    expect(properties.附件).toEqual({
      files: [{ type: "file_upload", file_upload: { id: "upload-zip-1" }, name: "附件.zip" }],
    });
  });

  it("explicitly clears the attachments property when there is no zip, instead of leaving it untouched", () => {
    const properties = buildPageProperties("Name", doc, "2026-07-18T00:00:00.000Z");
    expect(properties.附件).toEqual({ files: [] });
  });
});
