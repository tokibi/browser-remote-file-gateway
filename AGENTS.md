# Development setup

- Use Node.js 22 or later and the pnpm version declared in `package.json`.
- Before making changes, install dependencies with `corepack pnpm install --frozen-lockfile`, then run `node --run prek:install`. Install the hook even when dependencies were already present or installed with `--ignore-scripts`.
- Commit through the installed pre-commit hook so lint, formatting, and Fallow run. Fix failures before committing; do not bypass the hook unless the user explicitly requests it.
