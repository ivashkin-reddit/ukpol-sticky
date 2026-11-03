# AGENTS.md

Devvit (Reddit developer platform) app that creates, stickies and rotates megathreads for /r/ukpolitics. Moderators configure it with YAML on the wiki page `stickymgr/config`; [README.md](README.md) is the moderator-facing config reference.

## Done

A change is done when every step in [.github/workflows/test.yml](.github/workflows/test.yml) passes locally.

Behaviour on Reddit itself is only verifiable with `npx devvit playtest`, which needs the user's Reddit login: hand that step to the user, naming what to exercise.

## Devvit

- Docs: <https://developers.reddit.com/docs/llms.txt>. They lag the code; where they disagree with the `.d.ts` files under `node_modules/@devvit/`, the installed types win.
- This is a Blocks app on `@devvit/public-api`: handlers register in [src/main.ts](src/main.ts), wired by `blocks.entry` in [devvit.json](devvit.json). Reddit has deprecated this model for `@devvit/web` but still supports it. New code follows the existing pattern; moving to `@devvit/web` is its own deliberate job.
- `@devvit/protos`, `@devvit/public-api`, `@devvit/reddit`, `@devvit/redis`, `@devvit/scheduler`, `@devvit/test` and `devvit` are pinned to one exact version and upgrade together.
- `@devvit/public-api` re-exports `@devvit/reddit` as types only. A TS1362 error on a Devvit enum means it has no runtime value; `MODS_ONLY` in [src/configuration/adapters/wikiConfigPage.ts](src/configuration/adapters/wikiConfigPage.ts) shows the workaround.
- Thing-ID helpers (`asT5ID`, `isT3ID`, …) import from `@devvit/public-api/types/tid.js`; the package root does not export them.

## Architecture

A modular monolith with one bounded context, managed threads, built as ports and adapters. [CONTEXT.md](CONTEXT.md) is the glossary. Name code, logs and modmail with its terms.

- The modules under `src/`, in dependency order, are `notifications`, `configuration` and `rotation`. Each imports only modules before it, and only through their `index.ts`; that file's header comment says what the module owns.
- Inside a module, dependencies point inward:
    - `domain/` holds pure rules that take what they need as arguments.
    - The module root holds the use cases, and `ports.ts` holds the interfaces they need from outside.
    - `adapters/` implement those ports over Devvit, typed by the narrow context types in [src/platform/index.ts](src/platform/index.ts).
- The files directly under `src/` are the Devvit edge. [main.ts](src/main.ts) registers the handlers in [triggers.ts](src/triggers.ts). Each handler gets ports from [composition.ts](src/composition.ts), the only code that builds adapters, and calls one use case.
- A new Devvit capability takes three steps: a port in the module's `ports.ts`, an adapter in its `adapters/`, and wiring in `composition.ts`.
- [eslint/architecture.mjs](eslint/architecture.mjs) enforces all of this with eslint-plugin-boundaries, and [tests/architecture.test.ts](tests/architecture.test.ts) checks that each rule still fires. A new module joins `MODULE_ORDER` there. A new rule gets a case in the test.
- Planned features already have places:
    - Slack is a second adapter for `NotifyModerators`, chosen in `composition.ts`.
    - A mod UI is a set of handlers at the edge that call the `configuration` and `rotation` use cases. It shows config problems from their typed `ConfigProblem` values, as `configPageRevision.ts` does for modmail, and whether refreshes are running from `getRefreshStatus`.

These choices are deliberate. Revisit one only when the user asks:

- **One context.** `configuration` and `rotation` are modules of one context, not two: a thread config's schedule and comment cap mean the same to both, so a translation between them would map each term onto itself. Configuration becomes its own context, with a translation at its interface, only once something edits thread configs in a shape rotation does not share.
- **Ports with one adapter.** Each port has a single adapter, and the ports still earn their place. They keep storage layouts and Devvit's API out of use cases and their tests, and they confine the move to `@devvit/web` to adapters and wiring.
- **Rotations finish after failures.** Every step after a rotation publishes its post runs in `finishHandover` ([threadRefresh.ts](src/rotation/threadRefresh.ts)) and first checks what Reddit shows or the handover records, so the next refresh finishes an interrupted rotation without repeating a step. A new rotation step follows the same rule.
- **Rules stay with their capability.** Rotation rules live in `rotation/domain/` and config checks in `configuration/domain/`. A domain module shared by both would take each rule away from the module that owns it.

## Logs

`console` is Devvit's only log channel. `devvit logs <subreddit>` streams it, and only developers can see it, so moderators learn of problems through moderator alerts instead.

- Use `console.error` for a failure someone must look into, `console.warn` for bad input the app handled (a rejected config page revision, an event missing a field), and `console.log` for normal activity.
- Write messages in CONTEXT.md's terms, and name the thread config and the post, revision or job involved.
- [src/main.ts](src/main.ts) registers every handler through `observed` ([src/observed.ts](src/observed.ts)), which logs each failure with the handler's name and duration. A handler that fires for every comment, post or mod action in the subreddit is registered as "failures only"; its use cases log what they change.

## Live state

Redis key strings (in [redisConfigStore.ts](src/configuration/adapters/redisConfigStore.ts), [redisAppliedThreadConfigs.ts](src/rotation/adapters/redisAppliedThreadConfigs.ts), [redisLivePosts.ts](src/rotation/adapters/redisLivePosts.ts), [redisRefreshStatus.ts](src/rotation/adapters/redisRefreshStatus.ts), [redisThreadLocks.ts](src/rotation/adapters/redisThreadLocks.ts), and [composition.ts](src/composition.ts) for the alert latches) and scheduler job names (in [schedulerRefreshJobs.ts](src/rotation/adapters/schedulerRefreshJobs.ts)) hold state in every subreddit the app is installed on. Keep them stable: a renamed key orphans its data on the next upgrade unless `onAppUpgrade` migrates it.

## Config fields

A thread config field lives in four places that change together: the `ThreadConfig` interface and the ajv `threadConfigsSchema` in [src/configuration/domain/threadConfig.ts](src/configuration/domain/threadConfig.ts), the commented sample written to the config page in [src/configuration/configPageInstall.ts](src/configuration/configPageInstall.ts), and the README's configuration rules and reference table.

A key left empty in YAML parses as null, and ajv admits null for every optional property whose schema allows it, so a new optional field is typed `| null` unless its `enum` excludes null. Stored thread configs are re-validated on every read. A stored config that fails validation throws rather than reading as empty (an empty list means "every thread config removed", and the refresh then forgets every live post), so refreshes and comment-cap rotation stop until moderators re-save the config page; they get one moderator alert asking them to (the `UnreadableConfigAlertSent` key, claimed with NX, keeps it to one until fresh thread configs are stored). A schema change that rejects previously valid stored config therefore needs a migration in `onAppUpgrade`.

## Strictness

- Prettier owns formatting: `npm run format` writes it, CI runs `npm run format:check`. ESLint carries no formatting rules (eslint-config-prettier), and [.gitattributes](.gitattributes) keeps LF line endings so the check also passes on Windows checkouts.
- [eslint.config.mjs](eslint.config.mjs) starts from every rule (ESLint `all`, typescript-eslint `all` plus its strict and stylistic typed presets, import-x, regexp, eslint-comments, vitest `all`); the files in [eslint/](eslint) tighten them by concern and turn a rule off only with its reason beside it. A dependency upgrade can add rules; fix their findings as part of the upgrade.
- Every suppression or workaround carries a `WORKAROUND:` block (`cause`, `blocked`, `fix`, `until`) directly above it (in `package.json`, which has no comments, in a `"//"` key beside it); `grep -rn "WORKAROUND:" --exclude-dir=node_modules .` is the ledger. The only allowed directive is `eslint-disable-next-line` with a `--` reason.
- Adapters take narrow context types ([src/platform/index.ts](src/platform/index.ts) and the `*Context` types beside each adapter) that name only the Devvit methods they call, and Devvit's real context satisfies them. Tests build exact typed fakes from [tests/support](tests/support), with no `as` casts. Use-case tests fake ports (`fakeRotationPorts.ts`, `fakeConfigurationPorts.ts`). Adapter and edge tests fake the Devvit context (`fakeDevvitContext.ts`). Integration tests (`tests/*.integration.test.ts`) run the real adapters on Devvit's in-memory harness, through `composition.ts`.
- vitest's asymmetric matchers (`expect.any`, `expect.objectContaining`) are typed `any`, which the unsafe-`any` rules reject; assert exact arguments, or read `mock.lastCall`.
- `eslint --fix` on tests rewrites `toHaveBeenCalled()` and `toHaveBeenCalledTimes(1)` into `toHaveBeenCalledWith()` and `toHaveBeenCalledExactlyOnceWith()`, which assert the mock received no arguments. Write the expected arguments by hand instead.

## Dependencies

- TypeScript stays on 6.0.x until `typescript-eslint`'s peer range admits 7 (`@vitest/eslint-plugin` also needs ≥6).
- Security fixes: `npm audit fix`, and Devvit upgrades to its `latest` dist-tag. `npm audit fix --force` breaks the project: it installs `devvit@1.0.0`, a 2022 placeholder, and downgrades ESLint. Dependabot sometimes proposes the same downgrade; close those PRs.
- `package.json` overrides `tmp` under `external-editor` (from the Devvit CLI's `inquirer`) to a patched release; its `//` key holds the WORKAROUND block.
- As of November 2026 the remaining audit findings are `minimatch` below 11.0.1 (GHSA-g3hv-75wg-m249), and no consumer accepts 11 yet:
    - ESLint, typescript-eslint and `eslint-plugin-import-x` ask for ^9 or ^10, and the Devvit CLI's `filelist` for ^5 (all dev only).
    - Devvit's `twirp-ts` brings it in through `dot-object`'s `glob@7`, which only `dot-object`'s command-line tool loads, so it never reaches the app.
    - 11 drops what `import-x` and `glob@7` rely on (`makeRe`, and the regular expressions in `Minimatch.set`), so an override would break them. Recheck on each upgrade.
- npm reports blocked install scripts for `esbuild`, `protobufjs` and `core-js`. Build and tests work without them; leave them unapproved.
- On Windows, `npm ci` fails with EPERM while an editor's ESLint server has loaded `@unrs/resolver-binding-*/*.node` (the import resolver's native module). Stop the ESLint server, or close the editor, first.

## Git

Commits are authored and committed as `ivashkin-reddit <ivashkin.r@pm.me>`; pushes and `gh` calls run as the `ivashkin-reddit` GitHub account. Local hooks enforce this: when one rejects, correct the identity and retry.
