import { getConfig } from "../shared/storage";
import type {
  CheckExistingDocResult,
  ErrorResult,
  ExtractedDocument,
  SaveToNotionResult,
} from "../shared/types";
import { irNodesToNotionBlocks, type ImageResolver } from "./irToNotionBlocks";
import {
  createPageWithChildren,
  findPageByDocToken,
  findTitlePropertyName,
  getDatabaseSchema,
  replacePageChildren,
  updatePageProperties,
  uploadFile,
  uploadLargeFile,
} from "./notionClient";
import { buildPageProperties } from "./pageProperties";
import { zipAttachments } from "./zipAttachments";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "未知错误";
}

const NOT_CONFIGURED_ERROR: ErrorResult = {
  ok: false,
  error: "还没有配置 Notion，请先打开插件设置填写 Token 并选择 database",
};

export async function checkExistingDoc(docToken: string): Promise<CheckExistingDocResult | ErrorResult> {
  try {
    const config = await getConfig();
    if (!config.notionToken || !config.databaseId) return NOT_CONFIGURED_ERROR;

    const found = await findPageByDocToken(config.notionToken, config.databaseId, docToken);
    if (!found) return { ok: true, existing: false };
    return { ok: true, existing: true, pageId: found.pageId, title: found.title };
  } catch (error) {
    return { ok: false, error: getErrorMessage(error) };
  }
}

async function uploadImages(token: string, document: ExtractedDocument): Promise<ImageResolver> {
  const uploaded = new Map<string, { fileUploadId: string }>();
  for (const image of document.images) {
    const { fileUploadId } = await uploadFile(token, image.filename, image.mimeType, image.data);
    uploaded.set(image.assetId, { fileUploadId });
  }
  return (assetId) => uploaded.get(assetId);
}

async function uploadAttachmentZip(token: string, document: ExtractedDocument): Promise<string | undefined> {
  if (document.attachments.length === 0) return undefined;
  const zip = await zipAttachments(document.attachments);
  const { fileUploadId } = await uploadLargeFile(token, zip.filename, zip.mimeType, zip.data);
  return fileUploadId;
}

export async function saveToNotion(
  document: ExtractedDocument,
  mode: "create" | "update",
  existingPageId?: string,
): Promise<SaveToNotionResult | ErrorResult> {
  try {
    const config = await getConfig();
    if (!config.notionToken || !config.databaseId) return NOT_CONFIGURED_ERROR;
    const { notionToken: token, databaseId } = config;

    const resolveImage = await uploadImages(token, document);
    const attachmentFileUploadId = await uploadAttachmentZip(token, document);
    const blocks = irNodesToNotionBlocks(document.nodes, resolveImage);

    const schema = await getDatabaseSchema(token, databaseId);
    const titlePropertyName = findTitlePropertyName(schema);
    const properties = buildPageProperties(titlePropertyName, document, new Date().toISOString(), attachmentFileUploadId);

    if (mode === "update" && existingPageId) {
      await updatePageProperties(token, existingPageId, properties);
      await replacePageChildren(token, existingPageId, blocks);
      return { ok: true, pageId: existingPageId };
    }

    const { pageId } = await createPageWithChildren(token, databaseId, properties, blocks);
    return { ok: true, pageId };
  } catch (error) {
    return { ok: false, error: getErrorMessage(error) };
  }
}
