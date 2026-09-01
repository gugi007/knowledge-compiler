# Knowledge Compiler

把创作者按时间散落的文章，编译成可探索的个人知识网络。

需要 Node.js 22.18 或更高版本。

## 本地运行

```bash
npm install
npm run compile:demo
npm run dev
```

打开 <http://localhost:3000> 查看 Knowledge Garden，或打开 <http://localhost:3000/compile> 运行可见的编译流程。

## Mock Demo

默认使用 `DeterministicMockProvider`：

```bash
npm run compile:demo
npm run dev
```

Mock 模式不需要 API Key，用于离线 Demo、固定回归结果和数据校验。它依赖 curated lexicon，不属于真实 AI extraction。

## Real LLM

复制 `.env.example` 为 `.env.local`，填写 OpenAI-compatible Chat Completions 服务：

```dotenv
KNOWLEDGE_COMPILER_PROVIDER=llm
LLM_BASE_URL=https://api.example.com/v1
LLM_API_KEY=your-api-key
LLM_MODEL=your-model
```

然后运行：

```bash
npm run compile:demo
npm run dev
```

Provider 使用标准 `fetch` 调用 `${LLM_BASE_URL}/chat/completions`，不依赖 OpenAI SDK。模型只生成 extraction、resolution 和 synthesis 阶段的严格 JSON；runtime validation 通过后，仍由 Compiler domain pipeline 生成最终 dataset。缺少任一 LLM 配置时会直接返回清晰错误。

## 检查

```bash
npm run compile:demo
npm run validate:data
npm run lint
npm run typecheck
npm run build
```

## Compiler

`data/demo/articles/` 是原始文章输入，`data/demo/compiled.json` 是编译产物。编译流程包含 article extraction、两层 concept resolution、corpus synthesis、relation inference 与 reading path generation。

`extract()` 负责单篇抽取，`resolveConcepts()` 只处理 alias 产生的候选合并，`synthesizeCorpus()` 推断跨文章关系。canonical slug 或 canonical name 完全一致时才 deterministic hard merge；泛化 alias 不会直接合并概念。`related` 关系按 endpoint 排序去重，方向关系保持原方向。
