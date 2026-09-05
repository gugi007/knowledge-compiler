// 抓取苏剑林（科学空间 kexue.fm）文章，转换为 RawArticle 格式。
// 站点有"首次请求种 Cookie"的反爬：对每个 URL 先请求一次（403 + Set-Cookie），
// 携带 Cookie 再次请求即可拿到 200 全文。
// 用法: node scripts/fetch-kexue.mjs [--max 18]

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const cookieJar = new Map();

function applySetCookies(headers) {
  const raw = headers.getSetCookie ? headers.getSetCookie() : [];
  for (const c of raw) {
    const pair = c.split(";")[0];
    const idx = pair.indexOf("=");
    if (idx > 0) cookieJar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

async function requestOnce(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml",
      ...(cookieJar.size ? { cookie: [...cookieJar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
    },
    redirect: "follow",
  });
  applySetCookies(res.headers);
  const body = await res.text();
  return { status: res.status, body };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchArticle(url) {
  let { status, body } = await requestOnce(url);
  if (status === 403) {
    await sleep(900);
    ({ status, body } = await requestOnce(url));
  }
  if (status !== 200) throw new Error(`HTTP ${status} for ${url}`);
  return body;
}

// 提取 id="PostContent" 的正文：取 PostContent 之后、页面尾部区块（标签栏、
// 上下篇导航 entrynavigation、相关推荐 similar、评论区 PostComment/comments）之前的部分
function extractPostContent(html) {
  const start = html.search(/<div[^>]*id=["']PostContent["'][^>]*>/i);
  if (start < 0) return "";
  let inner = html.slice(html.indexOf(">", start) + 1);
  const tail = inner.search(/<div[^>]*id=["'](entrynavigation|similar|PostComment|comments)["']/i);
  if (tail > 0) inner = inner.slice(0, tail);
  return inner;
}

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;/g, "'");
}

function htmlToText(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote|\/tr)[^>]*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text);
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(分类|标签)：/.test(line) && !/^\d+\s*评论$/.test(line))
    .join("\n");
}

function parseArticle(html, url) {
  const id = url.match(/archives\/(\d+)/)?.[1] ?? "";
  const title = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "")
    .replace(/\s*-\s*科学空间.*$/, "")
    .trim();
  const date = (html.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "";
  const content = htmlToText(extractPostContent(html));
  // 文章内链（供滚雪球发现相关文章）
  const links = [];
  for (const m of html.matchAll(/href=["'](?:https?:\/\/kexue\.fm)?\/archives\/(\d+)["'][^>]*>([^<]{2,90})</g)) {
    links.push({ id: m[1], title: m[2].trim() });
  }
  return { id, title, date, content, links, url };
}

const TOPIC_RE =
  /(RoPE|位置编码|位置感知|Attention|注意力|Softmax|KV\s*Cache|长上下文|上下文|推理|Transformer|MoE|线性|Scaling|Loss|损失|优化器|动量|梯度|学习率|量化|解码|采样|预训练|微调|词表|Embedding|归一化|Normalization)/i;

async function main() {
  const maxArg = process.argv.indexOf("--max");
  const maxArticles = maxArg > 0 ? Number(process.argv[maxArg + 1]) : 18;

  // 种子：RSS 最新文章 + 经典入口
  const seeds = [
    "https://kexue.fm/archives/4765",
    "https://kexue.fm/archives/11879",
    "https://kexue.fm/archives/11875",
    "https://kexue.fm/archives/11854",
    "https://kexue.fm/archives/11848",
    "https://kexue.fm/archives/11833",
    "https://kexue.fm/archives/11823",
    "https://kexue.fm/archives/11814",
    "https://kexue.fm/archives/11804",
  ];

  const fetched = new Map(); // id -> article
  const queue = [...seeds];
  const seen = new Set(queue.map((u) => u.match(/(\d+)$/)[1]));

  while (queue.length && fetched.size < maxArticles) {
    const url = queue.shift();
    const id = url.match(/archives\/(\d+)/)[1];
    try {
      const parsed = parseArticle(await fetchArticle(url), url);
      if (!parsed.id || parsed.content.length < 800) {
        console.error(`skip ${id}: 正文过短或解析失败`);
        continue;
      }
      fetched.set(id, parsed);
      console.log(`[${fetched.size}/${maxArticles}] ${parsed.date} ${parsed.title}（${parsed.content.length} 字，内链 ${parsed.links.length}）`);
      // 滚雪球：把主题相关的内链加入队列
      for (const link of parsed.links) {
        if (!seen.has(link.id) && TOPIC_RE.test(link.title)) {
          seen.add(link.id);
          queue.push(`https://kexue.fm/archives/${link.id}`);
        }
      }
      await sleep(1000);
    } catch (error) {
      console.error(`fail ${id}: ${error.message}`);
      await sleep(1500);
    }
  }

  const articles = [...fetched.values()].map((a) => ({
    id: `kexue-${a.id}`,
    title: a.title,
    slug: `kexue-${a.id}`,
    publishedAt: a.date,
    sourceUrl: a.url,
    content: a.content,
  }));

  const outDir = path.join(process.cwd(), "data", "sujianlin", "articles");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "articles.json"), JSON.stringify(articles, null, 2));
  console.log(`\n完成：${articles.length} 篇 -> data/sujianlin/articles/articles.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
