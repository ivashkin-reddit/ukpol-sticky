# Sticky Manager

Sticky Manager publishes, pins and rotates recurring discussion threads for [r/ukpolitics](https://www.reddit.com/r/ukpolitics/). It runs on Reddit's [Devvit](https://developers.reddit.com/) platform as the app **ukpol-megabot**, and moderators configure it on a subreddit wiki page.

- **Scheduled threads:** a new post every day, or on one day each week, at a set UTC time.
- **Comment caps:** a thread that fills up is replaced straight away, whatever its schedule.
- **Clean handovers:** the outgoing post can get a pinned end note pointing readers on, and be locked.
- **Live edits:** a change to a thread's body is applied to its current post in place.
- **Moderator alerts:** configuration mistakes and failures are reported by modmail, once per problem.
- **Slots:** each thread can keep a highlight slot through every rotation, so the weekly megathread stays in old.reddit's first sticky.
- **Pin to slot:** moderators can pin any post into a chosen slot from its mod menu, and see who pinned what in the status.
- **Status:** moderators can see every thread's state, and what needs attention, from the mod tools menu.

## Getting started

1. Install the app on your subreddit.
2. Open the wiki page `stickymgr/config`. The app creates it on install with a commented example. If the page already has content, the app keeps it. Either way, the app restricts editing to moderators.
3. Add one YAML document per thread, separated by `---` (see [Configuration](#configuration)), and save the page.

The app checks every save. A valid page takes effect straight away: new threads are published and existing ones updated. An invalid page is rejected with one modmail explaining the problem, and the previous configuration stays in force. If a save is ever missed, the app picks it up within the hour.

## How it works

Each YAML document on the config page is a _thread config_: it describes one recurring thread. The post currently serving it is its _live post_.

- **Rotation:** a live post is replaced when its scheduled time arrives or it reaches `maxComments`, whichever comes first. A thread without `frequency` and `postTime` is replaced only at its comment cap.
- **The six-hour rule:** a daily post created less than six hours before its next scheduled time stays up until the scheduled time after that. This happens when a comment-cap rotation lands shortly before a scheduled one.
- **Handover:** in order:
    1. the old post is unpinned;
    2. the new post is published, distinguished and, if `slot` or `sticky` is set, pinned with the Megathread label: in its `slot`, or else in the slot the old post held;
    3. the old post gets its `endNote`, then is locked if `lockOnRefresh` is set.
- **Edits:** changing `body` edits the live post in place, and changing `slot` or `sticky` moves or unpins it at once. Reddit titles cannot be edited, so a changed `title` takes effect at the next rotation.
- **Slots:** Reddit keeps up to six pinned posts, its community highlights; old.reddit shows the first two as its stickies. A thread's live post returns to its `slot` at each rotation, so moderators can move it in between, by hand or with Pin to slot, without the app moving it back early.
- **Disabling or removing a thread:** set `enabled: false` or delete its document. The app stops managing the thread and leaves its last post as it is.
- **Deleted or removed posts:** if a live post is deleted or removed, the app publishes a new one for that thread within the hour. To get one straight away, save the config page (any change will do).
- **Recovery:** each thread is refreshed on its own, so a thread that fails to rotate does not hold up the others; it is retried within 15 minutes. The retry finishes a rotation the failure interrupted: it pins and distinguishes the new post, and gives the old one its end note and lock, without repeating any step already done. Once an hour, at minute 43, the app also checks that each thread's next refresh is scheduled and on time, replacing one that is stuck. It applies any save to the config page it missed, and refreshes a thread straight away if a saved change has not reached it yet or it has no live post. Each refresh in turn makes sure that hourly check is still scheduled.

The app posts and comments as its own account, u/ukpol-megabot.

## Configuration

The config page uses YAML. Each thread is a separate document, and documents are separated by a line containing only `---`.

### Rules

- `name`, `enabled`, `title`, `maxComments` and `body` are required. Unknown keys are rejected.
- `name` must be unique on the page, 1 to 64 characters long, and not a reserved word such as `toString` or `__proto__`.
- `maxComments` must be a whole number, 1 or more.
- `frequency` and `postTime` must both be set, or both be omitted.
- `postTime` uses the 24-hour `HH:mm` format and is always UTC.
- `frequency` is one of `daily`, `mondays`, `tuesdays`, `wednesdays`, `thursdays`, `fridays`, `saturdays` or `sundays`.
- `title` may contain one [date token](#date-tokens).
- Reddit's limits apply: `title` must not be empty and must be at most 300 characters, `body` at most 40,000, and `endNote` at most 10,000.
- `slot` is a whole number from 1 to 6. No two enabled threads can share a slot, and at most six enabled threads can be pinned (with `slot` or `sticky: true`), since Reddit holds six highlights. `slot` beside `sticky: false` is rejected.

### Reference

| Option          | Required | Type    | Description                                                                                                                                                           |
| --------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`          | Yes      | string  | Identifies the thread. Keep it stable once the thread is live: a new name makes the app treat it as a different thread.                                               |
| `enabled`       | Yes      | boolean | Whether the app manages this thread. When `false`, the app stops managing it and leaves its last post as it is.                                                       |
| `title`         | Yes      | string  | Title for each new post. May contain one date token. A change takes effect at the next rotation.                                                                      |
| `frequency`     | No       | string  | `daily`, or a weekday such as `wednesdays` for one post a week. Omit it together with `postTime` for a thread replaced only at its comment cap.                       |
| `postTime`      | No       | string  | Scheduled rotation time, `HH:mm` in UTC. Only valid with `frequency`.                                                                                                 |
| `sticky`        | No       | boolean | When `true`, each new post is pinned in the highlight slot its predecessor held; the first goes last. Defaults to `false`.                                            |
| `slot`          | No       | integer | 1 to 6: the highlight slot each new post is pinned in, which implies `sticky`. Slots 1 and 2 are old.reddit's two stickies. A change moves the live post at once.     |
| `maxComments`   | Yes      | integer | The comment cap: when the live post reaches this many comments, it is replaced.                                                                                       |
| `body`          | Yes      | string  | Text of each post. A change is applied to the live post in place.                                                                                                     |
| `endNote`       | No       | string  | A distinguished comment, pinned to the outgoing post once its replacement is published. `{{new post}}` in it becomes a link to the new thread, titled with its title. |
| `lockOnRefresh` | No       | boolean | When `true`, the outgoing post is locked after its end note is added.                                                                                                 |

Use YAML block scalars such as `|` for `body` and `endNote` to keep paragraphs and line breaks.

### Date tokens

A title may contain one `{{date ...}}` token, which is replaced with the date the post is published. The format inside it is a [date-fns format string](https://date-fns.org/docs/format):

| Token                       | Example                   |
| --------------------------- | ------------------------- |
| `{{date yyyy-MM-dd}}`       | `2026-04-22`              |
| `{{date EEEE d MMMM yyyy}}` | `Wednesday 22 April 2026` |
| `{{date dd/MM/yyyy}}`       | `22/04/2026`              |

## Examples

### Daily sticky megathread

```yaml
name: daily
enabled: true
title: Daily /r/ukpolitics megathread for {{date yyyy-MM-dd}}
frequency: daily
postTime: 02:00
sticky: true
slot: 1
maxComments: 1000
body: |
    This is the daily megathread for /r/ukpolitics.

    Use this post to discuss all aspects of politics in the UK.
endNote: |
    This thread is now closed. Please continue in {{new post}}.
lockOnRefresh: true
```

### Weekly thread on a set day

```yaml
name: weekend-thread
enabled: true
title: Weekend discussion thread for {{date EEEE d MMMM yyyy}}
frequency: saturdays
postTime: 08:00
sticky: true
maxComments: 1500
body: |
    Welcome to the weekend thread.

    Use this post for longer-form discussion that does not fit the daily megathread.
endNote: |
    The weekend thread has rolled over. Please move to the latest thread.
lockOnRefresh: true
```

### Scheduled thread without a sticky slot

```yaml
name: overnight-roundup
enabled: true
title: Overnight links roundup for {{date yyyy-MM-dd}}
frequency: daily
postTime: 23:30
maxComments: 300
body: |
    This thread collects overnight links and updates.
```

### Live event thread, replaced only when full

Omit both `frequency` and `postTime` to keep a thread open until it reaches its comment cap.

```yaml
name: breaking-news
enabled: true
title: Breaking news megathread
sticky: true
maxComments: 2500
body: |
    Use this thread for fast-moving live coverage.
endNote: |
    This live thread is full. Please continue in the newest megathread.
lockOnRefresh: true
```

### Several threads on one page

```yaml
name: daily
enabled: true
title: Daily /r/ukpolitics megathread for {{date yyyy-MM-dd}}
frequency: daily
postTime: 02:00
sticky: true
maxComments: 1000
body: |
    Daily discussion.
---
name: weekend-thread
enabled: true
title: Weekend discussion thread for {{date EEEE d MMMM yyyy}}
frequency: saturdays
postTime: 08:00
sticky: true
maxComments: 1500
body: |
    Weekend discussion.
---
name: breaking-news
enabled: true
title: Breaking news megathread
sticky: true
maxComments: 2500
body: |
    Live event coverage.
```

## Status

To see whether Sticky Manager is working, open the subreddit's mod tools menu and choose **Sticky Manager status**. Only moderators see the item, and only moderators get an answer. The status changes nothing.

It shows:

- **Summary:** how many managed threads there are, and how many need attention.
- **Config page:** whether the config page's latest revision is in force. If it was rejected, the status repeats the problem from the modmail; the thread configs from the last accepted revision stay in force until the page is fixed.
- **Latest changes:** the five most recent changes moderators made with Pin to slot: who, when, and what.
- **Disabled:** the thread configs with `enabled: false`.
- One section per thread, those needing attention first:
    - **Live post:** its title and ID, the slot it is pinned in (and its thread config's slot when that differs), and when it was posted.
    - **Comments:** its comment count against its `maxComments`.
    - **Next refresh:** when the app next looks at the thread, in UTC, and why.
    - **Last refresh:** whether the app's last look at the thread succeeded, and the error if not. **Last success** follows a failure.
    - **Handover:** a rotation that was interrupted part-way; the next refresh finishes it.
    - **Needs attention:** what is wrong, and what the app does next.

To open a thread's live post, choose it under **Open a live post** and press **Open**. Leave it empty and press **Open** to reload the status.

| Needs attention                                                                    | What to do                                                                                                                 |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Its last refresh failed                                                            | Nothing, usually: the app retries within 15 minutes. If it keeps failing, check the thread on Reddit.                      |
| Its refresh has not run, no refresh is pending, or its saved config is not applied | Nothing: the hourly refresh check repairs it within the hour. If it is still there after an hour, ask the app's developer. |
| It has no live post, or its handover is unfinished                                 | Nothing: the hourly refresh check requests a refresh within the hour.                                                      |
| Its live post could not be read from Reddit                                        | Check the post on Reddit. If it was removed, the app publishes a new one within the hour.                                  |
| Could not read its status                                                          | Try again shortly. If it persists, ask the app's developer.                                                                |

## Pin to slot

To pin a post into a chosen slot, open the post's mod menu on new Reddit or in the Reddit apps and choose **Pin to slot**. Moderators with the Everything or Posts permission can use it; old.reddit shows no app menus, but its own sticky button still works.

The form shows the highlights now, then offers:

- **Slot:** 1 to 6, up to one more than the other pinned posts, or **Not pinned** to unpin it. Slots 1 and 2 are old.reddit's two stickies.
- **Label:** Megathread, Announcement, Event or None, shown under the post in new Reddit's highlights.
- **To make room:** shown when all six slots are taken, since pinning another post makes Reddit unpin the sixth. Choose **Unpin "…" to make room** to go ahead, or **Keep "…" pinned** to pin nothing; the form will not save until you choose. If the highlights change in the meantime, it asks again.

A thread's live post can be moved too; it returns to its thread config's `slot` at its next rotation. Each change is recorded with who made it and when, and the status shows the latest.

## Moderator alerts

The app reports problems to the subreddit's moderators by modmail. A rejected save is reported once; editing other wiki pages does not repeat it.

| Subject                                                    | Meaning                                                                                     | What to do                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Invalid YAML in wiki page stickymgr/config                 | The page is not valid YAML.                                                                 | Fix the YAML and save the page again.                                                                    |
| Invalid config in wiki page stickymgr/config               | A thread config breaks one of the [rules](#rules). The modmail says which.                  | Fix it and save the page again.                                                                          |
| Duplicate config names in wiki page stickymgr/config       | Two thread configs share a `name`.                                                          | Rename one and save the page again.                                                                      |
| Incomplete schedule in config _name_                       | Only one of `frequency` and `postTime` is set.                                              | Set both, or neither.                                                                                    |
| Invalid date format in config _name_                       | The title's date token is not a valid date-fns format.                                      | Correct the format and save the page again.                                                              |
| Two configs share slot _n_                                 | Two enabled thread configs ask for the same `slot`.                                         | Give each its own slot and save the page again.                                                          |
| Too many pinned configs in wiki page stickymgr/config      | More than six enabled thread configs are pinned, but Reddit holds six.                      | Unpin some (remove `slot` and `sticky`) and save the page again.                                         |
| Sticky Manager unpinned a post to pin thread config _name_ | Pinning the thread's live post needed a seventh highlight, so Reddit unpinned the last one. | Pin it again with Pin to slot if it should stay, or unpin something else first.                          |
| Sticky Manager cannot read its stored config               | The app's saved copy of the config is unreadable, so it has stopped.                        | Save the config page (any change will do).                                                               |
| Sticky Manager could not refresh thread config _name_      | A refresh of that thread failed, for example because Reddit was unavailable.                | Nothing, usually: the app retries within 15 minutes. If the failure persists, check that thread.         |
| Sticky Manager could not schedule its refreshes            | The app could not check or schedule its refreshes.                                          | Nothing, usually: the app tries again at the next hourly check. If it persists, ask the app's developer. |

Until a rejected page is fixed, the previously accepted configuration stays in force.

A rotation interrupted part-way leaves its thread part-way through until the retry finishes it, within 15 minutes if Reddit is back by then. Meanwhile the old post may be unpinned with no replacement yet, or the new post published but not yet pinned, and the old post not yet locked. The failure modmail about a thread is sent once; no further one follows until that thread refreshes successfully.

If a rotation interrupted by the failure published its replacement but could not record it, the retry publishes another. Delete the extra, unpinned post. This is rare: it needs a failure in the moment between Reddit creating the post and the app recording it.

## Privacy and terms

- [Privacy Policy](PRIVACY.md)
- [Terms and Conditions](TERMS.md)

## Development

Sticky Manager is a TypeScript [Devvit Web](https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_overview) app: a small Node server, served with Hono and bundled with Vite, that Devvit calls for each trigger and scheduled task. It is based on [fsvreddit/ukpol-sticky](https://github.com/fsvreddit/ukpol-sticky).

```sh
npm ci
npm run typecheck
npm test                   # unit tests
npm run test:integration   # on Devvit's in-memory test harness
npm run lint
npm run format:check
npm run build              # the server bundle Devvit runs
npm run check:bundle
```

CI runs the same checks on every push. To try a change on Reddit, playtest it on a test subreddit you moderate: `npx devvit playtest <subreddit>`.

- [AGENTS.md](AGENTS.md) describes the architecture and the project's conventions.
- [CONTEXT.md](CONTEXT.md) defines the terms used in the code, logs and modmail.

## License

Sticky Manager is released under the [BSD 3-Clause License](LICENSE).
