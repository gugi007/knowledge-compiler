# Knowledge Compiler

把创作者按时间散落的文章，编译成可探索的个人知识网络。

需要 Node.js 22.18 或更高版本。

## 本地运行

```bash
npm install
npm run compile:demo
npm run dev
```

打开 <http://localhost:3000>。

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

默认 `DeterministicMockProvider` 不需要 API Key，用于离线 Demo 和回归校验。真实模型实现 provider-independent 的 `ExtractionProvider`：`extract()` 负责单篇抽取，`resolveConcepts()` 可合并语义等价概念，`synthesizeCorpus()` 可推断跨文章关系。
