# AGENTS.md

Devvit (Reddit developer platform) app that creates, stickies and rotates megathreads for /r/ukpolitics. Moderators configure it with YAML on the wiki page `stickymgr/config`; [README.md](README.md) is the moderator-facing config reference.

## Done

A change is done when every step in [.github/workflows/test.yml](.github/workflows/test.yml) passes locally.

Behaviour on Reddit itself is only verifiable with `npx devvit playtest`, which needs the user's Reddit login: hand that step to the user, naming what to exercise.

## Devvit

- Docs: <https://developers.reddit.com/docs/llms.txt>. They lag the code; where they disagree with the `.d.ts` files under `node_modules/@devvit/`, the installed types win.
- This is a Blocks app on `@devvit/public-api`: handlers register in [src/main.ts](src/main.ts), wired by `blocks.entry` in [devvit.json](devvit.json). Reddit has deprecated this model for `@devvit/web` but still supports it. New code follows the existing pattern; moving to `@devvit/web` is its own deliberate job.
- `@devvit/protos`, `@devvit/public-api`, `@devvit/reddit`, `@devvit/redis`, `@devvit/scheduler`, `@devvit/test` and `devvit` are pinned to one exact version and upgrade together.
- `@devvit/public-api` re-exports `@devvit/reddit` as types only. A TS1362 error on a Devvit enum means it has no runtime value; `MODS_ONLY` in [src/configuration/configPageInstall.ts](src/configuration/configPageInstall.ts) shows the workaround.
- Thing-ID helpers (`asT5ID`, `isT3ID`, …) import from `@devvit/public-api/types/tid.js`; the package root does not export them.

## Architecture

A modular monolith with one bounded context, managed threads; [docs/adr/0001-modular-monolith-with-capability-modules.md](docs/adr/0001-modular-monolith-with-capability-modules.md) records why. [CONTEXT.md](CONTEXT.md) is its glossary: name code, logs and modmail with its terms.

- The modules under `src/`, in dependency order: `platform`, `notifications`, `configuration`, `rotation`. Each imports only modules before it, and only through their `index.ts`, whose header comment says what the module owns. The files directly under `src/` are the Devvit edge: [src/main.ts](src/main.ts) registers the handlers in [src/triggers.ts](src/triggers.ts), which turn events into module calls.
- Domain files hold the rules as plain functions over plain values: [threadConfig.ts](src/configuration/threadConfig.ts), [titleTemplate.ts](src/configuration/titleTemplate.ts) and [rotationRules.ts](src/rotation/rotationRules.ts). New rules go there, taking what they need as arguments.
- [eslint/architecture.mjs](eslint/architecture.mjs) enforces the order, the `index.ts` entry and the domain files' independence. A new module or domain file joins its lists.
- Planned features have places already. Slack goes in as a second adapter behind `notifyModerators` in `notifications`. A mod UI goes in as an inbound adapter at the Devvit edge that calls the `configuration` and `rotation` interfaces; it shows config problems from their typed `ConfigProblem` values, as `configPageRevision.ts` does for modmail.

## Live state

Redis key strings (in [configStore.ts](src/configuration/configStore.ts), [configPageRevision.ts](src/configuration/configPageRevision.ts) and [livePosts.ts](src/rotation/livePosts.ts)) and the scheduler job name (in [refreshJob.ts](src/rotation/refreshJob.ts)) hold state in every subreddit the app is installed on. Keep them stable: a renamed key orphans its data on the next upgrade unless `onAppUpgrade` migrates it.

## Config fields

A thread config field lives in four places that change together: the `ThreadConfig` interface and the ajv `threadConfigsSchema` in [src/configuration/threadConfig.ts](src/configuration/threadConfig.ts), the commented sample written to the config page in [src/configuration/configPageInstall.ts](src/configuration/configPageInstall.ts), and the README's configuration rules and reference table.

A key left empty in YAML parses as null, and ajv admits null for every optional property whose schema allows it, so a new optional field is typed `| null` unless its `enum` excludes null. Stored thread configs are re-validated on every read. A stored config that fails validation throws rather than reading as empty (an empty list means "every thread config removed", and the refresh then forgets every live post), so refreshes and comment-cap rotation stop until moderators re-save the config page; they get one moderator alert asking them to (the `UnreadableConfigAlertSent` key, claimed with NX, keeps it to one until fresh thread configs are stored). A schema change that rejects previously valid stored config therefore needs a migration in `onAppUpgrade`.

## Strictness

- Prettier owns formatting: `npm run format` writes it, CI runs `npm run format:check`. ESLint carries no formatting rules (eslint-config-prettier), and [.gitattributes](.gitattributes) keeps LF line endings so the check also passes on Windows checkouts.
- [eslint.config.mjs](eslint.config.mjs) starts from every rule (ESLint `all`, typescript-eslint `all` plus its strict and stylistic typed presets, import-x, regexp, eslint-comments, vitest `all`); the files in [eslint/](eslint) tighten them by concern and turn a rule off only with its reason beside it. A dependency upgrade can add rules; fix their findings as part of the upgrade.
- Every suppression or workaround carries a `WORKAROUND:` block (`cause`, `blocked`, `fix`, `until`) directly above it; `grep -rn "WORKAROUND:" --exclude-dir=node_modules .` is the ledger. The only allowed directive is `eslint-disable-next-line` with a `--` reason.
- Handlers take narrow context types ([src/platform/index.ts](src/platform/index.ts) and the `*Context` types beside each handler) that name only the Devvit methods they call. Devvit's real context satisfies them, and tests build exact typed fakes from [tests/support](tests/support) — no `as` casts.
- vitest's asymmetric matchers (`expect.any`, `expect.objectContaining`) are typed `any`, which the unsafe-`any` rules reject; assert exact arguments, or read `mock.lastCall`.
- `eslint --fix` on tests rewrites `toHaveBeenCalled()` and `toHaveBeenCalledTimes(1)` into `toHaveBeenCalledWith()` and `toHaveBeenCalledExactlyOnceWith()`, which assert the mock received no arguments. Write the expected arguments by hand instead.

## Dependencies

- TypeScript stays on 6.0.x until `typescript-eslint`'s peer range admits 7 (`@vitest/eslint-plugin` also needs ≥6).
- Security fixes: `npm audit fix`, and Devvit upgrades to its `latest` dist-tag. `npm audit fix --force` breaks the project: it installs `devvit@1.0.0`, a 2022 placeholder, and downgrades ESLint.
- As of November 2026 the remaining audit findings have no fixed release: an old `minimatch` (via Devvit's `twirp-ts`, and via ESLint and its plugins, dev only) and `tmp` (via the Devvit CLI, dev only). Recheck them on each upgrade.
- npm reports blocked install scripts for `esbuild`, `protobufjs` and `core-js`. Build and tests work without them; leave them unapproved.
- On Windows, `npm ci` fails with EPERM while an editor's ESLint server has loaded `@unrs/resolver-binding-*/*.node` (the import resolver's native module). Stop the ESLint server, or close the editor, first.

## Git

Commits are authored and committed as `ivashkin-reddit <ivashkin.r@pm.me>`; pushes and `gh` calls run as the `ivashkin-reddit` GitHub account. Local hooks enforce this: when one rejects, correct the identity and retry.
