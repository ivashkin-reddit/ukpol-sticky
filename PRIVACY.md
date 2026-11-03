# Privacy Policy

Last updated: 3 November 2026

This policy covers Sticky Manager, the Reddit app published from this repository as **ukpol-megabot**.

## Summary

Sticky Manager is a moderation tool. It reads its configuration from a subreddit wiki page and uses Reddit's Devvit APIs to publish and rotate recurring threads. It processes only what it needs for that job, stores no personal information, and sends nothing outside Reddit.

## Information the app processes

- **The config page:** the content and revision IDs of the wiki page `stickymgr/config`.
- **Wiki revision events:** the username of the moderator who saved the page, used only to address them in a modmail if the page is rejected. Other moderator actions are ignored.
- **Comment events:** for each new comment in the subreddit, the post it was made on and its author's username. The app uses these only to count comments towards a thread's comment cap and to skip its own comments. It does not use or store comment text.
- **Post deletion events:** the ID of the deleted post, so the app can stop tracking it.
- **Managed posts:** the ID, creation time, body and comment count of each post the app manages.
- **The subreddit's name.**

## Information the app stores

The app keeps a small amount of state in the storage Devvit provides for each installation:

- the accepted thread configs, and the IDs of the most recently accepted and rejected config page revisions;
- the ID of each thread's current post, and its comment cap;
- while a rotation is in progress, the IDs of the posts it is replacing and publishing, and of the end note it added, so an interrupted rotation can be finished;
- the refresh status: when refreshes last ran and succeeded, how the last one ended, and when the next is due;
- short-lived locks that stop two refreshes changing the same thread at once;
- markers recording that moderators have already been alerted to an ongoing problem.

None of this identifies a Reddit user.

## How the information is used

The app uses this information to:

- check configuration changes;
- publish, edit, distinguish, sticky, unsticky and lock managed posts, and add end-note comments;
- detect when a thread reaches its comment cap or its scheduled time;
- send the subreddit's moderators modmail when the configuration is rejected or a refresh fails;
- schedule its next refresh.

## Sharing

The app runs entirely on Reddit's Devvit platform and makes no requests to services outside Reddit; its Devvit permissions do not allow it to. It does not sell data, show ads, build profiles of users, or share data with third parties.

## Retention

- Locks expire after two minutes.
- A rotation's record is deleted as soon as the rotation is finished.
- A marker that moderators are being alerted expires after ten minutes, unless the alert was sent; then it is kept until the problem is over.
- A post's comment-cap record is deleted when the post is replaced, and expires after 28 days in any case.
- A thread's records are deleted when the thread is removed from the config page or its post is deleted.
- Other state is kept until it is replaced.
- Uninstalling the app deletes everything it stores in that subreddit.

Reddit keeps its own records under the [Reddit Privacy Policy](https://www.reddit.com/policies/privacy-policy).

## Your choices

Moderators control the app through the config page, and can disable or remove threads, or uninstall the app, at any time. For data in your Reddit account, Reddit's own privacy policy applies.

## Changes

Changes to this policy are published in this repository, and the date at the top is updated.

## Contact

Questions about this policy can be raised at <https://github.com/ivashkin-reddit/ukpol-sticky/issues>.
