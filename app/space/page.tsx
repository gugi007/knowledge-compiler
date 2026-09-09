import { SpaceView } from "./space-view";

/**
 * 第三幕：知识空间。
 *
 * OWNER: knowledge-space-agent（本目录下所有内容，含 graph/**）
 *
 * 数据来源由 `?source=` 决定：内置语料 id，或 `compiled` 表示读取
 * 编译台刚交接过来的产物。解析逻辑在 app/_shared/hooks/use-active-dataset.ts。
 */
export default function SpacePage() {
  return <SpaceView />;
}
