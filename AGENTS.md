# AGENTS.md

Devvit (Reddit developer platform) app that creates, stickies and rotates megathreads for /r/ukpolitics. Moderators configure it with YAML on the wiki page `stickymgr/config`; [README.md](README.md) is the moderator-facing config reference.

## Done

A change is done when every step in [.github/workflows/test.yml](.github/workflows/test.yml) passes locally.

Behaviour on Reddit itself is only verifiable with `npx devvit playtest`, which needs the user's Reddit login: hand that step to the user, naming what to exercise.

## Devvit

- Docs: <https://developers.reddit.com/docs/llms.txt>. They lag the code; where they disagree with the `.d.ts` files under `node_modules/@devvit/`, the installed types win.
- This is a Blocks app on `@devvit/public-api`: handlers register in [src/main.ts](src/main.ts), wired by `blocks.entry` in [devvit.json](devvit.json). Reddit has deprecated this model for `@devvit/web` but still supports it. New code follows the existing pattern; moving to `@devvit/web` is its own deliberate job.
- `@devvit/protos`, `@devvit/public-api`, `@devvit/test` and `devvit` are pinned to one exact version and upgrade together.
- `@devvit/public-api` re-exports `@devvit/reddit` as types only. A TS1362 error on a Devvit enum means it has no runtime value; `MODS_ONLY` in [src/installTasks.ts](src/installTasks.ts) shows the workaround.
- Thing-ID helpers (`asT5ID`, `isT3ID`, …) import from `@devvit/public-api/types/tid.js`; the package root does not export them.

## Live state

Redis key strings (in [src/config.ts](src/config.ts) and [src/stickyManager.ts](src/stickyManager.ts)) and scheduler job names (in [src/constants.ts](src/constants.ts)) hold state in every subreddit the app is installed on. Keep them stable: a renamed key orphans its data on the next upgrade unless `handleAppUpgrade` migrates it.

## Config fields

A config field lives in four places that change together: the `Config` interface and the ajv `configSchema` in [src/config.ts](src/config.ts), the commented sample written to the wiki in [src/installTasks.ts](src/installTasks.ts), and the README's configuration rules and reference table.

## Dependencies

- TypeScript stays on 6.0.x until `typescript-eslint`'s peer range admits 7 (`@vitest/eslint-plugin` also needs ≥6).
- Security fixes: `npm audit fix`, and Devvit upgrades to its `latest` dist-tag. `npm audit fix --force` breaks the project: it installs `devvit@1.0.0`, a 2022 placeholder, and downgrades ESLint.
- As of November 2026 the remaining audit findings sit inside Devvit's own packages (old `minimatch` via `twirp-ts`; `tmp` via the CLI) with no fixed release. Recheck them on each Devvit upgrade.
- npm reports blocked install scripts for `esbuild`, `protobufjs` and `core-js`. Build and tests work without them; leave them unapproved.

## Git

Commits are authored and committed as `ivashkin-reddit <ivashkin.r@pm.me>`; pushes and `gh` calls run as the `ivashkin-reddit` GitHub account. Local hooks enforce this: when one rejects, correct the identity and retry.
