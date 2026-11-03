import { vi } from "vitest";
import type { Mock } from "vitest";
import type { ManagedComment, ManagedPost, Posts } from "../../src/rotation/index.js";

export interface FakePost {
    readonly post: ManagedPost;
    /** The comment addComment resolves to: the post's end note, once added. */
    readonly comment: ManagedComment;
    readonly addComment: Mock<ManagedPost["addComment"]>;
    readonly commentDistinguish: Mock<ManagedComment["distinguish"]>;
    readonly distinguish: Mock<ManagedPost["distinguish"]>;
    readonly edit: Mock<ManagedPost["edit"]>;
    readonly lock: Mock<ManagedPost["lock"]>;
    readonly sticky: Mock<ManagedPost["sticky"]>;
    readonly unsticky: Mock<ManagedPost["unsticky"]>;
}

export type FakePostFields = Readonly<
    Pick<ManagedPost, "body" | "createdAt" | "id" | "numberOfComments" | "stickied">
> &
    Readonly<Partial<Pick<ManagedPost, "distinguishedBy" | "locked">>>;

interface ModerationState {
    distinguishedBy: string | undefined;
    locked: boolean;
    stickied: boolean;
}

type ModerationActions = Pick<FakePost, "distinguish" | "lock" | "sticky" | "unsticky">;

/** A post's moderation state, and mocks of the actions that change it when they succeed, as on Reddit. */
function createModeration(
    fields: FakePostFields,
): Readonly<{ actions: ModerationActions; read: () => Readonly<ModerationState> }> {
    const state: ModerationState = {
        distinguishedBy: fields.distinguishedBy,
        locked: fields.locked ?? false,
        stickied: fields.stickied,
    };
    const changing =
        (change: () => void): (() => Promise<void>) =>
        async (): Promise<void> => {
            change();
            await Promise.resolve();
        };
    const actions: ModerationActions = {
        distinguish: vi.fn<ManagedPost["distinguish"]>().mockImplementation(
            changing((): void => {
                state.distinguishedBy = "moderator";
            }),
        ),
        lock: vi.fn<ManagedPost["lock"]>().mockImplementation(
            changing((): void => {
                state.locked = true;
            }),
        ),
        sticky: vi.fn<ManagedPost["sticky"]>().mockImplementation(
            changing((): void => {
                state.stickied = true;
            }),
        ),
        unsticky: vi.fn<ManagedPost["unsticky"]>().mockImplementation(
            changing((): void => {
                state.stickied = false;
            }),
        ),
    };
    return { actions, read: (): Readonly<ModerationState> => state };
}

/**
 * A ManagedPost whose actions are typed mocks. Distinguishing, locking and (un)stickying it change what it then reads
 * as, as on Reddit; a comment added to it resolves to `comment`, whose distinguish is its own mock.
 */
export function createFakePost(fields: FakePostFields): FakePost {
    const moderation = createModeration(fields);
    const commentDistinguish = vi.fn<ManagedComment["distinguish"]>().mockResolvedValue(undefined);
    const comment: ManagedComment = { id: `t1_${fields.id.replace("t3_", "")}`, distinguish: commentDistinguish };
    const addComment = vi.fn<ManagedPost["addComment"]>().mockResolvedValue(comment);
    const edit = vi.fn<ManagedPost["edit"]>().mockResolvedValue(undefined);

    return {
        post: {
            body: fields.body,
            createdAt: fields.createdAt,
            id: fields.id,
            numberOfComments: fields.numberOfComments,
            get distinguishedBy(): string | undefined {
                return moderation.read().distinguishedBy;
            },
            get locked(): boolean {
                return moderation.read().locked;
            },
            get stickied(): boolean {
                return moderation.read().stickied;
            },
            addComment,
            edit,
            ...moderation.actions,
        },
        comment,
        addComment,
        commentDistinguish,
        edit,
        ...moderation.actions,
    };
}

/** A posts.get that finds each of `posts` by its ID, and rejects any other ID as Reddit does a missing post. */
export function findingPostsById(posts: readonly ManagedPost[]): Posts["get"] {
    const byId = new Map(posts.map((post: ManagedPost): [string, ManagedPost] => [post.id, post]));
    return async (postId: string): Promise<ManagedPost> => {
        const post = byId.get(postId);
        return await (post === undefined ? Promise.reject(new Error(`no post ${postId}`)) : Promise.resolve(post));
    };
}
