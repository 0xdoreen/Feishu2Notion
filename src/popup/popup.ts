import { isConfigured } from "../shared/storage";
import type {
  CheckExistingDocResult,
  ErrorResult,
  ExtensionMessage,
  ExtractedDocument,
  SaveToNotionResult,
} from "../shared/types";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "未知错误";
}

const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLDivElement;
const setupHint = document.getElementById("setup-hint") as HTMLDivElement;
const openOptions = document.getElementById("open-options") as HTMLAnchorElement;

openOptions.addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

async function init() {
  if (!(await isConfigured())) {
    setupHint.hidden = false;
    saveBtn.disabled = true;
  }
}

saveBtn.addEventListener("click", async () => {
  saveBtn.disabled = true;
  try {
    status.textContent = "正在抓取文档...";
    const document = await extractCurrentDoc();

    status.textContent = "正在检查是否已经保存过...";
    const { mode, existingPageId } = await resolveSaveMode(document);

    status.textContent = mode === "update" ? "正在更新已有条目..." : "正在保存到 Notion...";
    const saveMessage: ExtensionMessage = { kind: "SAVE_TO_NOTION", document, mode, existingPageId };
    const saveResult = (await chrome.runtime.sendMessage(saveMessage)) as SaveToNotionResult | ErrorResult;
    if (!saveResult.ok) throw new Error(saveResult.error);

    status.textContent = mode === "update" ? "已更新到 Notion" : "已保存到 Notion";
  } catch (error) {
    status.textContent = `出错了：${getErrorMessage(error)}`;
  } finally {
    saveBtn.disabled = false;
  }
});

async function extractCurrentDoc(): Promise<ExtractedDocument> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.id) throw new Error("找不到当前标签页");
  const message: ExtensionMessage = { kind: "EXTRACT_CURRENT_DOC" };
  const response = await chrome.tabs.sendMessage(tab.id, message);
  if (!response?.ok) throw new Error(response?.error ?? "抓取失败");
  return response.document as ExtractedDocument;
}

async function resolveSaveMode(
  document: ExtractedDocument,
): Promise<{ mode: "create" | "update"; existingPageId?: string }> {
  const checkMessage: ExtensionMessage = { kind: "CHECK_EXISTING_DOC", docToken: document.docToken };
  const checkResult = (await chrome.runtime.sendMessage(checkMessage)) as CheckExistingDocResult | ErrorResult;
  if (!checkResult.ok) throw new Error(checkResult.error);
  if (!checkResult.existing) return { mode: "create" };

  const shouldUpdate = window.confirm(
    `《${checkResult.title}》已经保存过了。\n点"确定"覆盖更新这条内容，点"取消"另存为新条目。`,
  );
  return shouldUpdate ? { mode: "update", existingPageId: checkResult.pageId } : { mode: "create" };
}

init();
