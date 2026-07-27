import { getConfig, setConfig } from "../shared/storage";
import {
  archivePage,
  ensureRequiredProperties,
  listDatabases,
  listSavedEntries,
  testConnection,
  type NotionDatabaseSummary,
  type SavedEntrySummary,
} from "../background/notionClient";

const tokenInput = document.getElementById("token-input") as HTMLInputElement;
const testConnectionBtn = document.getElementById("test-connection") as HTMLButtonElement;
const connectionStatus = document.getElementById("connection-status") as HTMLDivElement;
const databaseSelect = document.getElementById("database-select") as HTMLSelectElement;
const refreshDatabasesBtn = document.getElementById("refresh-databases") as HTMLButtonElement;
const saveDatabaseBtn = document.getElementById("save-database") as HTMLButtonElement;
const databaseHint = document.getElementById("database-hint") as HTMLDivElement;
const entriesBody = document.getElementById("entries-body") as HTMLTableSectionElement;

let connectedBotName = "";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "未知错误";
}

/** database 列表为空时最常见的原因就是还没在 Notion 里把它分享给这个 Integration，
 * 这里给出具体步骤，而不是让用户对着一个空下拉框猜。 */
function renderEmptyDatabaseHint(botName: string) {
  databaseHint.innerHTML = "";
  databaseHint.hidden = false;

  const intro = document.createElement("div");
  intro.textContent = `还没有 database 分享给「${botName}」这个 Integration。`;
  databaseHint.appendChild(intro);

  const steps = document.createElement("ol");
  const stepTexts = [
    "打开 Notion，进入你想用来保存飞书文档的那个 database",
    "点右上角的 ⋯ 菜单 → Connections（或 Add connections）",
    `选中「${botName}」`,
    '分享好之后回到这里，点上面的"刷新列表"',
  ];
  for (const text of stepTexts) {
    const li = document.createElement("li");
    li.textContent = text;
    steps.appendChild(li);
  }
  databaseHint.appendChild(steps);
}

function populateDatabaseSelect(databases: NotionDatabaseSummary[], selectedId: string | null) {
  databaseSelect.innerHTML = "";
  if (databases.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "没有已分享给该 Integration 的 database";
    databaseSelect.appendChild(option);
    databaseSelect.disabled = true;
    saveDatabaseBtn.disabled = true;
    renderEmptyDatabaseHint(connectedBotName || "这个 Integration");
    return;
  }
  databaseHint.hidden = true;
  for (const db of databases) {
    const option = document.createElement("option");
    option.value = db.id;
    option.textContent = db.title;
    if (db.id === selectedId) option.selected = true;
    databaseSelect.appendChild(option);
  }
  databaseSelect.disabled = false;
  saveDatabaseBtn.disabled = false;
}

function formatSavedAt(savedAt: string | null): string {
  if (!savedAt) return "-";
  return new Date(savedAt).toLocaleString();
}

function renderEntriesMessage(message: string) {
  entriesBody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 3;
  cell.textContent = message;
  row.appendChild(cell);
  entriesBody.appendChild(row);
}

function renderEntries(token: string, databaseId: string, entries: SavedEntrySummary[]) {
  entriesBody.innerHTML = "";
  if (entries.length === 0) {
    renderEntriesMessage("还没有保存过任何文档");
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("tr");

    const titleCell = document.createElement("td");
    if (entry.url) {
      const link = document.createElement("a");
      link.href = entry.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = entry.title;
      titleCell.appendChild(link);
    } else {
      titleCell.textContent = entry.title;
    }
    row.appendChild(titleCell);

    const savedAtCell = document.createElement("td");
    savedAtCell.textContent = formatSavedAt(entry.savedAt);
    row.appendChild(savedAtCell);

    const actionCell = document.createElement("td");
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "删除";
    deleteBtn.addEventListener("click", () => handleDeleteEntry(token, databaseId, entry, deleteBtn));
    actionCell.appendChild(deleteBtn);
    row.appendChild(actionCell);

    entriesBody.appendChild(row);
  }
}

async function handleDeleteEntry(
  token: string,
  databaseId: string,
  entry: SavedEntrySummary,
  button: HTMLButtonElement,
) {
  if (!window.confirm(`确定要删除《${entry.title}》吗？`)) return;
  button.disabled = true;
  try {
    await archivePage(token, entry.pageId);
    await refreshEntries(token, databaseId);
  } catch (error) {
    connectionStatus.textContent = `删除失败：${getErrorMessage(error)}`;
    button.disabled = false;
  }
}

async function refreshEntries(token: string, databaseId: string) {
  renderEntriesMessage("正在加载...");
  try {
    const entries = await listSavedEntries(token, databaseId);
    renderEntries(token, databaseId, entries);
  } catch (error) {
    renderEntriesMessage(`加载失败：${getErrorMessage(error)}`);
  }
}

async function init() {
  const config = await getConfig();
  if (config.notionToken) tokenInput.value = config.notionToken;
  if (config.notionToken) {
    refreshDatabasesBtn.disabled = false;
    await refreshDatabases(config.notionToken, config.databaseId);
  }
  if (config.notionToken && config.databaseId) {
    await refreshEntries(config.notionToken, config.databaseId);
  }
}

async function refreshDatabases(token: string, selectedId: string | null) {
  try {
    const databases = await listDatabases(token);
    populateDatabaseSelect(databases, selectedId);
  } catch (error) {
    connectionStatus.textContent = `获取 database 列表失败：${getErrorMessage(error)}`;
  }
}

testConnectionBtn.addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    connectionStatus.textContent = "请先填写 Token";
    return;
  }
  testConnectionBtn.disabled = true;
  connectionStatus.textContent = "正在测试连接...";
  try {
    const { botName } = await testConnection(token);
    connectedBotName = botName;
    await setConfig({ notionToken: token });
    connectionStatus.textContent = `连接成功，Integration：${botName}`;
    refreshDatabasesBtn.disabled = false;
    await refreshDatabases(token, null);
  } catch (error) {
    connectionStatus.textContent = `连接失败：${getErrorMessage(error)}`;
  } finally {
    testConnectionBtn.disabled = false;
  }
});

refreshDatabasesBtn.addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  if (!token) return;
  refreshDatabasesBtn.disabled = true;
  connectionStatus.textContent = "正在刷新 database 列表...";
  try {
    await refreshDatabases(token, databaseSelect.value || null);
    connectionStatus.textContent = "已刷新";
  } catch (error) {
    connectionStatus.textContent = `刷新失败：${getErrorMessage(error)}`;
  } finally {
    refreshDatabasesBtn.disabled = false;
  }
});

saveDatabaseBtn.addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  const databaseId = databaseSelect.value;
  if (!token || !databaseId) return;
  saveDatabaseBtn.disabled = true;
  connectionStatus.textContent = "正在检查 database 属性...";
  try {
    await ensureRequiredProperties(token, databaseId);
    await setConfig({ databaseId });
    connectionStatus.textContent = "已保存，该 database 可以使用了";
    await refreshEntries(token, databaseId);
  } catch (error) {
    connectionStatus.textContent = `设置失败：${getErrorMessage(error)}`;
  } finally {
    saveDatabaseBtn.disabled = false;
  }
});

init();
