# Frontend V2 · 架构与并行开发边界

> 版本：2026-09-08 · 分支：`frontend-v2` · 责任人：architect
> 配套：`AGENTS.md`（所有权与协作规则）、`docs/页面流与UX设计.md`（三幕 UX 规格）

这份文档只讲**结构与契约**，不讲视觉与文案。UX 规格以 `docs/页面流与UX设计.md` 为准。

---

## 1. 三幕路由

| 幕 | 路由 | 实现位置 | Owner |
|---|---|---|---|
| 第一幕 登录 / 承诺 | `/` | `app/login/**`（`app/page.tsx` 仅转交） | login-agent |
| 第二幕 编译台 | `/compile` | `app/compile/**` | compiler-ui-agent |
| 第三幕 知识空间 | `/space` | `app/space/**`（画布在 `app/space/graph/**`） | knowledge-space-agent |

`app/page.tsx` 是一行转交，不是实现。这样 login-agent 的写入范围仍然只是 `app/login/**`，不必碰站点根 page。

### 保留的参考实现

| 路由 | 文件 | 说明 |
|---|---|---|
| `/legacy` | `app/knowledge-garden.tsx`（未改动） | 旧三栏阅读视图。唯一一份跑通「概念 → 关系 → 回链 → 阅读路径」完整渲染的代码，第三幕照它取数 |
| `/legacy/compile-mvp` | `app/legacy/compile-mvp/page.tsx` | 旧编译页。它的 NDJSON 流式读取已抽成 `lib/frontend/compile-stream.ts` |

两者都是**只读参考**。不要在 v2 页面里链过去，也不要改 `app/knowledge-garden.tsx`。第三幕稳定后再决定删除。

---

## 2. 共享契约（`lib/frontend/**`）

全部由 architect 维护。feature agent **读，不写**；需要改动走第 5 节的 CCR 流程。

| 文件 | 职责 | 主要导出 |
|---|---|---|
| `routes.ts` | 路由常量，避免三个 agent 各自硬编码 | `ROUTES` |
| `corpora.ts` | 内置预编译语料注册表，id 与旧 `?source=` 一致 | `CORPORA`、`corpusOrDefault`、`findCorpus` |
| `dataset.ts` | `CompiledKnowledgeDataset` 的只读投影层 | 见下表 |
| `graph.ts` | 图谱画布的输入输出契约（**不含实现**） | `GraphData`、`GraphCanvasProps` |
| `compile-stream.ts` | `/api/compile` 的 NDJSON 事件契约 + 阶段映射 | `CompileStreamEvent`、`readCompileStream`、`STAGE_TO_PRODUCT` |
| `handoff.ts` | 编译台 → 知识空间的产物交接 | `saveHandoffDataset`、`readHandoffDataset` |

### 2.1 为什么要投影层 `dataset.ts`

三幕都要问同样的问题：某概念有哪些关系、哪些文章回链、概念怎么按领域分组。若各自实现，**关系方向**与 **article-concept 过滤**的口径一定会分叉——这是最容易出静默 bug 的地方。

| 函数 | 用途 |
|---|---|
| `conceptRelations` / `articleConceptRelations` | 按 kind 切分关系，前者剔除 `article-concept` |
| `conceptsByDomain` / `domains` | 按领域分组，组内按证据文章数 → 置信度 → id 排序（顺序确定） |
| `neighborsOf` | 某概念的邻接关系，带 `direction` 说明它是 source 还是 target |
| `backlinksOf` | 概念回链文章，按发布时间升序 |
| `evidenceQuotesFor` | 去重后的原文引文 |
| `summarize` | 规模统计，编译台完成态与空间作者头共用 |
| `buildGraphData` | 产物 → 图谱数据，默认剔除 `article-concept` 边 |
| `articlesByDate` | 文章按时间升序，供时间轴回放 |

关系方向语义以编译器 `infer-relations.ts` 为准：`prerequisite` 的 source 更基础，`extends` 的 source 更进阶，`related` 无向。

### 2.2 GraphCanvas 契约

architect 只定义 props 形状，**技术选型留给 knowledge-space-agent**（`@xyflow/react`、D3、手写 SVG 均可）。

```ts
interface GraphCanvasProps {
  data: GraphData;                        // { nodes, edges }
  selectedNodeId?: string;                // 高亮该节点及邻边
  visibleDomains?: string[];              // 领域筛选
  highlightedNodeIds?: string[];          // 增量编译的新增节点
  onNodeSelect?: (nodeId: string) => void;
  onEdgeSelect?: (edgeId: string) => void;
}
```

约束：

- 布局坐标**不进契约**。节点位置由画布内部算，调用方只给数据。
- 渲染与布局细节全部留在 `app/space/graph/**` 内部，不外泄到调用方。
- 当前 `app/space/graph/graph-canvas.tsx` 是占位实现，只回显规模与概念按钮，用来证明 `buildGraphData` 的投影是通的。

### 2.3 产物交接

编译产物是运行时算出来的，不在仓库里；第二幕算完、第三幕要读。交接经 `sessionStorage`，key 与旧知识花园相同（`knowledge-compiler:dataset`），因此 legacy 视图也能读到新产物。

读取时用编译器自己的 `assertCompiledKnowledgeDataset` 校验——那是上一次会话写的，可能是旧 schema。校验失败按「没有产物」处理，页面退回内置语料，不空屏。

选 `sessionStorage` 的理由：产物几百 KB 塞不进 URL；当前分支没有账户与数据库，服务端无处存；刷新保留、关标签页即弃，正好符合演示语义。

---

## 3. 共享 hooks（`app/_shared/**`）

| 文件 | 职责 | 使用方 |
|---|---|---|
| `hooks/use-active-dataset.ts` | 决定当前展示哪份产物：`?source=compiled` → 交接产物；`?source=<id>` → 内置语料；否则默认 | knowledge-space-agent |
| `hooks/use-compile.ts` | 驱动 `/api/compile`：流式读取 + 阶段推进 + 自动交接 | compiler-ui-agent |
| `ui/page-shell.tsx` | 三幕共用页面外框（顶栏 + 主内容） | 全部 |
| `ui/stat-grid.tsx` | 规模统计栅格 | compiler-ui / knowledge-space |
| `ui/scaffold-notice.tsx` | 骨架待实现提示，实现完成后删掉引用 | 全部 |

**不要**在页面里直接 `fetch("/api/compile")`，也不要自己写 `sessionStorage`。前者用 `useCompile`，后者由 `useCompile` 内部经 `handoff.ts` 完成。两份实现会导致编译台与知识空间在产物落地时机上对不上。

---

## 4. 编译阶段映射

编译器内部有**五**个阶段，UX 规格的编译台只展示**四**个。差异用显示层映射吸收，不改编译器。

| 内部阶段（`compileKnowledge`） | 产品阶段 | 编译台文案 |
|---|---|---|
| `parsing-articles` | `reading` | 读取创作 |
| `extracting-concepts` | `concepts` | 概念抽取 |
| `resolving-concepts` | `concepts` | （同上，合并算同一件事） |
| `synthesizing-relations` | `relations` | 关系构建 |
| `building-reading-paths` | `graph` | 图谱生成 |

`STAGE_TO_PRODUCT` 与 `PRODUCT_STAGE_COPY` 在 `compile-stream.ts`。**不要为了对齐文案去改编译器的阶段划分。**

进度是**估算**：`estimateProgress` 按阶段位置线性推。实际上抽取阶段的耗时远超其余四段之和，但当前流事件不带「已完成第几篇」，只能这样算。UI 必须呈现为估算，不要写成精确百分比。

---

## 5. 受保护文件与 CCR 流程

以下对 feature agent 只读（沿用 `AGENTS.md`，此处补充 `lib/frontend/**`）：

- `lib/compiler/**` — 编译管线
- `data/models.ts`、`data/**` — 数据模型与语料
- `app/api/**` — 全部 API 路由
- `lib/frontend/**` — 共享前端契约（architect 维护）
- `app/globals.css`、`package.json`、`package-lock.json`、`tsconfig.json`、`next.config.ts`
- `app/knowledge-garden.tsx` — legacy 参考基准

需要改动时不要直接编辑，提 **Contract Change Request**：申请的字段/API 变更、现有契约为何不够、建议形状、受影响的消费方。由 architect 或 compiler-core owner 决定并实施。

### 已知契约缺口

| # | 缺口 | 影响 | 建议 |
|---|---|---|---|
| C1 | `/api/compile` 只发 `stage`/`complete`/`error`，无增量节点与计数事件 | 编译台做不了「星体逐个出现」与阶段实时数字；迷你图谱只能在 `complete` 时一次性拿全量 | compiler-ui-agent 提 CCR，由 compiler-core-agent 扩流（`main` 分支已有类似的 `tick`/`snapshot`/`counts` 设计可参考） |
| C2 | `/api/compile` 的 `POST` 不接受 body，语料硬编码为 `data/demo` | 无法编译 `sujianlin` 语料，也无法编译用户导入的文章 | 需要时提 CCR 加 `{ corpus }` 参数 |
| C3 | 本分支无 `app/api/auth/**` 与知乎 OAuth 路由 | 第一幕登录按钮无法接真实授权，当前 disabled | login-agent 提 CCR，由 compiler-core-agent 提供回调路由 |
| C4 | 没有作者修改的持久层（overlay） | 校对视图与编辑模式的修改无处存 | 设计校对写回时提 CCR |

C1–C4 都**不阻塞**当前三个 feature agent 启动：各自都有可先做完的部分。

---

## 6. 并行边界

`read shared, write isolated`。两个 agent 不得同时写同一个 feature 目录或同一份受保护文件。

```
app/
  page.tsx                    architect（一行转交，冻结）
  login/**                    login-agent
  compile/**                  compiler-ui-agent
  space/**                    knowledge-space-agent
    graph/**                  同上（画布内部，隔离）
  _shared/**                  architect
  knowledge-garden.tsx        冻结（legacy 参考）
  legacy/**                   冻结（legacy 参考）
lib/frontend/**               architect
lib/compiler/**               compiler-core-agent
app/api/**                    compiler-core-agent
data/**                       compiler-core-agent
```

三个 feature agent 的写入范围两两无交集，共享契约只读，因此可以同时启动。
