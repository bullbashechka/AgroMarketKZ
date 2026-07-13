# Repository Guidelines

## Project Structure & Module Organization

AgroMarketKZ is a Bun workspace monorepo. `backend/` contains the Hono API: routes live in `src/routes`, database access in `src/repos`, shared server utilities in `src/lib`, and unit tests in `backend/tests`. `webapp/` is the React/Vite Telegram Mini App; place reusable UI in `src/components`, screens in `src/screens`, client helpers in `src/lib`, and CSS in `src/styles`. Shared Zod schemas and TypeScript types belong in `packages/contracts/src`; consumers should import them from `@agromarket/contracts`. SQL migrations and development seed data are under `database/`. Browser journeys live in `e2e/tests`, with fixtures and helpers in adjacent directories. Product documentation is maintained in `PRD.md`, `TASKS.md`, and `USER_FLOW.md`.

## Build, Test, and Development Commands

- `bun install` installs all workspace dependencies.
- `bun run dev` builds contracts, then watches contracts, backend (`:3000`), and webapp (`:5173`).
- `bun run dev:backend` or `bun run dev:webapp` runs one application only.
- `bun run typecheck` checks strict TypeScript across all workspaces.
- `bun test` runs Bun unit tests in contracts and backend.
- `bun run test:e2e` runs Playwright E2E tests in Chromium and starts/reuses local servers.
- `bun run build` creates production builds for every package.
- `bun run db:migrate` applies ordered SQL migrations; `bun run db:seed:dev` loads optional demo data.

## Coding Style & Naming Conventions

Use TypeScript ES modules, two-space indentation, double quotes, semicolons, and trailing commas where the surrounding code uses them. Keep strict types; avoid `any` and validate API boundaries with shared Zod contracts. Name React components and screens in `PascalCase.tsx`, helpers in `camelCase.ts`, and tests as `*.test.ts`; Playwright specs use `*.spec.ts`. No repository-wide formatter or linter is configured, so match nearby code and run `bun run typecheck` before submitting.

## Testing Guidelines

Add focused Bun tests beside the relevant workspace tests. E2E cases use a shared development Supabase instance and intentionally run with one worker; configure the root `.env` from `.env.example` before running them. There is no declared coverage threshold, but new behavior and bug fixes should include regression coverage.

## Commit & Pull Request Guidelines

History generally follows Conventional Commits, for example `feat(webapp): add catalog filters`, `chore(infra): update tunnel config`, or `docs(tasks): mark stage complete`. Keep commits scoped and imperative. Pull requests should explain the user-visible change, list validation commands, link the relevant issue/task, note migrations or environment changes, and include screenshots for UI work. Never commit `.env`, credentials, Playwright reports, or generated `dist/` output.
