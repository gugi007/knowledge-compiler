import { KnowledgeGarden } from "../knowledge-garden";

/**
 * 旧三栏阅读视图的参考实现，原挂在 `/`。
 *
 * 保留原因：它是唯一一份已经跑通「概念 → 关系 → 回链 → 阅读路径」
 * 完整渲染的代码，knowledge-space-agent 做第三幕时要照着它看数据怎么用。
 *
 * 不要在 v2 页面里链到这里，也不要改 app/knowledge-garden.tsx —— 它是参考基准。
 * 第三幕稳定之后再决定删除。
 */
export default function LegacyGardenPage() {
  return <KnowledgeGarden />;
}
