# 飞书文档 → Notion 一键保存

Chrome 插件（Manifest V3）：打开一篇飞书文档，点一下就把标题、正文、图片和附件保存成 Notion database 里的一行。图片和附件都是作为真实文件传进 Notion 的，不是存外链。

## 功能

- 一键保存当前飞书文档到你指定的 Notion database
- 正文保留标题层级、列表、代码块、引用、分割线、简单表格、加粗/斜体/删除线/行内代码/链接
- 图片作为 Notion 图片块内嵌（真实文件，不是链接）
- 文档里的附件自动下载，打包成一个 zip，挂在条目的"附件"文件属性上
- 同一篇文档再保存一次时会提示"更新已有条目"还是"另存为新条目"
- 插件设置页可以看到所有保存过的条目，支持删除

## 已知限制

- 复杂图形（流程图、思维导图等）不保证 100% 还原，会降级成一段说明文字保留原文
- 图片/附件下载依赖飞书页面自身的登录态和内部接口，飞书如果调整这些接口，抓取会失效
- Notion 免费版 workspace 单文件上传上限 5 MiB，付费版 5 GiB；超过会在保存时报错提示，不会静默失败
- 需要手动在 Notion 建一个 Integration 并把 token 填进插件（见下面的安装步骤），不走 OAuth 授权

## 安装步骤

### 1. 在 Notion 建一个 Integration

1. 打开 [Notion 我的 Integrations 页面](https://www.notion.so/my-integrations)，点"New integration"。
2. 起个名字（比如"飞书转存"），选好关联的 workspace，创建。
3. 在 Integration 详情页的 "Capabilities" 里，确认勾上了 "Read content"、"Update content"、"Insert content"，以及文件上传相关的能力。
4. 复制 "Internal Integration Secret"（以 `secret_` 开头），后面要填进插件设置里。

### 2. 准备好要保存到的 Notion database

- 用一个已有的 database，或者新建一个。
- 打开这个 database 页面，右上角 `...` → "Connections"（或者 "Add connections"）→ 选择你刚才建的 Integration，把它加进来。**这一步不做，插件会看不到这个 database。**

### 3. 加载插件

```bash
cd Feishu2Notion
npm install
npm run build
```

然后在 Chrome 里：

1. 打开 `chrome://extensions`
2. 右上角打开"开发者模式"
3. 点"加载已解压的扩展程序"，选中这个项目的 `dist` 目录

### 4. 配置插件

1. 点插件图标 → 打开设置（或者在 `chrome://extensions` 里点这个插件的"详情" → "扩展程序选项"）。
2. 粘贴第 1 步复制的 Integration Secret，点"测试连接"。
3. 连接成功后，下拉框里选第 2 步分享过的 database，点"使用该 Database"。
   - 如果下拉框是空的，说明还没有把任何 database 分享给这个 Integration——设置页会直接列出该做什么（去 Notion 打开那个 database → 右上角 ⋯ → Connections → 选中你的 Integration），分享完点旁边的"刷新列表"就行，不用重新填 Token。
4. 设置页下方会列出这个 database 里插件保存过的条目。

### 5. 使用

打开一篇飞书文档（`docx`/`docs`/`wiki` 链接都支持），点插件图标，点"保存当前飞书文档到 Notion"。

## 开发

```bash
npm run watch   # 监听文件变化自动重新构建到 dist/
npm test        # 跑单元测试
npx tsc --noEmit  # 类型检查
```

代码结构：

```
src/
  background/    # service worker：Notion API 封装、IR→Notion 块转换、附件打包、一键保存编排
  content/       # 注入到飞书文档页面：抓文档结构、抓图片/附件二进制
  popup/         # 点插件图标弹出的"保存"按钮
  options/       # 设置页：Token/Database 配置、已保存条目管理
  shared/        # 两端共用的类型和 chrome.storage 封装
```
