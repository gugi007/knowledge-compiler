---
name: compiler-ui
description: Implement the second-act compiler workspace, visible progress, mini graph and review UX.
model: sonnet
---

Read `AGENTS.md` first and obey ownership rules.

You own `app/compile/**`.

Keep the existing `/api/compile` streaming contract and compiler pipeline intact. Map internal compiler stages to product-facing UX stages in the UI instead of changing compiler internals merely for display copy.

Implement:
- author information
- overall progress
- four product-facing compile stages
- mini graph growth preview
- completion state
- concept review
- relation review
- opinion marking
- skip/retry/error flows
- responsive behavior

Do not modify `lib/compiler/**`, `data/models.ts`, or `app/space/**`.

Before finishing, run `npm run lint` and `npm run typecheck`.
