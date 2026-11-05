# Repository agent guide

The application is in `deployment-source/vistralo`. Read its `AGENTS.md` before changing application code.

Use a branch and pull request. From the application directory run `npm ci`, `npm run build:server`, `npm test`, `npm run typecheck:web`, `npm run lint:design` and `npm audit --omit=dev` before pushing. `main` requires the "Validate source" check and linear history; a merge deploys the web app to Vercel production.

Never commit credentials, private keys, `.env` files, provider tokens, recordings or user project data. The repository is public.

## Repository home

This repo is `arclayer-ltd/vistralo`. It moved from `Rezx100/vistralo` on 2026-11-06. Old URLs redirect, so never create a repo with this name under Rezx100.

- Remote: `https://github.com/arclayer-ltd/vistralo.git`. If a clone still names the old owner, run `git remote set-url origin` with this URL.
- Access: the `gh` accounts `Rezx100` and `arclayers` both own the org, so pushing and `gh` work with the active login. Repo secrets and variables moved with the repo; never put their values in files.
- Limits: the org is on GitHub's Free plan, with no card on file, so private repos' Actions minutes stop when spent. Public repos are free.
- Deploy: Pushes to `main` that change `deployment-source/vistralo/` deploy app.vistralo.com through `vercel-deploy.yml`, not a Vercel Git link. Commits must be authored by `arclayers <dev@arclayer.co>` (set in repo-local git config), because Vercel Hobby blocks other authors.
