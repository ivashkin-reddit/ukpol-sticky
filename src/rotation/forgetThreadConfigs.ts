import { refreshOrder } from "./domain/rotationRules.js";
import type { PendingRefresh, RotationPorts } from "./ports.js";

export type ForgetPorts = Pick<
    RotationPorts,
    "appliedThreadConfigs" | "livePosts" | "refreshJobs" | "refreshStatus" | "threadConfigs" | "threadFailureAlert"
>;

/**
 * Forgets the named thread configs, as when they are no longer in force: their live posts, unfinished handovers and
 * comment caps, their applied versions and refresh status, their failure alerts' latches, and their pending
 * refreshes. A thread config added later under the same name starts clean.
 */
export async function forgetThreadConfigs(configNames: readonly string[], ports: ForgetPorts): Promise<void> {
    if (configNames.length === 0) {
        return;
    }

    const livePostIds = await ports.livePosts.all();
    const postIds = configNames.flatMap((configName): string[] => {
        const postId = livePostIds[configName];
        return postId === undefined ? [] : [postId];
    });
    await ports.livePosts.forget(configNames, postIds);
    await ports.appliedThreadConfigs.forget(configNames);
    await ports.refreshStatus.forget(configNames);
    await Promise.all(
        configNames.map(async (configName: string): Promise<void> => {
            await ports.threadFailureAlert(configName).release();
            await ports.refreshJobs.cancelFor(configName);
        }),
    );
}

/** The names of the thread configs the app has recorded: by a live post or handover, an applied version, or a job. */
async function findRecordedConfigNames(ports: ForgetPorts): Promise<ReadonlySet<string>> {
    const pendingNames = (await ports.refreshJobs.pending()).flatMap((refresh: PendingRefresh): string[] =>
        refresh.configName === undefined ? [] : [refresh.configName],
    );
    return new Set([
        ...(await ports.livePosts.configNames()),
        ...(await ports.appliedThreadConfigs.configNames()),
        ...pendingNames,
    ]);
}

/**
 * Forgets every thread config the app has recorded that is no longer in force, and logs which. The thread configs in
 * force are read after the recorded names, never taken from earlier, so one added in between is kept.
 */
export async function forgetRemovedThreadConfigs(ports: ForgetPorts): Promise<void> {
    const recorded = await findRecordedConfigNames(ports);
    const inForce = new Set(refreshOrder(await ports.threadConfigs()).map((config): string => config.name));
    const removed = [...recorded].filter((configName): boolean => !inForce.has(configName));
    if (removed.length > 0) {
        console.log(`Forgetting removed or disabled thread configs: ${removed.join(", ")}.`);
        await forgetThreadConfigs(removed, ports);
    }
}
