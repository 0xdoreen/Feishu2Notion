import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NotionApiError,
  appendChildren,
  archivePage,
  createDatabase,
  createPageWithChildren,
  ensureRequiredProperties,
  findPageByDocToken,
  findTitlePropertyName,
  getDatabaseSchema,
  listDatabases,
  listSavedEntries,
  replacePageChildren,
  testConnection,
  updatePageProperties,
  uploadFile,
  uploadLargeFile,
} from "./notionClient";
import type { NotionBlock } from "./irToNotionBlocks";

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("testConnection", () => {
  it("returns the bot name on success", async () => {
    mockFetchOnce(200, { name: "My Integration" });
    const result = await testConnection("secret_token");
    expect(result).toEqual({ botName: "My Integration" });
  });

  it("throws NotionApiError with the API message on failure", async () => {
    mockFetchOnce(401, { message: "API token is invalid." });
    await expect(testConnection("bad_token")).rejects.toThrow(NotionApiError);
    await expect(testConnection("bad_token")).rejects.toThrow("API token is invalid.");
  });
});

describe("listDatabases", () => {
  it("maps search results to id/title pairs", async () => {
    const fetchMock = mockFetchOnce(200, {
      results: [
        { id: "db-1", title: [{ plain_text: "我的" }, { plain_text: "文档库" }] },
        { id: "db-2", title: [] },
      ],
    });
    const databases = await listDatabases("secret_token");
    expect(databases).toEqual([
      { id: "db-1", title: "我的文档库" },
      { id: "db-2", title: "(未命名)" },
    ]);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(requestInit.body as string)).toEqual({
      filter: { property: "object", value: "database" },
      page_size: 100,
    });
  });
});

describe("createDatabase", () => {
  it("sends the parent page id and title in the request body", async () => {
    const fetchMock = mockFetchOnce(200, { id: "new-db", title: [{ plain_text: "新库" }] });
    const result = await createDatabase("secret_token", "parent-page-id", "新库");
    expect(result).toEqual({ id: "new-db", title: "新库" });
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.parent).toEqual({ type: "page_id", page_id: "parent-page-id" });
    expect(body.title[0].text.content).toBe("新库");
  });
});

describe("ensureRequiredProperties", () => {
  it("does not send a PATCH when all required properties already exist", async () => {
    const fetchMock = mockFetchOnce(200, {
      id: "db-1",
      properties: {
        Name: { type: "title" },
        "Feishu URL": { type: "url" },
        "飞书文档 Token": { type: "rich_text" },
        保存时间: { type: "date" },
        附件: { type: "files" },
      },
    });
    await ensureRequiredProperties("secret_token", "db-1");
    expect(fetchMock).toHaveBeenCalledTimes(1); // 只有 GET schema，没有 PATCH
  });

  it("PATCHes only the missing properties", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "db-1", properties: { Name: { type: "title" } } }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "db-1" }) });
    vi.stubGlobal("fetch", fetchMock);

    await ensureRequiredProperties("secret_token", "db-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(patchInit.method).toBe("PATCH");
    const body = JSON.parse(patchInit.body as string);
    expect(Object.keys(body.properties).sort()).toEqual(
      ["Feishu URL", "保存时间", "附件", "飞书文档 Token"].sort(),
    );
  });
});

describe("findTitlePropertyName", () => {
  it("finds the property whose type is title", async () => {
    mockFetchOnce(200, {
      id: "db-1",
      properties: { 标题: { type: "title" }, 附件: { type: "files" } },
    });
    const schema = await getDatabaseSchema("secret_token", "db-1");
    expect(findTitlePropertyName(schema)).toBe("标题");
  });

  it("throws if no title property exists", () => {
    expect(() => findTitlePropertyName({ id: "db-1", properties: { 附件: { type: "files" } } })).toThrow(
      NotionApiError,
    );
  });
});

describe("uploadFile", () => {
  it("creates the file upload then sends the bytes as multipart form data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "upload-1" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const bytes = new TextEncoder().encode("hello").buffer;
    const result = await uploadFile("secret_token", "a.png", "image/png", bytes);

    expect(result).toEqual({ fileUploadId: "upload-1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [createUrl, createInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(createUrl).toBe("https://api.notion.com/v1/file_uploads");
    expect(JSON.parse(createInit.body as string)).toEqual({ filename: "a.png", content_type: "image/png" });

    const [sendUrl, sendInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(sendUrl).toBe("https://api.notion.com/v1/file_uploads/upload-1/send");
    expect(sendInit.body).toBeInstanceOf(FormData);
    expect((sendInit.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("refuses files over the single-part limit without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const oversized = new ArrayBuffer(21 * 1024 * 1024);
    await expect(uploadFile("secret_token", "big.zip", "application/zip", oversized)).rejects.toThrow(
      NotionApiError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("uploadLargeFile", () => {
  it("delegates to the single-part path when the file is within the 20 MiB limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "upload-small" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const bytes = new TextEncoder().encode("small file").buffer;
    const result = await uploadLargeFile("secret_token", "small.txt", "text/plain", bytes);

    expect(result).toEqual({ fileUploadId: "upload-small" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, createInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(createInit.body as string)).not.toHaveProperty("mode");
  });

  it("splits files over 20 MiB into multi-part uploads and completes them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "upload-big" }) }) // create
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // part 1
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // part 2
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }); // complete
    vi.stubGlobal("fetch", fetchMock);

    const totalSize = 25 * 1024 * 1024; // 20 MiB + 5 MiB → 2 parts
    const bytes = new ArrayBuffer(totalSize);
    const result = await uploadLargeFile("secret_token", "big.zip", "application/zip", bytes);

    expect(result).toEqual({ fileUploadId: "upload-big" });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const [createUrl, createInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(createUrl).toBe("https://api.notion.com/v1/file_uploads");
    expect(JSON.parse(createInit.body as string)).toEqual({
      mode: "multi_part",
      filename: "big.zip",
      content_type: "application/zip",
      number_of_parts: 2,
    });

    const [part1Url, part1Init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(part1Url).toBe("https://api.notion.com/v1/file_uploads/upload-big/send");
    const part1Form = part1Init.body as FormData;
    expect(part1Form.get("part_number")).toBe("1");

    const [part2Url, part2Init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(part2Url).toBe("https://api.notion.com/v1/file_uploads/upload-big/send");
    const part2Form = part2Init.body as FormData;
    expect(part2Form.get("part_number")).toBe("2");

    const [completeUrl] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(completeUrl).toBe("https://api.notion.com/v1/file_uploads/upload-big/complete");
  });

  it("surfaces the Notion error message instead of silently failing when a part upload is rejected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "upload-fail" }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: "part_number does not match" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const bytes = new ArrayBuffer(25 * 1024 * 1024);
    await expect(uploadLargeFile("secret_token", "big.zip", "application/zip", bytes)).rejects.toThrow(
      "part_number does not match",
    );
  });
});

const paragraphBlock = (label: string): NotionBlock => ({
  object: "block",
  type: "paragraph",
  paragraph: { rich_text: [{ type: "text", text: { content: label } }] },
});

describe("findPageByDocToken", () => {
  it("returns null when no page matches the doc token", async () => {
    mockFetchOnce(200, { results: [] });
    expect(await findPageByDocToken("secret_token", "db-1", "TOKEN")).toBeNull();
  });

  it("filters by the 飞书文档 Token property and extracts the title from the matching page", async () => {
    const fetchMock = mockFetchOnce(200, {
      results: [
        {
          id: "page-1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "已保存的文档" }] },
            附件: { type: "files" },
          },
        },
      ],
    });
    const result = await findPageByDocToken("secret_token", "db-1", "TOKEN123");
    expect(result).toEqual({ pageId: "page-1", title: "已保存的文档" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.notion.com/v1/databases/db-1/query");
    expect(JSON.parse(init.body as string)).toEqual({
      filter: { property: "飞书文档 Token", rich_text: { equals: "TOKEN123" } },
      page_size: 1,
    });
  });
});

describe("appendChildren", () => {
  it("sends everything in one request when there are 100 or fewer children", async () => {
    const fetchMock = mockFetchOnce(200, {});
    const children = Array.from({ length: 100 }, (_, i) => paragraphBlock(String(i)));
    await appendChildren("secret_token", "block-1", children);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.notion.com/v1/blocks/block-1/children");
    expect(JSON.parse(init.body as string).children).toHaveLength(100);
  });

  it("splits into batches of 100 when there are more children than that", async () => {
    const fetchMock = mockFetchOnce(200, {});
    const children = Array.from({ length: 130 }, (_, i) => paragraphBlock(String(i)));
    await appendChildren("secret_token", "block-1", children);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBatch = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).children;
    const secondBatch = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).children;
    expect(firstBatch).toHaveLength(100);
    expect(secondBatch).toHaveLength(30);
  });

  it("makes no request at all for an empty children array", async () => {
    const fetchMock = mockFetchOnce(200, {});
    await appendChildren("secret_token", "block-1", []);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createPageWithChildren", () => {
  it("creates the page with all children in one request when 100 or fewer", async () => {
    const fetchMock = mockFetchOnce(200, { id: "page-new" });
    const children = [paragraphBlock("only one")];
    const result = await createPageWithChildren("secret_token", "db-1", { Name: {} }, children);

    expect(result).toEqual({ pageId: "page-new" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.notion.com/v1/pages");
    const body = JSON.parse(init.body as string);
    expect(body.parent).toEqual({ database_id: "db-1" });
    expect(body.children).toHaveLength(1);
  });

  it("creates the page with the first 100 children then appends the rest", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "page-new" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const children = Array.from({ length: 120 }, (_, i) => paragraphBlock(String(i)));
    const result = await createPageWithChildren("secret_token", "db-1", { Name: {} }, children);

    expect(result).toEqual({ pageId: "page-new" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const createBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(createBody.children).toHaveLength(100);
    const [appendUrl, appendInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(appendUrl).toBe("https://api.notion.com/v1/blocks/page-new/children");
    expect(JSON.parse(appendInit.body as string).children).toHaveLength(20);
  });
});

describe("updatePageProperties", () => {
  it("PATCHes the page with exactly the given properties", async () => {
    const fetchMock = mockFetchOnce(200, {});
    await updatePageProperties("secret_token", "page-1", { Name: { title: [] } });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.notion.com/v1/pages/page-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ properties: { Name: { title: [] } } });
  });
});

describe("replacePageChildren", () => {
  it("pages through existing children, deletes every one of them, then appends the new set", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [{ id: "b1" }, { id: "b2" }], has_more: true, next_cursor: "c2" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [{ id: "b3" }], has_more: false, next_cursor: null }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // delete b1
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // delete b2
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // delete b3
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }); // append new children
    vi.stubGlobal("fetch", fetchMock);

    await replacePageChildren("secret_token", "page-1", [paragraphBlock("new content")]);

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const [page1Url] = fetchMock.mock.calls[0] as [string];
    expect(page1Url).toBe("https://api.notion.com/v1/blocks/page-1/children?page_size=100");
    const [page2Url] = fetchMock.mock.calls[1] as [string];
    expect(page2Url).toBe("https://api.notion.com/v1/blocks/page-1/children?page_size=100&start_cursor=c2");

    const deleteCalls = fetchMock.mock.calls.slice(2, 5) as Array<[string, RequestInit]>;
    expect(deleteCalls.map(([url]) => url)).toEqual([
      "https://api.notion.com/v1/blocks/b1",
      "https://api.notion.com/v1/blocks/b2",
      "https://api.notion.com/v1/blocks/b3",
    ]);
    expect(deleteCalls.every(([, init]) => init.method === "DELETE")).toBe(true);

    const [appendUrl, appendInit] = fetchMock.mock.calls[5] as [string, RequestInit];
    expect(appendUrl).toBe("https://api.notion.com/v1/blocks/page-1/children");
    expect(JSON.parse(appendInit.body as string).children).toHaveLength(1);
  });

  it("deletes nothing and just appends when the page has no existing children", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [], has_more: false, next_cursor: null }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await replacePageChildren("secret_token", "page-1", [paragraphBlock("first content")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("listSavedEntries", () => {
  it("filters by a non-empty 飞书文档 Token property and maps title/url/savedAt", async () => {
    const fetchMock = mockFetchOnce(200, {
      results: [
        {
          id: "page-1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "文档一" }] },
            "Feishu URL": { type: "url", url: "https://x.feishu.cn/docx/1" },
            保存时间: { type: "date", date: { start: "2026-07-18T00:00:00.000Z" } },
          },
        },
      ],
    });
    const entries = await listSavedEntries("secret_token", "db-1");
    expect(entries).toEqual([
      { pageId: "page-1", title: "文档一", url: "https://x.feishu.cn/docx/1", savedAt: "2026-07-18T00:00:00.000Z" },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.notion.com/v1/databases/db-1/query");
    expect(JSON.parse(init.body as string)).toEqual({
      filter: { property: "飞书文档 Token", rich_text: { is_not_empty: true } },
      sorts: [{ property: "保存时间", direction: "descending" }],
      page_size: 100,
    });
  });

  it("returns null-ish fallbacks when url/date properties are missing", async () => {
    mockFetchOnce(200, {
      results: [{ id: "page-1", properties: { Name: { type: "title", title: [] } } }],
    });
    const entries = await listSavedEntries("secret_token", "db-1");
    expect(entries).toEqual([{ pageId: "page-1", title: "(未命名)", url: "", savedAt: null }]);
  });
});

describe("archivePage", () => {
  it("PATCHes the page with archived: true", async () => {
    const fetchMock = mockFetchOnce(200, {});
    await archivePage("secret_token", "page-1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.notion.com/v1/pages/page-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ archived: true });
  });
});
