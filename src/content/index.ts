import type { ExtensionMessage } from "../shared/types";
import { extractDocument } from "./feishuExtractor";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "未知错误";
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.kind === "EXTRACT_CURRENT_DOC") {
    extractDocument()
      .then((extracted) => sendResponse({ ok: true, document: extracted }))
      .catch((error: unknown) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }
  return false;
});
