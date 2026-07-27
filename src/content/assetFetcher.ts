import type { FetchedAsset, IRNode } from "../shared/types";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

function guessExtension(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] ?? "bin";
}

function filenameFromUrl(url: string, index: number, mimeType: string): string {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split("/").filter(Boolean).pop();
    if (last && last.includes(".")) return last;
  } catch {
    // 不是标准 URL（理论上不会发生，image 节点的 assetId 就是 <img src>），走兜底命名
  }
  return `image-${index + 1}.${guessExtension(mimeType)}`;
}

/**
 * 把 IR 里 image 节点的 assetId（飞书内部图片地址，2 小时内有效）换成真实二进制。
 * 必须带上页面自己的登录态（credentials: "include"），这也是为什么这一步只能在
 * content script（飞书页面上下文）里做，background 里没有这个 cookie。
 */
export async function resolveImageAssets(nodes: IRNode[]): Promise<FetchedAsset[]> {
  const imageNodes = nodes.filter((node): node is Extract<IRNode, { type: "image" }> => node.type === "image");

  const assets: FetchedAsset[] = [];
  for (const [index, node] of imageNodes.entries()) {
    const response = await fetch(node.assetId, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`下载图片失败 (HTTP ${response.status})：${node.assetId}`);
    }
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const data = await response.arrayBuffer();
    assets.push({
      assetId: node.assetId,
      filename: filenameFromUrl(node.assetId, index, mimeType),
      mimeType,
      data,
    });
  }
  return assets;
}
