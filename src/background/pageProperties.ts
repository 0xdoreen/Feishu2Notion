import { PROPERTY_NAMES } from "../shared/notionSchema";
import type { ExtractedDocument } from "../shared/types";

/** 组装写入/更新 database 条目要用的属性对象。附件为空时显式清空"附件"属性，
 * 避免更新时留着上一次保存的旧文件。 */
export function buildPageProperties(
  titlePropertyName: string,
  doc: ExtractedDocument,
  savedAtIso: string,
  attachmentFileUploadId?: string,
): Record<string, unknown> {
  return {
    [titlePropertyName]: { title: [{ type: "text", text: { content: doc.title } }] },
    [PROPERTY_NAMES.FEISHU_URL]: { url: doc.url },
    [PROPERTY_NAMES.FEISHU_DOC_TOKEN]: { rich_text: [{ type: "text", text: { content: doc.docToken } }] },
    [PROPERTY_NAMES.SAVED_AT]: { date: { start: savedAtIso } },
    [PROPERTY_NAMES.ATTACHMENTS]: attachmentFileUploadId
      ? { files: [{ type: "file_upload", file_upload: { id: attachmentFileUploadId }, name: "附件.zip" }] }
      : { files: [] },
  };
}
