import type { FetchedAsset, IRNode } from "../shared/types";

/**
 * 附件块（data-block-type="file"）不像图片那样在 DOM 里直接暴露一个可下载的 URL：
 * 2026-07-18 用真实登录的飞书文档抓包验证过，真正拿字节的方式是拿块的 data-record-id
 * 当 file_token，拼到这个固定路径下用同源 cookie 去下载，验证过返回的 content-type 和
 * 字节数与文档里显示的文件大小一致。
 */
function buildDownloadUrl(fileToken: string): string {
  const params = new URLSearchParams({ mount_node_token: fileToken, mount_point: "docx_file" });
  return `https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/all/${fileToken}/?${params.toString()}`;
}

export async function resolveAttachmentAssets(nodes: IRNode[]): Promise<FetchedAsset[]> {
  const attachmentNodes = nodes.filter(
    (node): node is Extract<IRNode, { type: "attachment" }> => node.type === "attachment",
  );

  const assets: FetchedAsset[] = [];
  for (const node of attachmentNodes) {
    const response = await fetch(buildDownloadUrl(node.fileToken), { credentials: "include" });
    if (!response.ok) {
      throw new Error(`下载附件失败 (HTTP ${response.status})：${node.filename}`);
    }
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const data = await response.arrayBuffer();
    assets.push({ assetId: node.fileToken, filename: node.filename, mimeType, data });
  }
  return assets;
}
