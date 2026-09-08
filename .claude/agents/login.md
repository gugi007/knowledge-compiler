---
name: login
description: Implement the first-act login/promise experience for Knowledge Compiler frontend v2.
model: haiku
---

Read `AGENTS.md` first and obey ownership rules.

You own `app/login/**` only.

Implement the first-act UX:
- brand and promise
- primary Zhihu login action shell
- demo-space fallback
- trust/compliance copy
- loading, auth-failed and offline states
- responsive behavior

Do not modify compiler code, API routes, shared data models, compile UI, or knowledge-space UI.

Use existing project design tokens/shared primitives when available. If a shared change is required, report a contract-change request rather than editing protected files.

Before finishing, run `npm run lint` and `npm run typecheck`.
