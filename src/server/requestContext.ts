import { context, reddit, redis, scheduler } from "@devvit/web/server";
import type { DevvitContext } from "../composition.js";

/**
 * The Devvit context of the request being served: Devvit Web's clients, which act for the request's installation, and
 * the subreddit and app its request context names. Devvit's request context exists only while a request is served, so
 * call this then, once per request.
 */
export function requestContext(): DevvitContext {
    return {
        appSlug: context.appSlug,
        reddit,
        redis,
        scheduler,
        subredditId: context.subredditId,
        subredditName: context.subredditName,
    };
}
