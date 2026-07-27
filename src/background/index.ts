import type { ExtensionMessage } from "../shared/types";
import { checkExistingDoc, saveToNotion } from "./saveOrchestrator";

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  switch (message.kind) {
    case "CHECK_EXISTING_DOC":
      checkExistingDoc(message.docToken).then(sendResponse);
      return true;
    case "SAVE_TO_NOTION":
      saveToNotion(message.document, message.mode, message.existingPageId).then(sendResponse);
      return true;
    default:
      return false;
  }
});
