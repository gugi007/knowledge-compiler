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

`data/demo/articles/` 是原始文章输入，`data/demo/compiled.json` 是编译产物。默认使用 deterministic mock provider，不需要 API Key；真实模型只需实现 `ExtractionProvider` 并注入 `compileKnowledge()`。
