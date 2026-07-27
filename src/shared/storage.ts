import type { ExtensionConfig } from "./types";

const DEFAULTS: ExtensionConfig = {
  notionToken: null,
  databaseId: null,
};

export async function getConfig(): Promise<ExtensionConfig> {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return stored as ExtensionConfig;
}

export async function setConfig(patch: Partial<ExtensionConfig>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export async function isConfigured(): Promise<boolean> {
  const { notionToken, databaseId } = await getConfig();
  return Boolean(notionToken && databaseId);
}
