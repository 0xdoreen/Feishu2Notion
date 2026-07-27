import type { IRNode, RichText } from "../shared/types";

/**
 * 把飞书文档块 DOM 元素（自带 data-block-id / data-block-type，class 命名规律为
 * docx-{type}-block）转换成插件内部的中间表示 IRNode。2026-07-18 用真实登录的飞书文档
 * 抓包 + DOM 探测确认过：heading1/2/3、quote、page、text（段落）、image（<img src>）、
 * file（附件，token 在 data-record-id，文件名在 .file-name）。table/code/bullet/ordered/
 * divider 这几种当时的测试文档里没有实例，是按飞书一贯的命名规律实现的，还没有用真实文档
 * 验证过，上线前需要用含有这些元素的文档跑一次端到端测试。
 */
export function parseBlockElement(el: Element): IRNode {
  const blockType = el.getAttribute("data-block-type") ?? "";

  switch (blockType) {
    case "heading1":
      return { type: "heading", level: 1, text: parseRichText(el) };
    case "heading2":
      return { type: "heading", level: 2, text: parseRichText(el) };
    case "heading3":
      return { type: "heading", level: 3, text: parseRichText(el) };
    case "text":
      return { type: "paragraph", text: parseRichText(el) };
    case "quote":
      return { type: "quote", text: parseRichText(el) };
    case "bullet":
      return { type: "bulleted_list_item", text: parseRichText(el) };
    case "ordered":
      return { type: "numbered_list_item", text: parseRichText(el) };
    case "divider":
      return { type: "divider" };
    case "code":
      return {
        type: "code",
        language: el.getAttribute("data-language") ?? "plaintext",
        text: el.textContent ?? "",
      };
    case "image": {
      const img = el.querySelector("img");
      const src = img?.getAttribute("src") ?? img?.getAttribute("data-src") ?? "";
      if (!src) {
        return { type: "unsupported", originalType: blockType, fallbackText: "[图片，未能取到地址]" };
      }
      return { type: "image", assetId: src };
    }
    case "file": {
      // 2026-07-18 用真实文档验证过：附件块的文件 token 就是 data-record-id，
      // 文件名在 .file-name 元素里，和 data-block-type="image" 那套 <img src> 的写法不一样。
      const fileToken = el.getAttribute("data-record-id");
      const filename = el.querySelector(".file-name")?.textContent?.trim();
      if (!fileToken || !filename) {
        return { type: "unsupported", originalType: blockType, fallbackText: "[附件，未能取到文件信息]" };
      }
      return { type: "attachment", fileToken, filename };
    }
    case "table": {
      const rows = Array.from(el.querySelectorAll("tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td, th")).map((cell) => parseRichText(cell)),
      );
      if (rows.length === 0) {
        return { type: "unsupported", originalType: blockType, fallbackText: el.textContent ?? "" };
      }
      return { type: "table", rows };
    }
    default:
      return {
        type: "unsupported",
        originalType: blockType || "(unknown)",
        fallbackText: el.textContent ?? "",
      };
  }
}

/** 把一个块元素内的富文本（粗体/斜体/删除线/行内代码/链接）递归展开成 RichText[]，不依赖飞书私有 class 名。 */
export function parseRichText(root: Node): RichText[] {
  const runs: RichText[] = [];
  walk(root, {});
  return mergeAdjacent(runs);

  function walk(node: Node, marks: Omit<RichText, "text">) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text.length > 0) runs.push({ ...marks, text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const nextMarks: Omit<RichText, "text"> = { ...marks };

    if (tag === "strong" || tag === "b") nextMarks.bold = true;
    if (tag === "em" || tag === "i") nextMarks.italic = true;
    if (tag === "s" || tag === "del") nextMarks.strikethrough = true;
    if (tag === "code") nextMarks.code = true;
    if (tag === "a") nextMarks.link = el.getAttribute("href") ?? undefined;

    for (const child of Array.from(el.childNodes)) {
      walk(child, nextMarks);
    }
  }

  function mergeAdjacent(items: RichText[]): RichText[] {
    const merged: RichText[] = [];
    for (const item of items) {
      const prev = merged[merged.length - 1];
      if (prev && sameMarks(prev, item)) {
        prev.text += item.text;
      } else {
        merged.push({ ...item });
      }
    }
    return merged;
  }

  function sameMarks(a: RichText, b: RichText): boolean {
    return (
      a.bold === b.bold &&
      a.italic === b.italic &&
      a.strikethrough === b.strikethrough &&
      a.code === b.code &&
      a.link === b.link
    );
  }
}
