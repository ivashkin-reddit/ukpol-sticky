# Use cases depend on ports their module owns; adapters are wired at the composition root

ADR 0001 put Redis and the scheduler behind no interfaces. Use cases called their module's Redis and scheduler code directly, typed by narrow Devvit context types. Application code therefore depended on adapter code: rotation's tests asserted Redis key names, and each handler's context type grew into an intersection of every Devvit API its call chain touched. Dependencies now point inward instead:

- **Domain:** each module's `domain/` holds pure rules that take what they need as arguments.
- **Ports:** each module's `ports.ts` declares the interfaces its use cases need from outside.
- **Adapters:** each module's `adapters/` implement those ports over Devvit.
- **Composition root:** `src/composition.ts`, at the edge, is the only code that builds adapters, from the context Devvit hands each handler.

Each port has one adapter today, against ADR 0001's rule of thumb that a seam needs two. The ports earn their place anyway:

- Use cases and their tests no longer know storage layouts or Devvit's API.
- Moving to `@devvit/web`, as Reddit asks Blocks apps to, replaces adapters and wiring but no use case.
- Slack and a mod UI each arrive as one more adapter or handler.

## Considered options

- **Keep ADR 0001:** the smaller change, rejected because it leaves application code depending on adapters.
- **One domain module shared by configuration and rotation:** also inward, rejected because it takes the rotation rules away from the capability that owns them.

## Consequences

- [eslint/architecture.mjs](../../eslint/architecture.mjs) enforces the layering with eslint-plugin-boundaries. [tests/architecture.test.ts](../../tests/architecture.test.ts) lints known violations through it, so a rule that stops firing fails the tests rather than passing silently.
- A new Devvit capability takes three steps: a port in the module's `ports.ts`, an adapter in its `adapters/`, and wiring in `src/composition.ts`.
- Use-case tests fake ports. Adapter tests fake the narrow Devvit context. Integration tests run the real adapters on Devvit's in-memory harness, through the composition root.
