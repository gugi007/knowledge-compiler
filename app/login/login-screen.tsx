import Link from "next/link";
import { DEFAULT_CORPUS_ID } from "@/lib/frontend/corpora";
import { ROUTES } from "@/lib/frontend/routes";
import { KnowledgeGraphBackground } from "./knowledge-graph-background";
import { LoginConnector } from "./login-connector";
import styles from "./login.module.css";

/**
 * 第一幕：登录 / 承诺。
 *
 * OWNER: login-agent（此文件与本目录下所有内容）
 *
 * 版式延续参考页 login.html 的蓝色居中单屏（样式在本地 login.module.css，
 * 配色不进 globals.css），两处产品化调整：
 * - 品牌图标并入顶栏左侧（图标 + Knowledge Compiler 并排），
 *   中央面板不再重复品牌行，直接从主标题开始；
 * - 顶栏右侧只留「概念说明」独立页链接（原 关于/数据说明 一屏页死锚点已删，
 *   弹层方案废弃；页面内容组件在 concepts-page.tsx，路由壳归 architect）；
 * - 「或」分隔线下方放两张并排演示卡（≤768px 堆叠），替掉原单链接：
 *   卡一演示编译（compile + 默认语料，首次编译放左），卡二成熟作者空间
 *   （space + sujianlin 语料）。
 *   「二次编译 / 首次编译 / 新文章」只是入口文案意图，目标页的真实行为
 *   属 app/space、app/compile 的范围，不归本文件。
 *
 * 真功能不变：主登录按钮是 LoginConnector 的真实知乎 OAuth 状态机
 * （loading / ready / connected / offline / error），离线时禁用按钮 + 未配置
 * 提示照旧，两张演示卡作为兜底入口始终可见可点。
 *
 * server component：静态骨架不进客户端 bundle，交互在 LoginConnector，
 * 背景图谱动画在独立客户端 leaf KnowledgeGraphBackground。
 */

/** 「成熟的作者空间」指向的公开演示语料（科学空间，一位成熟作者）。 */
const MATURE_AUTHOR_CORPUS_ID = "sujianlin";
/** 「演示编译空间」首次编译用的语料：默认演示语料（LLM 综述样例）。 */
const DEMO_COMPILE_CORPUS_ID = DEFAULT_CORPUS_ID;

export function LoginScreen() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIcon}>
            <svg aria-hidden viewBox="0 0 24 24">
              <line stroke="white" strokeWidth="1.5" x1="6" x2="12" y1="12" y2="7" />
              <line stroke="white" strokeWidth="1.5" x1="12" x2="18" y1="7" y2="12" />
              <line
                stroke="white"
                strokeDasharray="2 2"
                strokeWidth="1.5"
                x1="12"
                x2="13"
                y1="7"
                y2="17"
              />
              <circle cx="6" cy="12" fill="white" r="2.6" />
              <circle cx="12" cy="7" fill="white" r="2.6" />
              <circle cx="18" cy="12" fill="white" r="2.6" />
              <circle cx="13" cy="17" fill="white" r="2.2" />
            </svg>
          </div>
          <div className={styles.headerLogo}>Knowledge Compiler</div>
        </div>
        {/* 整页一屏无滚动，原 #about/#data 死锚点已移除；
            「概念说明」跳独立页（concepts-page.tsx，路由常量 ROUTES.concepts） */}
        <nav className={styles.headerNav}>
          <Link className={styles.headerLink} href={ROUTES.concepts}>
            概念说明
          </Link>
        </nav>
      </header>

      <main className={styles.main}>
        {/* 背景装饰知识图谱（缓慢漂移/呼吸的活背景，见 knowledge-graph-background.tsx）。
            坐标与线型仍照搬参考页；纯装饰不进朗读顺序，pointer-events 为 none 不挡交互。
            overflow 裁切只作用于 .main 里的这张 SVG，真实内容超一屏时随文档滚动。 */}
        <KnowledgeGraphBackground />

        <section className={styles.panel}>
          {/* 主标题 / 副标题 */}
          <h1 className={styles.title}>登录知乎，编译你的知识宇宙</h1>
          <p className={styles.subtitle}>把多年创作，编译成一张持续生长的知识网络</p>

          {/* 主登录按钮与真实状态机：查 status、跳 OAuth、失败/离线降级、演示退路 */}
          <LoginConnector />

          {/* 「或」分隔线：保持干净，不掺演示内容 */}
          <div className={styles.divider}>
            <span className={styles.dividerLine} />
            <span className={styles.dividerText}>或</span>
            <span className={styles.dividerLine} />
          </div>

          {/* 演示入口双卡：不登录也能先看空间 / 先跑一次演示编译（真实路由 + 真实语料）。
              卡片文案只承诺意图，目标页是否体现「有新文章 / 首次编译」由 space/compile 侧负责。 */}
          <div className={styles.demoCards}>
            <Link
              className={styles.demoCard}
              href={`${ROUTES.compile}?corpus=${DEMO_COMPILE_CORPUS_ID}`}
            >
              <span className={styles.demoCardHead}>
                <span className={styles.demoCardTitle}>演示编译空间</span>
                <span aria-hidden className={styles.demoCardArrow}>
                  →
                </span>
              </span>
              <span className={styles.demoCardSub}>首次编译 · 体验完整编译流程</span>
            </Link>
            <Link
              className={styles.demoCard}
              href={`${ROUTES.space}?source=${MATURE_AUTHOR_CORPUS_ID}`}
            >
              <span className={styles.demoCardHead}>
                <span className={styles.demoCardTitle}>成熟的作者空间</span>
                <span aria-hidden className={styles.demoCardArrow}>
                  →
                </span>
              </span>
              <span className={styles.demoCardSub}>二次编译 · 进入即见新文章</span>
            </Link>
          </div>

          {/* 权限 / 合规说明 */}
          <div className={styles.trustInfo}>
            <div>只读取你公开范围的创作数据 · 不复制内容，只编译观点</div>
            <div>数据仅用于编译你的知识空间，可随时断开授权</div>
          </div>
        </section>
      </main>
    </div>
  );
}
