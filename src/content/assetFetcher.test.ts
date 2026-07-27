import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveImageAssets } from "./assetFetcher";
import type { IRNode } from "../shared/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockImageResponse(contentType: string, bytes: Uint8Array) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => bytes.buffer,
  };
}

describe("resolveImageAssets", () => {
  it("only fetches image-type IR nodes, skipping everything else", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockImageResponse("image/png", new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetchMock);

    const nodes: IRNode[] = [
      { type: "paragraph", text: [{ text: "hi" }] },
      { type: "image", assetId: "https://feishu.cn/img/a.png?x=1" },
      { type: "divider" },
    ];
    const assets = await resolveImageAssets(nodes);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://feishu.cn/img/a.png?x=1", { credentials: "include" });
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ assetId: "https://feishu.cn/img/a.png?x=1", mimeType: "image/png" });
  });

  it("derives the filename from the URL path when it has a real file extension", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockImageResponse("image/jpeg", new Uint8Array([1])));
    vi.stubGlobal("fetch", fetchMock);

    const assets = await resolveImageAssets([{ type: "image", assetId: "https://feishu.cn/space/photo.jpg" }]);
    expect(assets[0].filename).toBe("photo.jpg");
  });

  it("falls back to a generated filename with a guessed extension when the URL has no clear filename", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockImageResponse("image/webp", new Uint8Array([1])));
    vi.stubGlobal("fetch", fetchMock);

    const assets = await resolveImageAssets([
      { type: "image", assetId: "https://feishu.cn/space/api/box/stream/download/asset/abc123" },
    ]);
    expect(assets[0].filename).toBe("image-1.webp");
  });

  it("throws with the failing URL when a download returns a non-2xx status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveImageAssets([{ type: "image", assetId: "https://feishu.cn/img/gone.png" }])).rejects.toThrow(
      /403/,
    );
  });
});
