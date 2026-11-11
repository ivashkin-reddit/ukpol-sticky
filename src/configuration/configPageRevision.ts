import type { ModeratorAlert } from "../notifications/index.js";
import { checkConfigPage } from "./configPageCheck.js";
import type { ConfigPageProblem } from "./configPageCheck.js";
import { describeProblem, summarizeProblem } from "./configProblemWording.js";
import type { ThreadConfig } from "./domain/threadConfig.js";
import type { ConfigPageRevision, ConfigurationPorts } from "./ports.js";
import { storeThreadConfigs } from "./storedConfigs.js";

/** What became of a config page revision: its thread configs were stored, or why they were not. */
export type ConfigPageOutcome = "rejected" | "stored" | "unavailable" | "unchanged";

type Rejection = Readonly<{ alert: ModeratorAlert; summary: string }>;

/** How a revision with `problem` is rejected: the alert to whoever saved it, and the log's summary. */
function rejectionFor(problem: ConfigPageProblem, addressee: string): Rejection {
    return { alert: describeProblem(problem, addressee), summary: summarizeProblem(problem) };
}

type RevisionRead =
    Readonly<{ kind: "new"; revision: ConfigPageRevision }> | Readonly<{ kind: "unavailable" | "unchanged" }>;

/**
 * Reads the config page, telling a revision not yet checked from one already accepted or rejected, or a failed read.
 * Every wiki revision in the subreddit (usernotes, the AutoModerator page) triggers a read, so remembering the
 * rejected revision keeps moderators from being alerted to it again.
 */
async function readNewRevision(ports: Pick<ConfigurationPorts, "page" | "store">): Promise<RevisionRead> {
    const acceptedRevision = await ports.store.readAcceptedRevision();
    const rejectedRevision = await ports.store.readRejectedRevision();
    const revision = await ports.page.read();
    if (revision === undefined) {
        return { kind: "unavailable" };
    }

    if (revision.revisionId === acceptedRevision || revision.revisionId === rejectedRevision) {
        const verdict = revision.revisionId === acceptedRevision ? "accepted" : "rejected";
        console.log(`Config page revision ${revision.revisionId} is already ${verdict}.`);
        return { kind: "unchanged" };
    }

    return { kind: "new", revision };
}

async function rejectRevision(
    revision: ConfigPageRevision,
    rejection: Rejection,
    ports: Pick<ConfigurationPorts, "notifyModerators" | "store">,
): Promise<void> {
    console.warn(`Rejected config page revision ${revision.revisionId}: ${rejection.summary}.`);
    await ports.notifyModerators(rejection.alert);
    // Recorded once the alert is sent, so an alert that failed to send is retried by the next wiki revision event.
    await ports.store.writeRejectedRevision(revision.revisionId);
}

async function acceptRevision(
    revision: ConfigPageRevision,
    configs: readonly ThreadConfig[],
    ports: ConfigurationPorts,
): Promise<void> {
    // Thread configs first: a failure in between then leaves the revision unaccepted, so applying it again stores them.
    await storeThreadConfigs(configs, ports);
    await ports.store.writeAcceptedRevision(revision.revisionId);
    console.log(`Accepted config page revision ${revision.revisionId}: ${String(configs.length)} thread configs.`);
}

// Saves close together can be applied out of order, the older one last. Reading the page again after storing a
// revision finds the newer one, which is applied in turn; at most this many in one go, should moderators keep saving.
const MAX_REVISIONS_PER_APPLY = 3;

/**
 * Whom an alert about a revision opens with: the moderator who saved it, or the one the wiki revision event names,
 * or moderators at large when neither is known.
 */
function addresseeOf(revision: ConfigPageRevision, moderatorName: string | undefined): string {
    const name = revision.authorName ?? moderatorName;
    return name === undefined ? "Moderators" : `/u/${name}`;
}

async function applyRevision(
    revision: ConfigPageRevision,
    moderatorName: string | undefined,
    ports: ConfigurationPorts,
): Promise<"rejected" | "stored"> {
    const check = checkConfigPage(revision.content);
    if (check.kind === "invalid") {
        await rejectRevision(revision, rejectionFor(check.problem, addresseeOf(revision, moderatorName)), ports);
        return "rejected";
    }

    await acceptRevision(revision, check.configs, ports);
    return "stored";
}

async function applyNewRevisions(
    moderatorName: string | undefined,
    ports: ConfigurationPorts,
    revisionsLeft: number,
): Promise<ConfigPageOutcome> {
    const read = await readNewRevision(ports);
    if (read.kind !== "new") {
        return read.kind;
    }

    const outcome = await applyRevision(read.revision, moderatorName, ports);
    if (outcome === "stored" && revisionsLeft > 1) {
        // Whatever the newer revision brings, the thread configs this one stored need a refresh.
        await applyNewRevisions(moderatorName, ports, revisionsLeft - 1);
    }

    return outcome;
}

/**
 * Reads the config page, after a moderator revised it or to catch a revision nothing applied. A revision not yet
 * accepted or rejected is checked: its thread configs are stored, or moderators are alerted to its first config problem
 * and the previously stored configs stay in force. `moderatorName` is whom the wiki revision event names, if one did.
 */
export async function applyConfigPageRevision(
    moderatorName: string | undefined,
    ports: ConfigurationPorts,
): Promise<ConfigPageOutcome> {
    return await applyNewRevisions(moderatorName, ports, MAX_REVISIONS_PER_APPLY);
}
