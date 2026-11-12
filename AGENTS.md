# Agent Instructions

These instructions apply to the entire repository.

## Project

- This is a Wox dictionary plugin targeting Node.js 22 or newer.
- JavaScript source lives in `src/`; tests in `tests/` use Node's built-in test runner.
- Reuse the existing npm scripts, ESLint, Prettier, and `just` recipes.
- Keep changes focused, preserve existing behavior, and update related documentation.

## Commit convention

- Every commit must follow Conventional Commits:
  `<type>[optional scope][!]: <description>`.
- Use `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
  `chore`, or `revert` as the type.
- Write a concise, imperative description, for example:
  `fix(dictionary): handle missing pronunciation`.
- Mark breaking changes with `!` before the colon or a `BREAKING CHANGE:` footer
  explaining the incompatibility and migration.
- Keep each commit focused on one logical change. Review the staged diff and
  exclude unrelated changes and secrets.
- Create commits only when requested. Preserve required commit trailers.

## Required checks

Before handing off changes or creating a commit:

1. Format changed, Prettier-supported files:
   `npx prettier --write <changed-files>`.
   Do not reformat unrelated files.
2. Run `just check` from the repository root. It runs:
   - `npx prettier --check .`
   - `npm run lint`
   - `npm test`
   - `npm run package`
3. If `just` is unavailable, run all four commands above individually. Every
   command must pass; linting or formatting alone does not replace tests.
4. If checks or hooks modify files, review the changes and rerun the checks before
   committing.

Add or update deterministic tests for changed behavior, including relevant error
cases. Mock external services instead of depending on live dictionary APIs.
Use existing tools; do not add dependencies or suppress checks just to pass.
ESLint currently covers JavaScript in `src/` and `tests/`; do not claim it checks
other file types.

If a check fails or cannot run, report the exact command and reason. Fix failures
caused by your changes; do not claim validation succeeded or create a commit while
required checks remain unresolved.

In the final handoff, summarize the changes and list the checks run and their
results. These instructions guide agents; they do not install Git hooks or enforce
commit messages for non-agent contributors.
