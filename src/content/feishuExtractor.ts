import type { ExtractedDocument } from "../shared/types";
import { resolveAttachmentAssets } from "./attachmentFetcher";
import { resolveImageAssets } from "./assetFetcher";
import { parseBlockElement, parseRichText } from "./blockParser";

const TITLE_SUFFIXES = [" - Feishu Docs", " - 飞书文档"];

/**
 * 飞书文档没有一个"拉取全文 JSON"的公开接口：正文是通过 WebSocket 协同编辑同步进客户端的，
 * 最终渲染成带 data-block-id / data-block-type 的 DOM。2026-07-18 用真实登录的文档验证过：
 * - 真实的文档 token（不是 wiki 分享链接里那个 node token）会出现在页面自己发的
 *   `/space/api/meta/?token=xxx&type=22` 等请求的 query 参数里，可以从 Performance API
 *   的 resource entries 里拿到，不需要拦截 fetch/XHR。
 * - 左侧目录栏不会带 data-block-id，不会跟正文块混在一起，直接查 [data-block-id] 是安全的。
 */
export function getDocToken(): string {
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  for (const entry of entries) {
    if (!entry.name.includes("/space/api/")) continue;
    const token = new URL(entry.name).searchParams.get("token");
    if (token) return token;
  }
  const match = location.pathname.match(/\/(?:docx|docs|wiki)\/([a-zA-Z0-9]+)/);
  if (match) return match[1];
  throw new Error("无法识别当前文档的 token，请确认这是一个飞书文档页面");
}

export function getDocTitle(): string {
  let title = document.title;
  for (const suffix of TITLE_SUFFIXES) {
    if (title.endsWith(suffix)) {
      title = title.slice(0, -suffix.length);
      break;
    }
  }
  title = title.trim();
  if (title.length > 0) return title;

  const pageBlock = document.querySelector('[data-block-type="page"]');
  return pageBlock?.textContent?.trim() || "(未命名文档)";
}

/** 正文通过 WebSocket 异步同步，等块数量稳定下来再开始抓取，避免抓到半截内容。 */
export async function waitForBlocksReady(timeoutMs = 15000): Promise<void> {
  const pollIntervalMs = 400;
  const stableRoundsRequired = 2;
  let lastCount = -1;
  let stableRounds = 0;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const count = document.querySelectorAll("[data-block-id]").length;
    if (count > 0 && count === lastCount) {
      stableRounds += 1;
      if (stableRounds >= stableRoundsRequired) return;
    } else {
      stableRounds = 0;
    }
    lastCount = count;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  if (lastCount <= 0) {
    throw new Error("等待文档内容加载超时，请确认页面已经完全打开");
  }
}

export async function extractDocument(): Promise<ExtractedDocument> {
  await waitForBlocksReady();

  const docToken = getDocToken();
  const title = getDocTitle();
  const url = location.href;

  const blockEls = Array.from(document.querySelectorAll("[data-block-id]")).filter(
    (el) => el.getAttribute("data-block-type") !== "page",
  );
  const nodes = blockEls.map((el) => parseBlockElement(el));
  const images = await resolveImageAssets(nodes);
  const attachments = await resolveAttachmentAssets(nodes);

  return { docToken, title, url, nodes, images, attachments };
}

// 供 blockParser 的富文本解析在需要单独调用时复用（例如未来给标题也套用富文本）。
export { parseRichText };
