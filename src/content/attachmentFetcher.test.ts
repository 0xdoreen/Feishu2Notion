import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAttachmentAssets } from "./attachmentFetcher";
import type { IRNode } from "../shared/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFileResponse(contentType: string, bytes: Uint8Array) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => bytes.buffer,
  };
}

describe("resolveAttachmentAssets", () => {
  it("only fetches attachment-type IR nodes, skipping everything else", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFileResponse("application/zip", new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetchMock);

    const nodes: IRNode[] = [
      { type: "paragraph", text: [{ text: "hi" }] },
      { type: "attachment", fileToken: "TOKEN123", filename: "工具源码.zip" },
      { type: "divider" },
    ];
    const assets = await resolveAttachmentAssets(nodes);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      assetId: "TOKEN123",
      filename: "工具源码.zip",
      mimeType: "application/zip",
    });
  });

  it("builds the download URL from the file token with the verified endpoint shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFileResponse("application/zip", new Uint8Array([1])));
    vi.stubGlobal("fetch", fetchMock);

    await resolveAttachmentAssets([{ type: "attachment", fileToken: "RYxibL5Oxod63DxcahSc0mZPnLh", filename: "a.zip" }]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/all/RYxibL5Oxod63DxcahSc0mZPnLh/?mount_node_token=RYxibL5Oxod63DxcahSc0mZPnLh&mount_point=docx_file",
    );
    expect(init).toEqual({ credentials: "include" });
  });

  it("throws with the failing filename when a download returns a non-2xx status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveAttachmentAssets([{ type: "attachment", fileToken: "gone", filename: "missing.zip" }]),
    ).rejects.toThrow(/missing\.zip/);
  });
});
