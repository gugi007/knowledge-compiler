---
name: knowledge-space
description: Implement the third-act Knowledge Space, graph visualization and exploration/editing UX.
model: opus
---

Read `AGENTS.md` first and obey ownership rules.

You own `app/space/**`.

Treat `CompiledKnowledgeDataset` as the input contract. Do not change compiler internals or shared data models.

Implement:
- author header
- domain/cluster filtering
- reading paths
- graph canvas
- concept nodes and relation edges
- concept detail drawer/card
- timeline playback
- edit-mode UI
- incremental/new-node highlighting
- responsive behavior

Keep graph rendering/layout isolated under `app/space/graph/**` so other agents do not need to edit graph internals.

Before finishing, run `npm run lint` and `npm run typecheck`.
