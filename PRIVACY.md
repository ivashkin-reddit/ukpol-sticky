# Privacy Policy

Last updated: 2026-04-22

This policy applies to the Reddit app published from this repository, including the app shown in Reddit as `ukpol-megabot`.

## What this app is

This is a simple subreddit moderation app. It reads a subreddit wiki config page and uses Reddit's Devvit APIs to manage recurring or comment-cap-limited threads.

It only uses the data needed to do that job.

## What data it uses

The app may process:

- The contents of the subreddit wiki page `stickymgr/config`
- Moderator usernames on wiki update events
- Subreddit name and subreddit ID
- Managed post IDs, titles, bodies, creation times, and comment counts
- Post deletion events
- Small amounts of stored app state such as the last wiki revision, saved config, active tracked post IDs, and stored comment-cap values

## What it uses that data for

The app uses that data to:

- Validate config changes
- Schedule refresh jobs
- Create, update, sticky, unsticky, lock, and rotate managed posts
- Detect when a thread has hit its comment cap
- Clean up stored state when configs or tracked posts change

## What it does not do

This app does not intentionally:

- Sell data
- Run ads
- Build user profiles
- Ask users for extra personal information
- Send data to unrelated third parties

## Where processing happens

This app runs on Reddit's Devvit platform, so normal app processing happens through Reddit and Devvit services.

## Data retention

The app keeps only the small amount of stored state it needs to keep working. Some stored values expire automatically, and some remain until they are replaced, removed, or the app is uninstalled.

Reddit may also keep its own records under Reddit's own policies.

## Your choices

Subreddit moderators control this app by editing the wiki config, disabling configs, removing configs, or uninstalling the app.

If you are a normal Reddit user rather than a moderator, Reddit's own privacy policy is the main policy that applies to your Reddit account data.

## Security

The app is meant to use only the Reddit and Devvit permissions it needs for moderation automation and app storage. No system is perfect, but the app is designed to keep stored data limited.

## Changes

This policy may change over time. The version in this repository is the current one.

## Contact

If you have questions about this policy, use the GitHub repository where this file is published.

