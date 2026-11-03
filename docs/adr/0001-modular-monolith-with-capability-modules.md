# A modular monolith: one bounded context, split into capability modules

The app is one Devvit deployment, organised as modules with one-way dependencies. Its domain is a single bounded context, managed threads ([CONTEXT.md](../../CONTEXT.md)). Configuration and rotation are capability modules within that context, not separate contexts: a thread config's schedule and comment cap mean the same thing to both, so a translation between them would map each term onto itself. Notifications is a generic capability. It delivers moderator alerts and knows nothing of managed threads.

A seam goes only where something varies across it. Moderator alerts pass through `notifyModerators`, because Slack is a planned second channel. Config problems are typed values kept apart from their modmail wording, because a mod UI is a planned second place to show them. Redis and the scheduler get no repository interfaces: Devvit is the only runtime, and each handler's narrow context type already lets tests pass typed fakes. An interface over either would be a layer with one adapter. The domain rules (checking thread configs, rendering titles, deciding rotation) are plain functions over plain values, so they import nothing from Devvit and their tests need no fakes.

## Consequences

- Dependencies point one way: platform, notifications, configuration, rotation, then the Devvit edge (`src/main.ts`, `src/triggers.ts`). Each module is entered only through its `index.ts`. [eslint/architecture.mjs](../../eslint/architecture.mjs) enforces both rules and keeps the domain files free of infrastructure.
- Slack becomes a second adapter inside notifications. A mod UI becomes an inbound adapter at the Devvit edge that calls the configuration and rotation interfaces. Neither changes the domain.
- Configuration might one day need its own language, for instance a mod UI that edits thread configs in a shape rotation does not share. At that point it becomes its own context, with an explicit translation at its interface.
