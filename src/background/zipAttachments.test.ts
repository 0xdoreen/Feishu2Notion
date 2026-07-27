import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { zipAttachments } from "./zipAttachments";
import type { FetchedAsset } from "../shared/types";

function asset(filename: string, content: string): FetchedAsset {
  return {
    assetId: filename,
    filename,
    mimeType: "application/octet-stream",
    data: new TextEncoder().encode(content).buffer,
  };
}

describe("zipAttachments", () => {
  it("throws when there are no attachments to pack", async () => {
    await expect(zipAttachments([])).rejects.toThrow();
  });

  it("packs every attachment into the zip under its own filename", async () => {
    const result = await zipAttachments([asset("a.pdf", "pdf-bytes"), asset("b.docx", "docx-bytes")]);
    expect(result.filename).toBe("附件.zip");
    expect(result.mimeType).toBe("application/zip");

    const zip = await JSZip.loadAsync(result.data);
    expect(Object.keys(zip.files).sort()).toEqual(["a.pdf", "b.docx"]);
    expect(await zip.file("a.pdf")?.async("string")).toBe("pdf-bytes");
    expect(await zip.file("b.docx")?.async("string")).toBe("docx-bytes");
  });

  it("disambiguates duplicate filenames instead of overwriting one with the other", async () => {
    const result = await zipAttachments([asset("报告.pdf", "第一份"), asset("报告.pdf", "第二份")]);
    const zip = await JSZip.loadAsync(result.data);
    expect(Object.keys(zip.files).sort()).toEqual(["报告 (1).pdf", "报告.pdf"]);
    expect(await zip.file("报告.pdf")?.async("string")).toBe("第一份");
    expect(await zip.file("报告 (1).pdf")?.async("string")).toBe("第二份");
  });

  it("uses the given zip filename when provided", async () => {
    const result = await zipAttachments([asset("x.txt", "x")], "custom.zip");
    expect(result.filename).toBe("custom.zip");
  });
});
