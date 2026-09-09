import { CompileWorkspace } from "./compile-workspace";

/**
 * 第二幕：编译台。
 *
 * OWNER: compiler-ui-agent（本目录下所有内容）
 *
 * 旧的编译 MVP 页面已移到 /legacy/compile-mvp 作参考保留，
 * 它演示了完整的 NDJSON 流式读取（现已抽成 lib/frontend/compile-stream.ts）。
 */
export default function CompilePage() {
  return <CompileWorkspace />;
}
