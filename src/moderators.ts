import type { SubredditNamePort } from "./platform/index.js";

// Who made a request from Reddit's UI, and whether they moderate the subreddit. Every mod UI route asks this first,
// before it reads anything else.

/** A moderator of the subreddit: their name as Reddit gives it, and their permissions there. */
export interface Moderator {
    readonly username: string;
    readonly permissions: readonly string[];
}

/** A caller who does not moderate the subreddit, or a request with no user. */
export type NotAModerator = Readonly<{ kind: "other"; username: string | undefined }>;

export type Caller = NotAModerator | Readonly<{ kind: "moderator"; moderator: Moderator }>;

/** One entry of the subreddit's moderator listing. */
export type ModeratorEntry = Readonly<{
    username: string;
    moderatorInfo: Readonly<{ modPermissions: readonly string[] }>;
}>;

export type ModeratorsContext = SubredditNamePort &
    Readonly<{
        reddit: Readonly<{
            getCurrentUsername: () => Promise<string | undefined>;
            getModerators: (
                options: Readonly<{ subredditName: string; username: string }>,
            ) => Readonly<{ all: () => Promise<readonly ModeratorEntry[]> }>;
        }>;
    }>;

/**
 * Who made the request, and whether they moderate the subreddit. The test is the moderator listing filtered to the
 * caller: any moderator counts, one with no permissions included. getModPermissionsForSubreddit cannot tell such a
 * moderator from a user who is not one, as it gives both no permissions. The entry must name the caller, ignoring case,
 * as Reddit does.
 */
export async function identifyCaller(context: ModeratorsContext): Promise<Caller> {
    const username = await context.reddit.getCurrentUsername();
    if (username === undefined || username === "") {
        return { kind: "other", username: undefined };
    }

    const entries = await context.reddit.getModerators({ subredditName: context.subredditName, username }).all();
    const entry = entries.find(
        (candidate: ModeratorEntry): boolean => candidate.username.toLowerCase() === username.toLowerCase(),
    );
    return entry === undefined
        ? { kind: "other", username }
        : {
              kind: "moderator",
              moderator: { username: entry.username, permissions: entry.moderatorInfo.modPermissions },
          };
}
