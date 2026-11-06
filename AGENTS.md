# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the React UI (`components/`), client logic (`lib/`), and styles. `api/` holds Vercel function entry points; `server/` contains validation, receipt, and Drive logic. SQL migrations live in `supabase/`. PWA and receipt assets are in `public/`; scripts are in `scripts/`, and guides are in `docs/`. Place Vitest files in `tests/*.test.ts` and Playwright flows in `tests/browser/*.spec.ts`.

## Build, Test, and Development Commands

Use Node.js 22.13+ or 24 and install locked dependencies with `npm ci`.

- `npm run dev` starts Vite at `http://localhost:5173`; without Supabase settings it runs the in-memory demo.
- `npm run typecheck` checks TypeScript without emitting files.
- `npm run build` typechecks, builds `dist/`, and generates the service worker.
- `npm test` runs all Vitest unit and integration tests; `npm run db:test` selects database-related tests.
- `npm run test:e2e` runs Playwright against a locally started Vite server. Set `CHROMIUM_PATH` if Chromium is not at `/usr/bin/chromium`.
- `npm run preview` serves the build; with it running, `npm run test:pwa` checks offline/PWA behavior.

## Coding Style & Naming Conventions

Use strict TypeScript, React function components, two-space indentation, single-quoted imports/strings, and semicolons where surrounding code uses them. Name components in `PascalCase.tsx`, utilities in descriptive lowercase or kebab-case `.ts` files, and tests after the behavior or module they cover. Keep browser code in `src/` and privileged operations in `api/` or `server/`. There is no configured formatter or lint command; follow adjacent code and run `npm run typecheck`.

## Testing Guidelines

Add Vitest coverage for changed business rules, API validation, and database behavior; add Playwright coverage for affected user flows. Browser tests use the demo, while database tests use embedded PGlite rather than a remote project. Run `npm test`, `npm run build`, and relevant browser tests before opening a PR. No numeric coverage threshold is configured.

## Commit & Pull Request Guidelines

Recent commits use concise imperative subjects with prefixes such as `feat:` and `fix:`; follow that pattern. In PRs, describe the behavior changed, list verification commands, link relevant issues, and include screenshots for UI changes. Call out any new Supabase migration or environment variable. Add a new migration instead of editing one already applied.

## Security & Configuration

Copy `.env.example` to `.env` for local configuration. Never commit `.env`, operational exports, signatures, or private keys. `VITE_` variables are browser-visible: keep `SUPABASE_SECRET_KEY`, Drive secrets, and other privileged credentials server-only.
