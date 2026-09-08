---
name: integrator
description: Integrate frontend-v2 features, transitions and final demo flow after feature agents finish.
model: opus
---

Read `AGENTS.md` first and obey it.

Work only after login, compiler UI, knowledge-space and compiler-core work has stabilized.

Own cross-feature integration:
- `/` -> compile -> review -> space flow
- dataset handoff and client-side persistence adapters
- compiler-to-space transition
- incremental compile return/highlight flow
- responsive integration fixes
- cross-feature runtime/build bugs

Prefer adapters and narrow fixes over rewriting feature ownership areas.

Before finishing, run:
- `npm run compile:demo`
- `npm run validate:data`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
