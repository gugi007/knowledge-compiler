import type { ProductStage } from "@/lib/frontend/compile-stream";

/**
 * 编译台本幕的展示辅助（纯函数）。
 *
 * OWNER: compiler-ui-agent
 *
 * 设计决策：
 * - COMPILE_STEP_LABELS 是 stepper 文案的本地第三版：与共享契约
 *   PRODUCT_STAGE_COPY（lib/frontend/compile-stream.ts）语义对应但不 import，
 *   因为这里按知乎风参考稿重写了措辞（如「读取创作」而非「读取全部创作」），
 *   契约侧文案保持不变。
 * - domainTone 目前在本幕没有调用点：参考稿的 chips 圆点是单色（.chipDot
 *   回落到 var(--blue)），领域色不在校对视图里出现。定义保留以便复用。
 *   第三幕真正的图谱画布在
 *   app/space/graph/** 里有自己的配色实现（domain-colors.ts），
 *   两边不同步不构成契约漂移——画布配色不是共享契约。
 * - 旧的迷你星图投影（toMiniStar/MiniStar）随 MiniStarMap 一起退役：
 *   参考稿完成页没有星图位置。
 */

export interface DomainTone {
  /** chips 圆点填充。 */
  solid: string;
  /** 星区铺底（旧星图遗物，暂保留以免调色板语义丢失）。 */
  soft: string;
}

const TONES: readonly DomainTone[] = [
  { solid: "#0066ff", soft: "rgba(0, 102, 255, 0.10)" },
  { solid: "#7c6cff", soft: "rgba(124, 108, 255, 0.12)" },
  { solid: "#12a182", soft: "rgba(18, 161, 130, 0.12)" },
  { solid: "#e8890c", soft: "rgba(232, 137, 12, 0.12)" },
  { solid: "#d4477c", soft: "rgba(212, 71, 124, 0.12)" },
  { solid: "#5b6b7f", soft: "rgba(91, 107, 127, 0.12)" },
];

export function domainTone(domain: string): DomainTone {
  let hash = 0;
  for (const char of domain) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return TONES[hash % TONES.length]!;
}

/**
 * 四步 stepper 的本地文案表（第三版措辞，见文件头说明）。
 * 顺序即产品阶段顺序，与 PRODUCT_STAGES 一一对应。
 */
export const COMPILE_STEP_LABELS: Record<ProductStage, string> = {
  reading: "读取创作",
  concepts: "识别核心概念",
  relations: "建立关系并锚定原文",
  graph: "生成阅读路径",
};
