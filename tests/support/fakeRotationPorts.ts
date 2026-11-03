import { vi } from "vitest";
import type { Mock } from "vitest";
import type { ThreadConfig } from "../../src/configuration/index.js";
import type {
    LivePosts,
    LoadThreadConfigs,
    ManagedComment,
    ManagedPost,
    Posts,
    RefreshJobs,
    RotationPorts,
} from "../../src/rotation/index.js";

export interface FakeLivePosts {
    readonly all: Mock<LivePosts["all"]>;
    readonly get: Mock<LivePosts["get"]>;
    readonly configNames: Mock<LivePosts["configNames"]>;
    readonly set: Mock<LivePosts["set"]>;
    readonly forget: Mock<LivePosts["forget"]>;
    readonly getCommentCap: Mock<LivePosts["getCommentCap"]>;
    readonly storeCommentCap: Mock<LivePosts["storeCommentCap"]>;
}

export interface FakeRotationPorts {
    readonly ports: RotationPorts;
    readonly livePosts: FakeLivePosts;
    readonly posts: Readonly<{ get: Mock<Posts["get"]>; publish: Mock<Posts["publish"]> }>;
    readonly refreshJobs: Readonly<{
        cancelAll: Mock<RefreshJobs["cancelAll"]>;
        scheduleAt: Mock<RefreshJobs["scheduleAt"]>;
    }>;
    readonly threadConfigs: Mock<LoadThreadConfigs>;
}

/** Rotation ports whose every method is a typed mock: no live posts, and `configs` as the thread configs in force. */
export function createFakeRotationPorts(configs: readonly ThreadConfig[] = []): FakeRotationPorts {
    const livePosts: FakeLivePosts = {
        all: vi.fn<LivePosts["all"]>().mockResolvedValue({}),
        get: vi.fn<LivePosts["get"]>().mockResolvedValue(undefined),
        configNames: vi.fn<LivePosts["configNames"]>().mockResolvedValue([]),
        set: vi.fn<LivePosts["set"]>().mockResolvedValue(undefined),
        forget: vi.fn<LivePosts["forget"]>().mockResolvedValue(undefined),
        getCommentCap: vi.fn<LivePosts["getCommentCap"]>().mockResolvedValue(undefined),
        storeCommentCap: vi.fn<LivePosts["storeCommentCap"]>().mockResolvedValue(undefined),
    };
    const posts = { get: vi.fn<Posts["get"]>(), publish: vi.fn<Posts["publish"]>() };
    const refreshJobs = {
        cancelAll: vi.fn<RefreshJobs["cancelAll"]>().mockResolvedValue(undefined),
        scheduleAt: vi.fn<RefreshJobs["scheduleAt"]>().mockResolvedValue(undefined),
    };
    const threadConfigs = vi.fn<LoadThreadConfigs>().mockResolvedValue(configs);

    return {
        ports: { livePosts, posts, refreshJobs, threadConfigs },
        livePosts,
        posts,
        refreshJobs,
        threadConfigs,
    };
}

export interface FakePost {
    readonly post: ManagedPost;
    readonly addComment: Mock<ManagedPost["addComment"]>;
    readonly commentDistinguish: Mock<ManagedComment["distinguish"]>;
    readonly distinguish: Mock<ManagedPost["distinguish"]>;
    readonly edit: Mock<ManagedPost["edit"]>;
    readonly lock: Mock<ManagedPost["lock"]>;
    readonly sticky: Mock<ManagedPost["sticky"]>;
    readonly unsticky: Mock<ManagedPost["unsticky"]>;
}

export type FakePostFields = Readonly<Pick<ManagedPost, "body" | "createdAt" | "id" | "numberOfComments" | "stickied">>;

/** A ManagedPost whose actions are typed mocks; a comment added to it resolves to a comment with its own mock. */
export function createFakePost(fields: FakePostFields): FakePost {
    const commentDistinguish = vi.fn<ManagedComment["distinguish"]>().mockResolvedValue(undefined);
    const addComment = vi.fn<ManagedPost["addComment"]>().mockResolvedValue({ distinguish: commentDistinguish });
    const distinguish = vi.fn<ManagedPost["distinguish"]>().mockResolvedValue(undefined);
    const edit = vi.fn<ManagedPost["edit"]>().mockResolvedValue(undefined);
    const lock = vi.fn<ManagedPost["lock"]>().mockResolvedValue(undefined);
    const sticky = vi.fn<ManagedPost["sticky"]>().mockResolvedValue(undefined);
    const unsticky = vi.fn<ManagedPost["unsticky"]>().mockResolvedValue(undefined);

    return {
        post: { ...fields, addComment, distinguish, edit, lock, sticky, unsticky },
        addComment,
        commentDistinguish,
        distinguish,
        edit,
        lock,
        sticky,
        unsticky,
    };
}
