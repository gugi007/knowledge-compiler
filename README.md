# Knowledge Compiler

把创作者按时间散落的文章，编译成可探索的个人知识网络。

输入一堆文章，输出一张可在浏览器里漫游的知识图谱：概念节点、概念间关系、跨文章的阅读路径，每条关系都能回溯到原文证据句。

需要 Node.js 22.18 或更高版本。

## 本地运行

```bash
npm install
npm run compile:demo
npm run dev
```

打开 <http://localhost:3000> 查看 Knowledge Garden，或打开 <http://localhost:3000/compile> 运行可见的编译流程。

### 切换语料

`compile:demo` 用 `DATA_DIR` 指定语料目录，默认 `data/demo`：

```bash
# 苏剑林（科学空间）18 篇博客
DATA_DIR=data/sujianlin npm run compile:demo

# 前端用 ?source= 对应切换
http://localhost:3000/?source=sujianlin
```

仓库内置两套语料：

| 目录 | 内容 | 数据来源 |
|---|---|---|
| `data/demo` | 演示文章 + mock 产物 | 人工编写 |
| `data/sujianlin` | 苏剑林 18 篇博客 + LLM 编译产物 | `scripts/fetch-kexue.mjs` 抓取 |

抓取脚本（kexue.fm 反爬绕过 + 雪球式内部链接爬取）：

```bash
node scripts/fetch-kexue.mjs
```

## Provider

### Mock（离线）

默认 `DeterministicMockProvider`，不需要 API Key，用于离线 Demo、固定回归结果和数据校验。它依赖 curated lexicon，不属于真实 AI extraction。

```bash
npm run compile:demo   # KNOWLEDGE_COMPILER_PROVIDER 默认 mock
```

### LLM（真实编译）

复制 `.env.example` 为 `.env.local`，填写 OpenAI-compatible 端点。已在阿里云 MaaS（compatible-mode）+ qwen3.8-flash 上验证。

```dotenv
KNOWLEDGE_COMPILER_PROVIDER=llm
LLM_BASE_URL=https://ws-xxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=sk-...
LLM_MODEL=qwen3.8-flash
LLM_EMBEDDING_MODEL=text-embedding-v3   # 候选词提取用，默认 text-embedding-v3
ZHIHU_ACCESS_SECRET=                      # 可选，读取知乎创作者文章
```

```bash
npm run compile:demo
npm run dev
```

Provider 用标准 `fetch` 调用：
- `${LLM_BASE_URL}/chat/completions` 做概念/关系抽取、合并、跨文章综合
- `${LLM_BASE_URL}/embeddings` 做 KeyBERT 式候选词排序

不依赖 OpenAI SDK。

## 抽取架构

借鉴 [kg-gen](https://github.com/stair-lab/kg-gen) 与 [KeyBERT](https://github.com/MaartenGr/KeyBERT)，核心是**职责分离 + 确定性锚定**——LLM 只做判断，代码做定位。

| 阶段 | 谁做 | 做法 |
|---|---|---|
| 候选词 | 代码 + embedding | 标题+首段按虚词/标点切候选短语，`text-embedding-v3` 与文档算余弦，取 top 12 |
| 概念命名 | LLM | 只能从候选列表里选 ≤5 个，禁止自造术语 |
| 证据锚定 | 代码 | 在原文找含概念名（或两端概念名）的句子，`indexOf` 算偏移 |
| 概念合并 | 代码 + LLM | slug/name deterministic 硬合并 + LLM 谨慎合并候选对 |
| 跨文章关系 | LLM | 仅从已收敛概念里推断，端点受限 |
| 收敛 | 代码 | 按跨文章频次 + 置信度取 top 10 一级概念，丢弃其余 |
| 阅读路径 | 代码 | 拓扑排序（prerequisite 成环则按 level/id 破环） |

这样弱模型（flash）也能产出稳定、可锚定、不崩的图谱。证据 quote 必然是原文子串、偏移精确、含概念名，通过严格 schema 校验。

## 检查

```bash
npm run compile:demo
npm run validate:data
npm run lint
npm run typecheck
npm run build
```

## 目录

```
data/                 语料与编译产物
  demo/               演示语料
  sujianlin/          苏剑林语料
lib/compiler/         编译管线
  keyphrase.ts        KeyBERT 式候选词提取
  llm-provider.ts     OpenAI-compatible LLM provider
  mock-provider.ts    确定性 mock provider
  schema.ts            运行时数据校验
  compile.ts           管线编排（含 top-10 收敛）
app/                   Next.js 前端（知乎风格）
scripts/               抓取与编译脚本
```
