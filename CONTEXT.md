# Managed threads

A subreddit's moderators define recurring discussion threads; the app keeps each one's post current on Reddit, replacing it on a schedule or when it fills up.

## Language

### Defining threads

**Thread config**:
One moderator-written definition of a managed thread: its title, body, schedule, comment cap and retirement options. Moderators write them as YAML documents on the config page.
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
_Avoid_: refresh (that is the whole pass), recreation

**Handover**:
The rest of a rotation once the new live post is published: distinguishing and stickying it, then retiring the old post. A handover that a failure interrupts is finished by the next refresh.
_Avoid_: recovery, completion

**Retirement**:
What happens to the outgoing live post on rotation: it is unstickied, given its end note and locked, as its thread config asks.
_Avoid_: archiving, closing

**End note**:
The distinguished, pinned comment a retiring live post receives, usually pointing to its replacement.
_Avoid_: closing comment

**Refresh**:
One pass over all enabled thread configs that rotates every live post that is due and brings the others' bodies up to date.
_Avoid_: update, sync

**Applied thread configs**:
The thread configs the last refresh applied. While the thread configs in force differ from them, as after a config page save, a refresh is due at once, whatever else is pending.
_Avoid_: dirty flag, pending changes

**Refresh check**:
The hourly check that a refresh is pending and on time, and that the config page's latest revision has been applied. It requests a refresh when none will run, as after a refresh that failed or a scheduled one that never ran, or when thread configs differ from the applied thread configs and no refresh is due at once. It applies a revision nothing applied.
_Avoid_: safety net, heartbeat, cron job

**Refresh status**:
Whether refreshes are running: how the last refresh ended, when one last succeeded, and when the next is due.
_Avoid_: health, heartbeat

### Alerting moderators

**Moderator alert**:
A message to the subreddit's moderators about something they must act on, such as a config problem.
_Avoid_: notification (alone), modmail (that is one channel)
