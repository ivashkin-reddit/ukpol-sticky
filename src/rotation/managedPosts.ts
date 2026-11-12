import { getPin } from "../configuration/index.js";
import type { Pin, ThreadConfig } from "../configuration/index.js";
import type { Handover, RotationPorts } from "./ports.js";

// A post as a managed thread's: whose live post it is, and the lock its refreshes hold, which a moderator's pin of it
// holds too.

/** The thread config whose live post, or whose unfinished handover's post, `postId` is. */
async function findConfigName(postId: string, ports: Pick<RotationPorts, "livePosts">): Promise<string | undefined> {
    const [livePosts, handovers] = await Promise.all([ports.livePosts.all(), ports.livePosts.handovers()]);
    const live = Object.entries(livePosts).find(
        ([, livePostId]: readonly [string, string]): boolean => livePostId === postId,
    );
    const handingOver = Object.entries(handovers).find(
        ([, handover]: readonly [string, Handover]): boolean =>
            handover.newPostId === postId || handover.oldPostId === postId,
    );
    return (live ?? handingOver)?.[0];
}

/** Releases the thread config's lock after `run`, whether it succeeded or failed. */
async function runHolding<Result>(
    configName: string,
    run: () => Promise<Result>,
    ports: Pick<RotationPorts, "threadLocks">,
): Promise<Result> {
    try {
        return await run();
    } finally {
        await ports.threadLocks.unlock(configName);
    }
}

/**
 * Runs `run` holding the lock of the thread config whose live post (or unfinished handover's post) `postId` is, as a
 * refresh does, so a moderator's pin never interleaves with its rotation; any other post runs without a lock. Busy
 * while another invocation holds that lock.
 */
export async function holdLivePostLock<Result>(
    postId: string,
    run: () => Promise<Result>,
    ports: Pick<RotationPorts, "livePosts" | "threadLocks">,
): Promise<Readonly<{ kind: "busy" }> | Readonly<{ kind: "ran"; result: Result }>> {
    const configName = await findConfigName(postId, ports);
    if (configName === undefined) {
        return { kind: "ran", result: await run() };
    }

    if (!(await ports.threadLocks.tryLock(configName))) {
        return { kind: "busy" };
    }

    return { kind: "ran", result: await runHolding(configName, run, ports) };
}

/** The thread config in force whose live post a post is, and how it pins its live posts. */
export interface ManagingThread {
    readonly configName: string;
    readonly pin: Pin;
}

/** The enabled thread config whose live post `postId` is; undefined for any other post. */
export async function findManagingThread(
    postId: string,
    ports: Pick<RotationPorts, "livePosts" | "threadConfigs">,
): Promise<ManagingThread | undefined> {
    const [livePosts, configs] = await Promise.all([ports.livePosts.all(), ports.threadConfigs()]);
    const config = configs.find(
        (candidate: ThreadConfig): boolean =>
            candidate.enabled && Object.hasOwn(livePosts, candidate.name) && livePosts[candidate.name] === postId,
    );
    return config === undefined ? undefined : { configName: config.name, pin: getPin(config) };
}
