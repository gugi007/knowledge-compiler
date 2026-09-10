import Link from "next/link";
import { ROUTES } from "@/lib/frontend/routes";
import styles from "./login.module.css";

/**
 * 「概念说明」独立页（第一幕附属内容，登录-agent ownership）。
 *
 * 纯静态 server component：返回栏 + 居中阅读列，知乎风（复用 login.module.css
 * 的 .page 局部变量与 concepts* 内容类）。路由壳 `app/concepts/` 由 architect
 * 挂接并转交本组件，本文件不自建路由。
 *
 * 正文理念文与原弹层逐字一致（仅浮层专属物——✕/aria-modal/遮罩——移除，
 * h2 标题改页面 h1）；返回用 ROUTES.login（常量表中 "/" 的键名是 login，
 * 不存在 home 键）。本页不需要背景图谱动画，保持阅读干净。
 */
export function ConceptsPage() {
  return (
    <div className={styles.page}>
      <header className={styles.conceptsTopbar}>
        <Link className={styles.conceptsBack} href={ROUTES.login}>
          ← 返回首页
        </Link>
        <span className={styles.conceptsBrand}>Knowledge Compiler</span>
      </header>

      <main className={styles.conceptsPage}>
        <article className={styles.conceptsCol}>
          <h1 className={styles.conceptsTitle}>概念说明</h1>

          <p className={styles.conceptsLead}>
            Knowledge Compiler（知识编译器）—— 将创作者多年积累的知乎内容，自动编译成一张持续生长的知识网络。
          </p>

          <p className={styles.conceptsPara}>
            知乎已经拥有成熟的长内容创作体验，也沉淀了大量持续创作数年、甚至十余年的优质作者的优秀创作内容。
          </p>

          <p className={styles.conceptsPara}>
            不夸张的说，知乎是中文互联网最好的长内容创作和阅读体验。但今天，当一个作者写下几十篇、几百篇内容以后，这些创作仍然主要按照发布时间被组织。
          </p>

          <p className={styles.conceptsPara}>
            但对创作者本人来说，它们其实是一个不断生长的知识体系。一个观点可能在三年前第一次出现，两年前被补充，一年前被修正，今天又成为另一篇文章的前置知识。可当这些内容被放回时间流以后，文章之间原本存在的知识关系便很难再被看见。
          </p>

          <p className={styles.conceptsPara}>
            Knowledge Compiler 想解决的，就是这个问题。它利用大语言模型理解作者过去的创作，自动提取其中的核心概念、主题、前置知识以及文章之间的关联，并将原本线性的内容重新组织为：
          </p>

          <ul className={styles.conceptsTerms}>
            <li>
              <span className={styles.conceptsTerm}>Concepts</span>
              （概念）
            </li>
            <li>
              <span className={styles.conceptsTerm}>Relations</span>
              （关联）
            </li>
            <li>
              <span className={styles.conceptsTerm}>Backlinks</span>
              （反向链接）
            </li>
            <li>
              <span className={styles.conceptsTerm}>Reading Paths</span>
              （阅读路径）
            </li>
            <li>
              <span className={styles.conceptsTerm}>Knowledge Graph</span>
              （知识图谱）
            </li>
          </ul>

          <p className={styles.conceptsPara}>
            对创作者来说，不再需要花费大量时间手动分类、整理和维护自己多年积累的内容。作者只需要继续创作，AI
            负责让已有知识持续连接和生长。
          </p>

          <p className={styles.conceptsPara}>
            对读者来说，也不再只是按照时间顺序翻阅一个人的文章，而是可以沿着某个概念，看到作者在不同阶段、不同视角下对同一问题的理解，以及这些观点之间如何互相延伸、补充甚至发生变化。
          </p>

          <p className={styles.conceptsBeforeAfter}>
            <span>从「这个作者写过什么？」</span>
            <span aria-hidden className={styles.conceptsBeforeAfterArrow}>
              ↓
            </span>
            <span>进一步变成「在作者视角中知识是如何联系的？」</span>
          </p>

          <p className={styles.conceptsPara}>
            我们认为，内容是知乎最重要的资产之一。在人工智能时代，平台不仅能够帮助创作者生产内容，还能够帮助他们重新连接、组织和激活多年积累的内容资产，这些历史创作就不再只是沉在时间线里的旧文章，而会成为一个可以持续探索、持续学习、持续生长的知识世界。
          </p>

          <div className={styles.conceptsHighlight}>
            <p>作者负责创造知识，AI 负责组织知识。</p>
            <p>让文章不再沉底，让知识持续生长。</p>
          </div>
        </article>
      </main>
    </div>
  );
}
