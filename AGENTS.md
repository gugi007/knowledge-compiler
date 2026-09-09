

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Knowledge Compiler · Frontend V2 Multi-Agent Rules

## Goal

Keep the existing compiler/data pipeline stable while rebuilding the product UI as a three-act flow:

1. Login / promise
2. Compiler workspace / visible progress + review
3. Knowledge Space / exploration + growth

The compiler is a protected subsystem. Feature agents consume its contracts; they do not redesign it casually.

## Mandatory checks

Before finishing any code task, run:

- `npm run lint`
- `npm run typecheck`

Compiler-core changes must also run:

- `npm run compile:demo`
- `npm run validate:data`

Integration work must run all of the above plus:

- `npm run build`

## Protected shared files

The following files are read-only to feature agents unless the task explicitly assigns them:

- `data/models.ts`
- `app/globals.css`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `next.config.ts`
- `app/api/compile/route.ts`
- `lib/compiler/**`
- `lib/frontend/**` — shared frontend contracts (architect-owned)
- `app/_shared/**` — shared hooks and UI primitives (architect-owned)
- `app/page.tsx` — one-line handoff to `app/login/**`, frozen
- `app/knowledge-garden.tsx`, `app/legacy/**` — legacy reference, frozen

## Frontend V2 structure

Routes and contracts are specified in `docs/frontend-v2-architecture.md`. Read it before writing frontend code.

| Act | Route | Implementation | Owner |
|---|---|---|---|
| 1 · login | `/` | `app/login/**` | login-agent |
| 2 · compiler workspace | `/compile` | `app/compile/**` | compiler-ui-agent |
| 3 · knowledge space | `/space` | `app/space/**` | knowledge-space-agent |

`app/page.tsx` only re-exports the login screen, so act 1 stays inside `app/login/**`.

Consume shared contracts from `lib/frontend/**` (dataset projections, graph canvas props, compile stream events, dataset handoff) and shared hooks from `app/_shared/**`. Do not re-implement dataset traversal, `/api/compile` fetching, or `sessionStorage` access locally — duplicated implementations drift.

## Ownership

### architect

May modify project structure, shared contracts, agent rules, and migration scaffolding during architecture/integration phases only.

Do not redesign compiler behavior unless the task explicitly requires it.

### login-agent

WRITE:
- `app/login/**`
- login-specific components colocated under that directory

READ:
- `data/**`
- `docs/**`
- shared frontend contracts/components

DO NOT WRITE:
- `lib/compiler/**`
- `app/api/**`
- `app/compile/**`
- `app/space/**`
- `data/models.ts`

### compiler-ui-agent

WRITE:
- `app/compile/**`
- compiler UI-specific components/hooks colocated under that directory

READ:
- `app/api/compile/**`
- `lib/compiler/compile.ts`
- `data/models.ts`

DO NOT WRITE:
- `lib/compiler/**`
- `data/models.ts`
- `app/space/**`

Internal compiler stages may be mapped to product-facing UX stages in the UI. Do not modify the compiler pipeline only to match display copy.

### knowledge-space-agent

WRITE:
- `app/space/**`

READ:
- `data/**`
- `lib/compiler/schema.ts`
- shared frontend contracts/components

DO NOT WRITE:
- `lib/compiler/**`
- `app/api/**`
- `app/compile/**`
- `data/models.ts`

Treat `CompiledKnowledgeDataset` as the primary input contract.

### compiler-core-agent

WRITE:
- `lib/compiler/**`
- `app/api/**`
- `scripts/**`
- `data/models.ts` when a contract change is explicitly approved

DO NOT WRITE:
- `app/login/**`
- `app/compile/**`
- `app/space/**`

Preserve deterministic validation, evidence anchoring, and provider boundaries.

### integration-agent

May modify cross-feature frontend code only during the integration phase. Prefer adapters and small integration fixes over feature rewrites.

## Contract change protocol

If a feature agent needs a shared type/API change, do not edit the protected contract directly. Report:

- requested field/API change
- why the current contract is insufficient
- proposed shape
- affected consumers

The architect/compiler-core owner decides and applies the shared change.

## Concurrency rule

Parallel agents should follow **read shared, write isolated**. Two agents must not concurrently edit the same feature directory or protected shared file.
