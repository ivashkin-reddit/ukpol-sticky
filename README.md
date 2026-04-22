# ukpol-sticky

An app to allow timed or comment-cap-only megathreads for /r/ukpolitics.

This app is controlled through the subreddit wiki page `stickymgr/config` on the subreddit where it is installed. The wiki page uses YAML multi-document format: each YAML document defines one managed post, and multiple documents are separated with `---`.

## How it works

- Valid wiki updates are stored immediately and an immediate refresh pass is queued.
- If the `body` changes for an active tracked post, the app edits the live Reddit post body instead of creating a replacement post.
- Posts with `frequency` and `postTime` rotate when either the next scheduled UTC time is reached or `maxComments` is hit, whichever happens first.
- Posts without `frequency` and `postTime` are comment-cap-only and rotate only when `maxComments` is hit.
- When a post rotates, the app can add an `endNote` comment to the old thread and lock it if `lockOnRefresh` is `true`.
- If a config is removed or changed to `enabled: false`, the app stops tracking it on the next refresh pass. It does not delete the existing Reddit post automatically.

## Configuration rules

- `name`, `enabled`, `title`, `maxComments`, and `body` are required.
- `name` must be unique across the entire wiki page.
- `maxComments` must be an integer greater than or equal to `1`.
- `frequency` and `postTime` must either both be set or both be omitted.
- `postTime` must use `HH:mm` 24-hour format and is always interpreted as UTC.
- `frequency` must be one of `daily`, `mondays`, `tuesdays`, `wednesdays`, `thursdays`, `fridays`, `saturdays`, or `sundays`.
- `title` may contain one `{{date ...}}` token using a `date-fns` format string such as `{{date yyyy-MM-dd}}`.
- Unknown keys are rejected.

## Configuration reference

| Option | Required | Type | Description |
| --- | --- | --- | --- |
| `name` | Yes | string | Internal unique identifier for the config. Keep it stable once a thread is live. Changing it makes the app treat the config as a different managed post. |
| `enabled` | Yes | boolean | Turns the config on or off. If `false`, the config stays in the wiki page but the app stops managing it on the next refresh pass. Existing Reddit posts are left alone. |
| `title` | Yes | string | Title used when a new post is created. It can include one `{{date ...}}` token. Changing `title` does not retitle an already-live post; the new title is used the next time the post rotates. |
| `frequency` | No | string | Schedule cadence for timed posts. Use `daily` for every day, or a weekday value such as `wednesdays` for weekly rotation on that day. Omit it together with `postTime` for comment-cap-only posts. |
| `postTime` | No | string | Scheduled UTC time for rotation in `HH:mm` format. Only valid when `frequency` is also set. |
| `sticky` | No | boolean | If `true`, the newly created post is stickied after submission. If omitted or `false`, the post is not stickied. |
| `maxComments` | Yes | integer | Rotation threshold. When the live post reaches or exceeds this number of comments, the app creates a replacement post. |
| `body` | Yes | string | Selftext for the post. If the body changes in the wiki page while the post is still active, the app edits the live post body in place. |
| `endNote` | No | string | Optional distinguished comment added to the outgoing post immediately before rotation. Useful for pointing readers to the replacement thread. |
| `lockOnRefresh` | No | boolean | If `true`, the outgoing post is locked when it is rotated. This happens after the optional `endNote` comment is posted. |

## Date token examples

You can include a single `{{date ...}}` token in `title`.

- `{{date yyyy-MM-dd}}` -> `2026-04-22`
- `{{date EEEE d MMMM yyyy}}` -> `Wednesday 22 April 2026`
- `{{date dd/MM/yyyy}}` -> `22/04/2026`

## YAML layout

Each post is a separate YAML document:

```yaml
name: daily
enabled: true
title: Daily megathread for {{date yyyy-MM-dd}}
frequency: daily
postTime: 02:00
sticky: true
maxComments: 1000
body: |
    Daily discussion goes here.
---
name: weekend
enabled: true
title: Weekend thread for {{date EEEE d MMMM yyyy}}
frequency: saturdays
postTime: 08:00
sticky: true
maxComments: 1500
body: |
    Weekend discussion goes here.
```

Use YAML block scalars such as `|` for `body` and `endNote` when you want to preserve paragraphs and line breaks.

## Examples

### Daily sticky megathread

Use this for the standard daily discussion thread.

```yaml
name: daily
enabled: true
title: Daily /r/ukpolitics megathread for {{date yyyy-MM-dd}}
frequency: daily
postTime: 02:00
sticky: true
maxComments: 1000
body: |
    This is the daily megathread for /r/ukpolitics.

    Use this post to discuss all aspects of politics in the UK.
endNote: |
    This thread is now closed. Please use the latest sticky megathread.
lockOnRefresh: true
```

### Weekly post on a specific day

Use a weekday frequency when you want one recurring thread per week.

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

### Scheduled non-sticky post

Use this for recurring posts that should be created on a schedule but should not take a sticky slot.

```yaml
name: overnight-roundup
enabled: true
title: Overnight links roundup for {{date yyyy-MM-dd}}
frequency: daily
postTime: 23:30
maxComments: 300
body: |
    This thread collects overnight links and updates.

    It is intentionally not stickied.
```

### Comment-cap-only live event thread

Omit both `frequency` and `postTime` to keep the thread open until it fills up.

```yaml
name: breaking-news
enabled: true
title: Breaking news megathread
sticky: true
maxComments: 2500
body: |
    Use this thread for fast-moving live coverage.

    A replacement thread will only be created when this post hits the comment cap.
endNote: |
    This live thread is full. Please continue in the newest megathread.
lockOnRefresh: true
```

### Mixed configuration page

You can combine daily, weekly, and comment-cap-only threads in the same wiki page.

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
