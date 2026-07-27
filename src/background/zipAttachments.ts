import JSZip from "jszip";
import type { FetchedAsset } from "../shared/types";

function uniqueFilenames(assets: FetchedAsset[]): string[] {
  const seen = new Map<string, number>();
  return assets.map((asset) => {
    const count = seen.get(asset.filename) ?? 0;
    seen.set(asset.filename, count + 1);
    if (count === 0) return asset.filename;
    const dot = asset.filename.lastIndexOf(".");
    return dot === -1
      ? `${asset.filename} (${count})`
      : `${asset.filename.slice(0, dot)} (${count})${asset.filename.slice(dot)}`;
  });
}

/** 把抓下来的附件打成一个 zip，文件名重复时自动加 (1)/(2) 后缀，不覆盖丢内容。 */
export async function zipAttachments(assets: FetchedAsset[], zipFilename = "附件.zip"): Promise<FetchedAsset> {
  if (assets.length === 0) {
    throw new Error("zipAttachments 需要至少一个附件");
  }

  const zip = new JSZip();
  const filenames = uniqueFilenames(assets);
  assets.forEach((asset, index) => {
    zip.file(filenames[index], asset.data);
  });

  const data = await zip.generateAsync({ type: "arraybuffer" });
  return { assetId: "attachments-zip", filename: zipFilename, mimeType: "application/zip", data };
}
