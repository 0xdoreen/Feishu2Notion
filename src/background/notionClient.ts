import { PROPERTY_NAMES } from "../shared/notionSchema";
import type { NotionBlock } from "./irToNotionBlocks";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export class NotionApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "NotionApiError";
  }
}

async function notionRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (body && typeof body === "object" && "message" in body && String(body.message)) ||
      `Notion API 请求失败 (HTTP ${response.status})`;
    throw new NotionApiError(response.status, message);
  }
  return body as T;
}

export interface NotionDatabaseSummary {
  id: string;
  title: string;
}

interface NotionRichText {
  plain_text: string;
}

function extractPlainTitle(richText: NotionRichText[] | undefined): string {
  return (richText ?? []).map((t) => t.plain_text).join("") || "(未命名)";
}

/** 用一个轻量的接口校验 token 是否有效。 */
export async function testConnection(token: string): Promise<{ botName: string }> {
  const me = await notionRequest<{ name?: string }>(token, "/users/me");
  return { botName: me.name ?? "Notion Integration" };
}

/** 列出已经分享给这个 Integration 的所有 database。 */
export async function listDatabases(token: string): Promise<NotionDatabaseSummary[]> {
  const result = await notionRequest<{
    results: Array<{ id: string; title: NotionRichText[] }>;
  }>(token, "/search", {
    method: "POST",
    body: JSON.stringify({
      filter: { property: "object", value: "database" },
      page_size: 100,
    }),
  });
  return result.results.map((db) => ({ id: db.id, title: extractPlainTitle(db.title) }));
}

/** 在指定父页面下新建一个 database，供用户没有现成 database 时使用。 */
export async function createDatabase(
  token: string,
  parentPageId: string,
  title: string,
): Promise<NotionDatabaseSummary> {
  const db = await notionRequest<{ id: string; title: NotionRichText[] }>(token, "/databases", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: title } }],
      properties: {
        Name: { title: {} },
      },
    }),
  });
  return { id: db.id, title: extractPlainTitle(db.title) };
}

export interface NotionDatabaseSchema {
  id: string;
  properties: Record<string, { type: string }>;
}

export async function getDatabaseSchema(token: string, databaseId: string): Promise<NotionDatabaseSchema> {
  return notionRequest<NotionDatabaseSchema>(token, `/databases/${databaseId}`);
}

const REQUIRED_PROPERTY_STUBS: Record<string, Record<string, unknown>> = {
  [PROPERTY_NAMES.FEISHU_URL]: { url: {} },
  [PROPERTY_NAMES.FEISHU_DOC_TOKEN]: { rich_text: {} },
  [PROPERTY_NAMES.SAVED_AT]: { date: {} },
  [PROPERTY_NAMES.ATTACHMENTS]: { files: {} },
};

/** 检查 database 是否已有插件依赖的属性，缺哪个补哪个，不动用户已有的其它属性。 */
export async function ensureRequiredProperties(token: string, databaseId: string): Promise<void> {
  const schema = await getDatabaseSchema(token, databaseId);
  const missing = Object.entries(REQUIRED_PROPERTY_STUBS).filter(([name]) => !(name in schema.properties));
  if (missing.length === 0) return;

  await notionRequest(token, `/databases/${databaseId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: Object.fromEntries(missing) }),
  });
}

/** 找出该 database 的 title 属性名（不同 database 可能叫 Name / 标题 / Title 等，不保证叫 "Name"）。 */
export function findTitlePropertyName(schema: NotionDatabaseSchema): string {
  const entry = Object.entries(schema.properties).find(([, prop]) => prop.type === "title");
  if (!entry) throw new NotionApiError(500, "该 database 缺少 title 属性，这不应该发生");
  return entry[0];
}

/** Notion 单段（single_part）上传的大小上限，超过要走 multi-part（附件管线里实现）。 */
export const SINGLE_PART_UPLOAD_LIMIT = 20 * 1024 * 1024;

async function createFileUpload(
  token: string,
  filename: string,
  contentType: string,
): Promise<{ id: string }> {
  return notionRequest<{ id: string }>(token, "/file_uploads", {
    method: "POST",
    body: JSON.stringify({ filename, content_type: contentType }),
  });
}

async function sendFileUploadBytes(
  token: string,
  fileUploadId: string,
  filename: string,
  contentType: string,
  bytes: ArrayBuffer,
): Promise<void> {
  const formData = new FormData();
  formData.append("file", new Blob([bytes], { type: contentType }), filename);
  // 注意：这里故意不设 Content-Type，交给 fetch/FormData 自己生成 multipart boundary。
  const response = await fetch(`${NOTION_API_BASE}/file_uploads/${fileUploadId}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
    body: formData,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      (body && typeof body === "object" && "message" in body && String(body.message)) ||
      `Notion 文件上传失败 (HTTP ${response.status})`;
    throw new NotionApiError(response.status, message);
  }
}

/** 单段上传一个文件（图片管线用），超过 20 MiB 直接报错，不悄悄截断或跳过。 */
export async function uploadFile(
  token: string,
  filename: string,
  contentType: string,
  bytes: ArrayBuffer,
): Promise<{ fileUploadId: string }> {
  if (bytes.byteLength > SINGLE_PART_UPLOAD_LIMIT) {
    throw new NotionApiError(413, `文件 ${filename} 超过 20 MiB，单段上传无法处理`);
  }
  const { id } = await createFileUpload(token, filename, contentType);
  await sendFileUploadBytes(token, id, filename, contentType, bytes);
  return { fileUploadId: id };
}

async function createMultiPartFileUpload(
  token: string,
  filename: string,
  contentType: string,
  numberOfParts: number,
): Promise<{ id: string }> {
  return notionRequest<{ id: string }>(token, "/file_uploads", {
    method: "POST",
    body: JSON.stringify({
      mode: "multi_part",
      filename,
      content_type: contentType,
      number_of_parts: numberOfParts,
    }),
  });
}

async function sendFileUploadPart(
  token: string,
  fileUploadId: string,
  filename: string,
  contentType: string,
  partNumber: number,
  bytes: ArrayBuffer,
): Promise<void> {
  const formData = new FormData();
  formData.append("file", new Blob([bytes], { type: contentType }), filename);
  formData.append("part_number", String(partNumber));
  const response = await fetch(`${NOTION_API_BASE}/file_uploads/${fileUploadId}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
    body: formData,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      (body && typeof body === "object" && "message" in body && String(body.message)) ||
      `Notion 分片上传失败 (HTTP ${response.status})`;
    throw new NotionApiError(response.status, message);
  }
}

async function completeFileUpload(token: string, fileUploadId: string): Promise<void> {
  await notionRequest(token, `/file_uploads/${fileUploadId}/complete`, { method: "POST", body: "{}" });
}

/** 超过 20 MiB 的大文件（附件 zip 管线用）走 multi-part：按 20 MiB 分片、逐片上传、最后 complete。 */
export async function uploadLargeFile(
  token: string,
  filename: string,
  contentType: string,
  bytes: ArrayBuffer,
): Promise<{ fileUploadId: string }> {
  if (bytes.byteLength <= SINGLE_PART_UPLOAD_LIMIT) {
    return uploadFile(token, filename, contentType, bytes);
  }

  const totalParts = Math.ceil(bytes.byteLength / SINGLE_PART_UPLOAD_LIMIT);
  const { id } = await createMultiPartFileUpload(token, filename, contentType, totalParts);

  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    const start = (partNumber - 1) * SINGLE_PART_UPLOAD_LIMIT;
    const end = Math.min(start + SINGLE_PART_UPLOAD_LIMIT, bytes.byteLength);
    await sendFileUploadPart(token, id, filename, contentType, partNumber, bytes.slice(start, end));
  }

  await completeFileUpload(token, id);
  return { fileUploadId: id };
}

const NOTION_CHILDREN_PAGE_LIMIT = 100;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** 按插件写入的"飞书文档 Token"属性查找是否已经保存过这篇文档，用于一键保存时判重。 */
export async function findPageByDocToken(
  token: string,
  databaseId: string,
  docToken: string,
): Promise<{ pageId: string; title: string } | null> {
  const result = await notionRequest<{
    results: Array<{ id: string; properties: Record<string, { type: string; title?: NotionRichText[] }> }>;
  }>(token, `/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify({
      filter: { property: PROPERTY_NAMES.FEISHU_DOC_TOKEN, rich_text: { equals: docToken } },
      page_size: 1,
    }),
  });
  const page = result.results[0];
  if (!page) return null;

  const titleProp = Object.values(page.properties).find((prop) => prop.type === "title");
  return { pageId: page.id, title: extractPlainTitle(titleProp?.title) };
}

/** 一次性追加内容块，超过 Notion 单次请求 100 个块的上限时自动分批。 */
export async function appendChildren(token: string, blockId: string, children: NotionBlock[]): Promise<void> {
  for (const batch of chunkArray(children, NOTION_CHILDREN_PAGE_LIMIT)) {
    if (batch.length === 0) continue;
    await notionRequest(token, `/blocks/${blockId}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children: batch }),
    });
  }
}

/** 新建一条 database 页面，正文块超过 100 个时先建页面再分批追加剩下的。 */
export async function createPageWithChildren(
  token: string,
  databaseId: string,
  properties: Record<string, unknown>,
  children: NotionBlock[],
): Promise<{ pageId: string }> {
  const [firstBatch, ...restBatches] = chunkArray(children, NOTION_CHILDREN_PAGE_LIMIT);
  const page = await notionRequest<{ id: string }>(token, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
      children: firstBatch ?? [],
    }),
  });
  for (const batch of restBatches) {
    await appendChildren(token, page.id, batch);
  }
  return { pageId: page.id };
}

/** 更新已有页面的属性（标题、保存时间、附件等），不动正文内容块。 */
export async function updatePageProperties(
  token: string,
  pageId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await notionRequest(token, `/pages/${pageId}`, { method: "PATCH", body: JSON.stringify({ properties }) });
}

async function listAllChildBlockIds(token: string, blockId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);
    const result = await notionRequest<{
      results: Array<{ id: string }>;
      has_more: boolean;
      next_cursor: string | null;
    }>(token, `/blocks/${blockId}/children?${params.toString()}`);
    ids.push(...result.results.map((block) => block.id));
    cursor = result.has_more ? (result.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return ids;
}

/** 更新已有条目的正文：删掉旧的内容块，再把新解析出来的块追加进去。 */
export async function replacePageChildren(token: string, pageId: string, children: NotionBlock[]): Promise<void> {
  const existingIds = await listAllChildBlockIds(token, pageId);
  for (const blockId of existingIds) {
    await notionRequest(token, `/blocks/${blockId}`, { method: "DELETE" });
  }
  await appendChildren(token, pageId, children);
}

export interface SavedEntrySummary {
  pageId: string;
  title: string;
  url: string;
  savedAt: string | null;
}

interface NotionPageSummary {
  id: string;
  properties: Record<
    string,
    { type: string; title?: NotionRichText[]; url?: string | null; date?: { start: string } | null }
  >;
}

/** 列出这个 database 里插件保存过的条目（靠"飞书文档 Token"属性非空来识别），给 options 页做增删改查用。 */
export async function listSavedEntries(token: string, databaseId: string): Promise<SavedEntrySummary[]> {
  const result = await notionRequest<{ results: NotionPageSummary[] }>(token, `/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify({
      filter: { property: PROPERTY_NAMES.FEISHU_DOC_TOKEN, rich_text: { is_not_empty: true } },
      sorts: [{ property: PROPERTY_NAMES.SAVED_AT, direction: "descending" }],
      page_size: 100,
    }),
  });
  return result.results.map((page) => {
    const titleProp = Object.values(page.properties).find((prop) => prop.type === "title");
    const urlProp = page.properties[PROPERTY_NAMES.FEISHU_URL];
    const savedAtProp = page.properties[PROPERTY_NAMES.SAVED_AT];
    return {
      pageId: page.id,
      title: extractPlainTitle(titleProp?.title),
      url: urlProp?.url ?? "",
      savedAt: savedAtProp?.date?.start ?? null,
    };
  });
}

/** 归档一个条目（Notion 的"删除"就是 archived: true）。 */
export async function archivePage(token: string, pageId: string): Promise<void> {
  await notionRequest(token, `/pages/${pageId}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
}
