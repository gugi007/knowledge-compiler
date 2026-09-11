# Knowledge Compiler

把创作者按时间散落的文章，编译成可探索的个人知识网络。

输入一堆文章，输出一张可在浏览器里漫游的知识图谱：概念节点、概念间关系、跨文章的阅读路径，每条关系都能回溯到原文证据句。

需要 Node.js 22.18 或更高版本。

## 本地运行

```bash
npm install
npm run dev
```

`data/demo/compiled.json` 已经提交在仓库里，`npm run dev` 直接就能跑，不需要先编译。`compile:demo` 是**数据工具**（重新生成语料产物），不是安装步骤，而且它默认拒绝覆写已存在的产物——用法见下面的「切换语料」。

打开 <http://localhost:3000> 进入第一幕登录页，<http://localhost:3000/compile> 运行可见的编译流程，<http://localhost:3000/space> 进入知识空间。旧的三栏 Knowledge Garden 视图保留在 <http://localhost:3000/legacy>，仅作冻结参考基准。

### 切换语料

`compile:demo` 是数据工具，把 `<DATA_DIR>`（默认 `data/demo`）下的 `creator.json` 与 `articles/` 编译成 `<DATA_DIR>/compiled.json`。启动时会打印解析出的目标目录、目标文件是否已存在、以及实际使用的 provider（mock / llm），先看清输出再让它写。

它**默认拒绝覆写**：目标文件已存在又没带 `--force`，就只打印拒绝信息并非零退出，一个字节都不写。前端用 `?source=` 选择要展示的内置语料，取值与 `lib/frontend/corpora.ts` 的 `CorpusId` 一致（写在 `/space` 路由上）：

```bash
# 目标 <DATA_DIR>/compiled.json 已存在时不带 --force：打印三行启动信息后 REFUSED、非零退出、不写文件。
# 这是默认行为，不是故障。
DATA_DIR=data/demo npm run compile:demo

# 确认要覆写才显式加 --force（会替换掉仓库里的产物，事后可用 git restore 找回）
DATA_DIR=data/demo npm run compile:demo -- --force

# 只想重跑一遍验证管线、不想动仓库里的产物：复制一份临时语料再编译
cp -r data/demo .tmp-compile-demo
rm .tmp-compile-demo/compiled.json   # 关键：目标文件不存在，闸才不会拦
DATA_DIR=.tmp-compile-demo npm run compile:demo
rm -rf .tmp-compile-demo

# 前端切换内置语料
http://localhost:3000/space?source=demo
http://localhost:3000/space?source=bayes
```

默认拒写对所有 `compile:demo` 调用生效：只要 `<DATA_DIR>/compiled.json` 已存在就会停下来，不会静默覆盖仓库里已有的产物。走默认 `DATA_DIR=data/demo`（仓库里已有产物）时，不带 `--force` 一律会被拒；只有指向不含 `compiled.json` 的目录（上面的临时副本，或你自己的语料目录）才会直接编译。要覆写就把 `--force` 显式写出来。

仓库内置两套**产品路径**语料：

| 目录 | 内容 | 数据来源 |
|---|---|---|
| `data/demo` | 演示文章 + mock 产物 | 人工编写 |
| `data/bayes` | 概率论与统计推断 17 篇（沈亦舟 @bayes-lab）+ curated 产物 | 人工编写 |

`data/bayes/compiled.json` 是人工编写的 curated 产物（`compiler.mode = "curated"`，`provider = "hand-authored"`），不是 mock 管线的输出。**不要**用 `DATA_DIR=data/bayes npm run compile:demo -- --force` 去「重编」它——那会用 mock provider 覆盖掉这份 curated 数据。默认拒写在这里正好是保护：`data/bayes/compiled.json` 已存在，不带 `--force` 的调用会直接停下；真要用 mock/llm 重跑一份 curated 语料，先想清楚产物会被换成什么。

`data/sujianlin/` 现在只剩一份 `compiled.json`，只服务 `/legacy` 冻结参考基准，不在产品路径上，也不再有任何抓取脚本。

## Provider

### Mock（离线）

默认 `DeterministicMockProvider`，不需要 API Key，用于离线 Demo、固定回归结果和数据校验。它依赖 curated lexicon，不属于真实 AI extraction。

```bash
# KNOWLEDGE_COMPILER_PROVIDER 默认 mock。默认 DATA_DIR=data/demo 已经有产物，
# 所以这条会被防覆写闸拦下（REFUSED、非零退出）；要真写文件就加 -- --force，
# 或换一个不含 compiled.json 的 DATA_DIR（见「切换语料」）
npm run compile:demo
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
# 默认目标 data/demo/compiled.json 已存在，真实编译会覆写它，所以必须显式 --force
npm run compile:demo -- --force
# 编译自己的语料：换 DATA_DIR，别覆写仓库里的基线
DATA_DIR=/path/to/your-corpus npm run compile:demo
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
# 检查不应该改动仓库里的产物：不要为了跑检查对 data/demo 加 --force，
# 而是复制一份临时语料来验证管线
cp -r data/demo .tmp-check-demo
rm .tmp-check-demo/compiled.json   # 目标文件不存在，防覆写闸才不会拦
DATA_DIR=.tmp-check-demo npm run compile:demo
rm -rf .tmp-check-demo

npm run validate:data
npm run lint
npm run typecheck
npm run build
```

## 目录

```
data/                 语料与编译产物
  demo/               演示语料
  bayes/              概率论与统计推断语料（人工 curated）
  sujianlin/          仅剩 compiled.json，只服务 /legacy 冻结参考基准
lib/compiler/         编译管线
  keyphrase.ts        KeyBERT 式候选词提取
  llm-provider.ts     OpenAI-compatible LLM provider
  mock-provider.ts    确定性 mock provider
  schema.ts            运行时数据校验
  compile.ts           管线编排（含 top-10 收敛）
app/                   Next.js 前端（知乎风格）
scripts/               编译与校验脚本
```
