import { afterEach, describe, expect, it, vi } from "vitest";
import { checkExistingDoc, saveToNotion } from "./saveOrchestrator";
import type { ExtractedDocument } from "../shared/types";

function stubChromeStorage(config: { notionToken: string | null; databaseId: string | null }) {
  vi.stubGlobal("chrome", { storage: { local: { get: vi.fn().mockResolvedValue(config) } } });
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseDoc: ExtractedDocument = {
  docToken: "DOC1",
  title: "测试文档",
  url: "https://x.feishu.cn/docx/DOC1",
  nodes: [{ type: "paragraph", text: [{ text: "正文" }] }],
  images: [],
  attachments: [],
};

describe("checkExistingDoc", () => {
  it("returns a not-configured error when token/database are missing", async () => {
    stubChromeStorage({ notionToken: null, databaseId: null });
    const result = await checkExistingDoc("DOC1");
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("配置");
  });

  it("returns existing:false when no page matches the doc token", async () => {
    stubChromeStorage({ notionToken: "secret", databaseId: "db-1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { results: [] })));
    expect(await checkExistingDoc("DOC1")).toEqual({ ok: true, existing: false });
  });

  it("returns the existing page id/title when a match is found", async () => {
    stubChromeStorage({ notionToken: "secret", databaseId: "db-1" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          results: [{ id: "page-1", properties: { Name: { type: "title", title: [{ plain_text: "旧文档" }] } } }],
        }),
      ),
    );
    expect(await checkExistingDoc("DOC1")).toEqual({
      ok: true,
      existing: true,
      pageId: "page-1",
      title: "旧文档",
    });
  });

  it("turns an unexpected API failure into an error result instead of throwing", async () => {
    stubChromeStorage({ notionToken: "secret", databaseId: "db-1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { message: "API token is invalid." })));
    const result = await checkExistingDoc("DOC1");
    expect(result).toEqual({ ok: false, error: "API token is invalid." });
  });
});

describe("saveToNotion", () => {
  it("returns a not-configured error when token/database are missing", async () => {
    stubChromeStorage({ notionToken: null, databaseId: null });
    const result = await saveToNotion(baseDoc, "create");
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("配置");
  });

  it("creates a new page: fetches the schema for the title property, then POSTs /pages", async () => {
    stubChromeStorage({ notionToken: "secret", databaseId: "db-1" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "db-1", properties: { Name: { type: "title" } } }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "page-new" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveToNotion(baseDoc, "create");
    expect(result).toEqual({ ok: true, pageId: "page-new" });

    const [pagesUrl, pagesInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(pagesUrl).toBe("https://api.notion.com/v1/pages");
    const body = JSON.parse(pagesInit.body as string);
    expect(body.parent).toEqual({ database_id: "db-1" });
    expect(body.properties.Name.title[0].text.content).toBe("测试文档");
    expect(body.properties.附件).toEqual({ files: [] });
  });

  it("uploads each image and wires the resulting file_upload id into the image block", async () => {
    stubChromeStorage({ notionToken: "secret", databaseId: "db-1" });
    const docWithImage: ExtractedDocument = {
      ...baseDoc,
      nodes: [{ type: "image", assetId: "https://feishu.cn/img/1" }],
      images: [
        {
          assetId: "https://feishu.cn/img/1",
          filename: "a.png",
          mimeType: "image/png",
          data: new Uint8Array([1, 2, 3]).buffer,
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "upload-img-1" })) // create file_upload
      .mockResolvedValueOnce(jsonResponse(200, {})) // send bytes
      .mockResolvedValueOnce(jsonResponse(200, { id: "db-1", properties: { Name: { type: "title" } } })) // schema
      .mockResolvedValueOnce(jsonResponse(200, { id: "page-new" })); // create page
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveToNotion(docWithImage, "create");
    expect(result).toEqual({ ok: true, pageId: "page-new" });

    const pagesInit = fetchMock.mock.calls[3][1] as RequestInit;
    const body = JSON.parse(pagesInit.body as string);
    expect(body.children[0]).toEqual({
      object: "block",
      type: "image",
      image: { type: "file_upload", file_upload: { id: "upload-img-1" } },
    });
  });

  it("zips attachments, uploads the zip, and attaches its file_upload id to the 附件 property", async () => {
    stubChromeStorage({ notionToken: "secret", databaseId: "db-1" });
    const docWithAttachment: ExtractedDocument = {
      ...baseDoc,
      attachments: [
        {
          assetId: "TOKEN1",
          filename: "工具.zip",
          mimeType: "application/zip",
          data: new TextEncoder().encode("zip bytes").buffer,
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "upload-zip-1" })) // create file_upload for the zip
      .mockResolvedValueOnce(jsonResponse(200, {})) // send zip bytes
      .mockResolvedValueOnce(jsonResponse(200, { id: "db-1", properties: { Name: { type: "title" } } })) // schema
      .mockResolvedValueOnce(jsonResponse(200, { id: "page-new" })); // create page
    vi.stubGlobal("fetch", fetchMock);

    await saveToNotion(docWithAttachment, "create");

    const pagesInit = fetchMock.mock.calls[3][1] as RequestInit;
    const body = JSON.parse(pagesInit.body as string);
    expect(body.properties.附件.files[0].file_upload).toEqual({ id: "upload-zip-1" });
  });

  it("updates an existing page's properties and replaces its children when mode is update", async () => {
    stubChromeStorage({ notionToken: "secret", databaseId: "db-1" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "db-1", properties: { Name: { type: "title" } } })) // schema
      .mockResolvedValueOnce(jsonResponse(200, {})) // updatePageProperties PATCH
      .mockResolvedValueOnce(jsonResponse(200, { results: [], has_more: false, next_cursor: null })) // list children
      .mockResolvedValueOnce(jsonResponse(200, {})); // append new children
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveToNotion(baseDoc, "update", "existing-page-1");
    expect(result).toEqual({ ok: true, pageId: "existing-page-1" });

    const [updateUrl, updateInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(updateUrl).toBe("https://api.notion.com/v1/pages/existing-page-1");
    expect(updateInit.method).toBe("PATCH");
  });

  it("turns an upload failure into an error result instead of throwing out of the message handler", async () => {
    stubChromeStorage({ notionToken: "secret", databaseId: "db-1" });
    const docWithImage: ExtractedDocument = {
      ...baseDoc,
      nodes: [{ type: "image", assetId: "https://feishu.cn/img/1" }],
      images: [
        {
          assetId: "https://feishu.cn/img/1",
          filename: "a.png",
          mimeType: "image/png",
          data: new ArrayBuffer(21 * 1024 * 1024),
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn());

    const result = await saveToNotion(docWithImage, "create");
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("20 MiB");
  });
});
