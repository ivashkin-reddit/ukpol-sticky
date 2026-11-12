# Managed threads

A subreddit's moderators define recurring discussion threads; the app keeps each one's post current on Reddit, replacing it on a schedule or when it fills up.

## Language

### Defining threads

**Thread config**:
One moderator-written definition of a managed thread: its title, body, schedule, comment cap, slot and retirement options. Moderators write them as YAML documents on the config page.
_Avoid_: config (alone), sticky config, managed post

**Config page**:
The subreddit wiki page `stickymgr/config` that holds the thread configs.
_Avoid_: config file, wiki config

**Schedule**:
When a thread config's live post is due for rotation by time: daily, or weekly on a named day, at a UTC time. A thread config without one rotates only at its comment cap.
_Avoid_: frequency (that is one part of a schedule), timer

**Comment cap**:
The number of comments at which a live post is rotated, whatever its schedule.
_Avoid_: max comments, limit

**Date token**:
The `{{date …}}` placeholder in a thread config's title, replaced with the post's creation date when the post is published.
_Avoid_: date placeholder, template variable

**Slot**:
A place in the highlights, 1 to 6. A thread config can set the slot its live posts are pinned in; slots 1 and 2 are the two stickies old.reddit shows.
_Avoid_: sticky slot, position

**Config problem**:
A reason a config page cannot be accepted, reported back to the moderator who saved it. The previously accepted thread configs stay in force.
_Avoid_: config error, validation failure

### Keeping threads current

**Managed thread**:
The recurring series of posts that one thread config describes.
_Avoid_: megathread (a moderator term for some, not all, managed threads), sticky post

**Live post**:
The Reddit post currently serving a thread config.
_Avoid_: tracked post, sticky post, current thread

**Rotation**:
Replacing a thread config's live post with a new one: the old post is retired, the new one published.
_Avoid_: refresh (that is a thread config's whole pass), recreation

**Handover**:
The rest of a rotation once the new live post is published: distinguishing it and pinning it in its slot, then retiring the old post. A handover that a failure interrupts is finished by the thread config's next refresh.
_Avoid_: recovery, completion

**Retirement**:
What happens to the outgoing live post on rotation: it is unpinned, given its end note and locked, as its thread config asks.
_Avoid_: archiving, closing

**End note**:
The distinguished, pinned comment a retiring live post receives, usually pointing to its replacement: a `{{new post}}` token in it becomes a link to the replacement.
_Avoid_: closing comment

**Refresh**:
One pass over one enabled thread config: it finishes the thread config's unfinished handover, then rotates its live post if due, publishes one if it has none, or brings its body up to date. Each thread config's refreshes are scheduled on their own.
_Avoid_: update, sync

**Applied thread config**:
The version of a thread config that its last refresh applied. While the stored version differs, as after a config page save, the thread config needs a refresh at once.
_Avoid_: dirty flag, pending changes

**Refresh check**:
The hourly check that each thread config in force has the refresh it needs pending and on time, and that the config page's latest revision has been applied. It requests a thread config's refresh when its stored version is not applied, it has no live post or its handover is unfinished, and no refresh of it is due soon; or when it has a schedule and no refresh of it will run. It forgets thread configs no longer in force, and applies a revision nothing applied.
_Avoid_: safety net, heartbeat, cron job

**Refresh status**:
Whether a thread config's refreshes are running: how its last refresh ended, when one last succeeded, and when and why its next is due.
_Avoid_: health, heartbeat

**Status**:
The moderators' read-only view of Sticky Manager: each thread config's live post, where it is pinned and comments against its comment cap, when and why its next refresh runs, how its last refresh ended, any unfinished handover, the config page's state, and the latest changes.
_Avoid_: dashboard, health

**Needs attention**:
A thread config whose last refresh failed, whose live post or status cannot be read, or for which the refresh check would request a refresh. The status lists these first.
_Avoid_: unhealthy, broken

### Pinning posts

**Highlights**:
The subreddit's ordered list of up to six pinned posts (Reddit's community highlights). old.reddit shows only the first two, as its stickies.
_Avoid_: stickies, sticky posts

**Pin**:
To put a post in the highlights, in a slot; to **unpin** takes it out. Moderators pin any post with "Pin to slot"; the app pins each pinned thread config's live posts.
_Avoid_: sticky (as a verb; the `sticky` field keeps its name), highlight (as a verb)

**Change history**:
The moderator changes made through the app: who, when and what. It keeps the last 50, none older than 90 days; the status shows the latest.
_Avoid_: audit log, mod log (that is Reddit's)

### Alerting moderators

**Moderator alert**:
A message to the subreddit's moderators about something they must act on, such as a config problem.
_Avoid_: notification (alone), modmail (that is one channel)
