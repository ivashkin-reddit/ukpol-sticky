import { describe, expect, it } from "vitest";
import { createFakeDevvitContext, listingOf } from "../tests/support/fakeDevvitContext.js";
import { canManagePosts, identifyCaller } from "./moderators.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(identifyCaller, (): void => {
    it.for<string | undefined>([undefined, ""])(
        "treats a request with no user (%j) as no moderator, without listing moderators",
        TEST_OPTIONS,
        async (username: string | undefined): Promise<void> => {
            expect.assertions(2);

            const { context, reddit } = createFakeDevvitContext();
            reddit.getCurrentUsername.mockResolvedValue(username);

            await expect(identifyCaller(context)).resolves.toStrictEqual({ kind: "other", username: undefined });
            expect(reddit.getModerators).not.toHaveBeenCalled();
        },
    );

    it("asks the listing about the caller in the request's subreddit", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { context, reddit } = createFakeDevvitContext();
        reddit.getCurrentUsername.mockResolvedValue("someone");

        await expect(identifyCaller(context)).resolves.toStrictEqual({ kind: "other", username: "someone" });
        expect(reddit.getModerators).toHaveBeenCalledExactlyOnceWith({
            subredditName: "testsub",
            username: "someone",
        });
    });

    it("does not take another user's entry for the caller's", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { context, reddit } = createFakeDevvitContext();
        reddit.getCurrentUsername.mockResolvedValue("someone");
        reddit.getModerators.mockReturnValue(listingOf([{ username: "a_moderator", permissions: ["all"] }]));

        await expect(identifyCaller(context)).resolves.toStrictEqual({ kind: "other", username: "someone" });
    });

    it(
        "identifies a moderator whose name differs only in case, with their permissions",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const { context, reddit } = createFakeDevvitContext();
            reddit.getCurrentUsername.mockResolvedValue("mod_user");
            reddit.getModerators.mockReturnValue(listingOf([{ username: "Mod_User", permissions: ["posts", "wiki"] }]));

            await expect(identifyCaller(context)).resolves.toStrictEqual({
                kind: "moderator",
                moderator: { username: "Mod_User", permissions: ["posts", "wiki"] },
            });
        },
    );

    it("counts a moderator with no permissions as a moderator", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { context, reddit } = createFakeDevvitContext();
        reddit.getCurrentUsername.mockResolvedValue("mod_user");
        reddit.getModerators.mockReturnValue(listingOf([{ username: "mod_user", permissions: [] }]));

        await expect(identifyCaller(context)).resolves.toStrictEqual({
            kind: "moderator",
            moderator: { username: "mod_user", permissions: [] },
        });
    });
});

describe(canManagePosts, (): void => {
    it.for<readonly string[]>([["all"], ["posts"], ["wiki", "posts"]])(
        "lets a moderator with %j change posts",
        TEST_OPTIONS,
        (permissions: readonly string[]): void => {
            expect.assertions(1);

            expect(canManagePosts({ username: "mod_user", permissions })).toBe(true);
        },
    );

    it.for<readonly string[]>([[], ["wiki"], ["mail", "flair"]])(
        "refuses a moderator with %j",
        TEST_OPTIONS,
        (permissions: readonly string[]): void => {
            expect.assertions(1);

            expect(canManagePosts({ username: "mod_user", permissions })).toBe(false);
        },
    );
});
