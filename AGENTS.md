# AGENTS.md

Devvit Web (Reddit developer platform) app that creates, stickies and rotates managed threads for /r/ukpolitics. Moderators configure it with YAML on the wiki page `stickymgr/config`; [README.md](README.md) is the moderator-facing config reference.

## Done

A change is done when every step in [.github/workflows/test.yml](.github/workflows/test.yml) passes locally.

Behaviour on Reddit is verified on the test subreddit, r/ukpol_megabot_dev (devvit.json's `dev.subreddit`), where anything may break: `npx devvit playtest` while developing, and before each release a rehearsal of the production upgrade with uploaded builds, from which the release's runbook is written. Production, r/ukpolitics, is upgraded only by following that runbook, at a time the user schedules and with their go-ahead. Name what each step exercises.

## Devvit

- Docs: <https://developers.reddit.com/docs/llms.txt>. They lag the code; where they disagree with the `.d.ts` files under `node_modules/@devvit/`, the installed types win.
- This is a Devvit Web app: a Node server that Devvit calls over HTTP. [devvit.json](devvit.json) declares each trigger and scheduled task with its `/internal/` endpoint, and [src/server/app.ts](src/server/app.ts) serves exactly those routes, each running one handler in [src/triggers.ts](src/triggers.ts). A new trigger or task takes an entry in `devvit.json`, a route in `app.ts`, and the matching change to [tests/devvitConfig.test.ts](tests/devvitConfig.test.ts).
- `npm run build` bundles the server with Vite and `@devvit/start` into `dist/server/index.cjs`; `devvit upload` and `devvit playtest` build through `devvit.json`'s `scripts`.
- `@devvit/web`, `@devvit/start`, `@devvit/test` and `devvit` are pinned to one exact version and upgrade together.
- Devvit's clients (`reddit`, `redis`, `scheduler`) and the request `context` import from `@devvit/web/server`; thing-ID helpers (`T1`, `T3`, `T5`, `isT3`, …) and trigger payload types from `@devvit/web/shared`. The helpers are PascalCase functions, which `new-cap` rejects as calls, so import them under descriptive names (`T3 as asPostId`).
- `@devvit/web/server` re-exports `@devvit/reddit`'s models as types only. A TS1485 error on a Devvit enum means it has no runtime value; `MODS_ONLY` in [src/configuration/adapters/wikiConfigPage.ts](src/configuration/adapters/wikiConfigPage.ts) shows the workaround.

## Architecture

A modular monolith with one bounded context, managed threads, built as ports and adapters. [CONTEXT.md](CONTEXT.md) is the glossary. Name code, logs and modmail with its terms.

- The modules under `src/`, in dependency order, are `notifications`, `configuration` and `rotation`. Each imports only modules before it, and only through their `index.ts`; that file's header comment says what the module owns.
- Inside a module, dependencies point inward:
    - `domain/` holds pure rules that take what they need as arguments.
    - The module root holds the use cases, and `ports.ts` holds the interfaces they need from outside.
    - `adapters/` implement those ports over Devvit, typed by the narrow context types in [src/platform/index.ts](src/platform/index.ts).
- The edge is the files directly under `src/` and the server in `src/server/`. [app.ts](src/server/app.ts) routes each request to a handler in [triggers.ts](src/triggers.ts), or in [status.ts](src/status.ts) for the mod UI, with a context [requestContext.ts](src/server/requestContext.ts) builds for that request. Each handler gets ports from [composition.ts](src/composition.ts), the only code that builds adapters, and calls one use case.
- A new Devvit capability takes three steps: a port in the module's `ports.ts`, an adapter in its `adapters/`, and wiring in `composition.ts`.
- [eslint/architecture.mjs](eslint/architecture.mjs) enforces all of this with eslint-plugin-boundaries, and [tests/architecture.test.ts](tests/architecture.test.ts) checks that each rule still fires. A new module joins `MODULE_ORDER` there. A new rule gets a case in the test.
- **The mod UI** is mod-only menu items and forms, served as UI routes in [app.ts](src/server/app.ts) that answer with what Reddit's UI shows next.
    - The status ([status.ts](src/status.ts)) first identifies the caller through the moderator listing ([moderators.ts](src/moderators.ts)), before it reads anything else. Any moderator counts, one with no permissions included; `getModPermissionsForSubreddit` cannot tell such a moderator from a user who is not one.
    - The check reads the request's context directly, as `triggers.ts` reads `appSlug`: who is asking is the edge's question, not a module's port.
    - It then calls `configuration`'s `getConfigPageStatus` and, with the thread configs that read, `rotation`'s `getThreadStatuses`; [statusForm.ts](src/statusForm.ts) lays out the form. The status only reads: it writes, schedules and alerts nothing.
- Planned features already have places:
    - Slack is a second adapter for `NotifyModerators`, chosen in `composition.ts`.
    - Management forms join the mod UI the same way, and check the caller's permissions (`all` or `posts`) from the same listing entry.

These choices are deliberate. Revisit one only when the user asks:

- **One context.** `configuration` and `rotation` are modules of one context, not two: a thread config's schedule and comment cap mean the same to both, so a translation between them would map each term onto itself. Configuration becomes its own context, with a translation at its interface, only once something edits thread configs in a shape rotation does not share.
- **Ports with one adapter.** Each port has a single adapter, and the ports still earn their place. They keep storage layouts and Devvit's API out of use cases and their tests; the move from Blocks to Devvit Web changed only adapters and wiring.
- **Rotations finish after failures.** Every step after a rotation publishes its post runs in `finishHandover` ([threadRefresh.ts](src/rotation/threadRefresh.ts)) and first checks what Reddit shows or the handover records, so the next refresh finishes an interrupted rotation without repeating a step. A new rotation step follows the same rule.
- **Rules stay with their capability.** Rotation rules live in `rotation/domain/` and config checks in `configuration/domain/`. A domain module shared by both would take each rule away from the module that owns it.

## Logs

`console` is Devvit's only log channel. `devvit logs <subreddit>` streams it, and only developers can see it, so moderators learn of problems through moderator alerts instead.

- Use `console.error` for a failure someone must look into, `console.warn` for bad input the app handled (a rejected config page revision, an event missing a field), and `console.log` for normal activity.
- Write messages in CONTEXT.md's terms, and name the thread config and the post, revision or job involved.
- The log stream is lossy: `devvit logs` can silently drop lines, as it did with a rotation's last two lines in November 2026. So:
    - **The reason travels with the event.** A line carries what an operator needs to read it alone: a rotation names why it happened, and a scheduled refresh names what it is for.
    - **Restate what monitoring relies on.** The hourly refresh check logs each thread config's next refresh, so a lost scheduling line costs at most an hour.
    - **A missing line proves nothing.** Confirm on Reddit, or in stored state, that a step happened or failed.
- [src/server/app.ts](src/server/app.ts) runs every handler through `observed` ([src/observed.ts](src/observed.ts)), which logs each failure with the handler's name and duration; the route then answers HTTP 500 with no detail. A handler that fires for every comment, post or mod action in the subreddit is registered as "failures only"; its use cases log what they change.

## Live state

Redis key strings (in [redisConfigStore.ts](src/configuration/adapters/redisConfigStore.ts), [redisAppliedThreadConfigs.ts](src/rotation/adapters/redisAppliedThreadConfigs.ts), [redisLivePosts.ts](src/rotation/adapters/redisLivePosts.ts), [redisRefreshStatus.ts](src/rotation/adapters/redisRefreshStatus.ts), [redisRetiredRefreshRecords.ts](src/rotation/adapters/redisRetiredRefreshRecords.ts) (read and deleted by the upgrade only), [redisThreadLocks.ts](src/rotation/adapters/redisThreadLocks.ts), and [composition.ts](src/composition.ts) for the alert latches, one per thread config for failed refreshes) and scheduler job names and each refresh job's `configName` data (in [schedulerRefreshJobs.ts](src/rotation/adapters/schedulerRefreshJobs.ts), and as task names in `devvit.json`) hold state in every subreddit the app is installed on. Keep them stable: a renamed key orphans its data on the next upgrade unless `onAppUpgrade` migrates it.

## Security

- **Least privilege.** `devvit.json` grants Redis and the Reddit API as the app account (`scope: "user"`, no `asUser`), and turns outbound HTTP off. A permission is added only with a feature that uses it; [tests/devvitConfig.test.ts](tests/devvitConfig.test.ts) fails on any change to `devvit.json`, so each one is deliberate.
- **One surface.** The routes `devvit.json` declares are the only ones the server answers: no web view (`post`), no `externalEndpoints`, and every other path or method gets 404. A mod UI route (the status's menu item and form) checks that the caller moderates the subreddit before anything else, and takes nothing from a request but the field it reads.
- **Untrusted input.** Request bodies are narrowed from `unknown` in [src/server/requestBodies.ts](src/server/requestBodies.ts), never cast.
- **No detail in responses.** Errors go to the developer log through `observed`; a trigger or task's response says only `ok` or `error`, and a mod UI route's failure a fixed message.
- **Repeated delivery.** Devvit may deliver an event or task more than once, so every handler is safe to repeat; [tests/routes.integration.test.ts](tests/routes.integration.test.ts) delivers each twice.
- **Supply chain.** Dependencies install from the lockfile with install scripts blocked; CI fails on any `high` or `critical` audit finding, pins GitHub Actions to commit SHAs (kept current by Dependabot), and checks the server bundle holds no Blocks code.
- **No secrets.** The app uses no settings, tokens or keys.

## Config fields

A thread config field lives in four places that change together: the `ThreadConfig` interface and the ajv `threadConfigsSchema` in [src/configuration/domain/threadConfig.ts](src/configuration/domain/threadConfig.ts), the commented sample written to the config page in [src/configuration/configPageInstall.ts](src/configuration/configPageInstall.ts), and the README's configuration rules and reference table.

A key left empty in YAML parses as null, and ajv admits null for every optional property whose schema allows it, so a new optional field is typed `| null` unless its `enum` excludes null. Stored thread configs are re-validated on every read. A stored config that fails validation throws rather than reading as empty (an empty list means "every thread config removed", and the refresh then forgets every live post), so refreshes and comment-cap rotation stop until moderators re-save the config page; they get one moderator alert asking them to (the `UnreadableConfigAlertSent` key, claimed with NX, keeps it to one until fresh thread configs are stored). A schema change that rejects previously valid stored config therefore needs a migration in `onAppUpgrade`.

## Strictness

- Prettier owns formatting: `npm run format` writes it, CI runs `npm run format:check`. ESLint carries no formatting rules (eslint-config-prettier), and [.gitattributes](.gitattributes) keeps LF line endings so the check also passes on Windows checkouts.
- [eslint.config.mjs](eslint.config.mjs) starts from every rule (ESLint `all`, typescript-eslint `all` plus its strict and stylistic typed presets, import-x, regexp, eslint-comments, vitest `all`); the files in [eslint/](eslint) tighten them by concern and turn a rule off only with its reason beside it. A dependency upgrade can add rules; fix their findings as part of the upgrade.
- Every suppression or workaround carries a `WORKAROUND:` block (`cause`, `blocked`, `fix`, `until`) directly above it (in `package.json`, which has no comments, in a `"//"` key beside it); `grep -rn "WORKAROUND:" --exclude-dir=node_modules .` is the ledger. The only allowed directive is `eslint-disable-next-line` with a `--` reason.
- Adapters take narrow context types ([src/platform/index.ts](src/platform/index.ts) and the `*Context` types beside each adapter) that name only the Devvit methods they call, and Devvit Web's clients satisfy them ([src/server/requestContext.ts](src/server/requestContext.ts) is the compile-time proof). Tests build exact typed fakes from [tests/support](tests/support), with no `as` casts. Use-case tests fake ports (`fakeRotationPorts.ts`, `fakeConfigurationPorts.ts`). Adapter and edge tests fake the Devvit context (`fakeDevvitContext.ts`); route tests (`src/server/app.test.ts`) mock the handlers. Integration tests (`tests/*.integration.test.ts`) run the real adapters on Devvit's in-memory harness, through `composition.ts`, and `tests/routes.integration.test.ts` runs the routes there too.
- vitest's asymmetric matchers (`expect.any`, `expect.objectContaining`) are typed `any`, which the unsafe-`any` rules reject; assert exact arguments, or read `mock.lastCall`.
- `eslint --fix` on tests rewrites `toHaveBeenCalled()` and `toHaveBeenCalledTimes(1)` into `toHaveBeenCalledWith()` and `toHaveBeenCalledExactlyOnceWith()`, which assert the mock received no arguments. Write the expected arguments by hand instead.

## Dependencies

- TypeScript stays on 6.0.x until `typescript-eslint`'s peer range admits 7 (`@vitest/eslint-plugin` also needs ≥6).
- Security fixes: `npm audit fix`, and Devvit upgrades to its `latest` dist-tag. `npm audit fix --force` breaks the project: it installs `devvit@1.0.0`, a 2022 placeholder, and downgrades ESLint. Dependabot sometimes proposes the same downgrade; close those PRs.
- `package.json` overrides two packages the Devvit CLI pins to patched releases: `tmp` under `external-editor` (from the CLI's `inquirer`), and `isomorphic-git` under `@devvit/cli`. Its `//` key holds a WORKAROUND block for each.
- As of November 2026 the remaining audit findings are `minimatch` below 11.0.1 (GHSA-g3hv-75wg-m249), and no consumer accepts 11 yet:
    - ESLint, typescript-eslint and `eslint-plugin-import-x` ask for ^9 or ^10, and the Devvit CLI's `filelist` for ^5 (all dev only).
    - Devvit's `twirp-ts` brings it in through `dot-object`'s `glob@7`, which only `dot-object`'s command-line tool loads. None of the three is in the server bundle, as its sourcemap shows (`grep minimatch dist/server/index.cjs.map` finds nothing).
    - 11 drops what `import-x` and `glob@7` rely on (`makeRe`, and the regular expressions in `Minimatch.set`), so an override would break them. Recheck on each upgrade.
- npm reports blocked install scripts for `esbuild`, `protobufjs` and `core-js`. Build and tests work without them; leave them unapproved.
- On Windows, `npm ci` fails with EPERM while an editor's ESLint server has loaded `@unrs/resolver-binding-*/*.node` (the import resolver's native module). Stop the ESLint server, or close the editor, first.

## Git

Commits are authored and committed as `ivashkin-reddit <ivashkin.r@pm.me>`; pushes and `gh` calls run as the `ivashkin-reddit` GitHub account. Local hooks enforce this: when one rejects, correct the identity and retry.
