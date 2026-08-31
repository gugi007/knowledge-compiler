# Knowledge Compiler — 产品定义

## 一句话产品

Knowledge Compiler 把创作者多年按时间散落的文章，编译成一个可探索、可回溯、持续生长的个人知识网络。

## 核心用户与问题

第一阶段服务长期写作的技术创作者及其读者。文章平台擅长呈现时间线，却不能说明知识之间的依赖、延伸和复用关系。读者很难知道从哪里开始、下一篇读什么；作者也很难看清自己已经形成的知识体系。

## MVP 输入与输出

输入是一位创作者的一组离线文章。输出包括：

- Concepts：从文章中沉淀出的稳定知识单元。
- Article–Concept Relations：文章讨论了哪些概念。
- Concept–Concept Relations：概念间的 prerequisite、related、extends 关系。
- Personal Wiki：以概念而非时间为入口浏览内容。
- Reading Paths：面向明确目标的有序阅读路线。
- Backlinks：从概念回到所有相关文章。
- Knowledge Graph：辅助理解全局关系的轻量视图。

## 首个体验

用户打开 Knowledge Garden，首先看到创作者、文章与概念规模，以及知识领域。选择任一概念后，可以立即理解概念摘要、前置知识、相关概念、相关文章和推荐阅读路线。图谱用于提供方位感，不替代 Wiki 阅读。

## 数据模型

### Creator

创作者身份与知识领域，关联其全部文章。

### Article

原始内容单元，包含标题、摘要、发布日期、阅读时长与来源链接。文章和概念的连接由 Relation 表达。

### Concept

可独立解释的知识单元，包含摘要、领域、层级、别名、置信度、证据文章与可选父概念。

### Relation

统一表达 article-concept、prerequisite、related、extends 四类连接。sourceId 与 targetId 指向 Article 或 Concept；prerequisite 表示 source 是 target 的前置知识，extends 表示 source 扩展 target。每条关系必须带 confidence 和 evidence，可选 reasoning 用于保留推断说明。

### ReadingPath

围绕一个学习目标组织的有序概念与文章列表。

## 当前边界

当前版本从仓库内的原始文章 JSON 离线编译知识模型。流水线依次完成 ingest、article-level extraction、deterministic normalization、可选 provider-assisted resolution、corpus-level synthesis、relation inference 与 reading path generation。默认 deterministic mock provider，无 API Key 也能复现完整 Demo；真实 LLM 通过同一 provider interface 接入，核心业务不绑定模型厂商。

暂不包含实时抓取、账户系统、浏览器插件、Multi-Agent、GraphRAG、数据库与其他内容平台接入。知乎只是第一阶段的内容语境，不进入核心数据模型。

## 成功标准

首次访问者能在一分钟内感受到从“18 篇时间线文章”到“有层级、有路径、有回链的知识花园”的变化，并能从任意概念找到下一步阅读内容。
