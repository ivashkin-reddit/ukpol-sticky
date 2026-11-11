// Every Devvit handler runs through `observed`: a failure is logged with the handler's name and how long it ran, then
// passed on for Devvit to record, or for a mod UI route to answer with a fixed message. A handler's result, such as what
// a mod UI route shows next, passes through. Handlers that run rarely also log each success; the ones that fire on
// every comment, post deletion or mod action in the subreddit stay quiet, and the use cases log what they change.

type Handler<HandlerEvent, HandlerContext, Result> = (event: HandlerEvent, context: HandlerContext) => Promise<Result>;

/** Whether successful runs are logged too, or only failures. */
export type SuccessLogging = "failures only" | "every run";

export function observed<HandlerEvent, HandlerContext, Result>(
    name: string,
    successLogging: SuccessLogging,
    handler: Handler<HandlerEvent, HandlerContext, Result>,
): Handler<HandlerEvent, HandlerContext, Result> {
    return async (event: HandlerEvent, context: HandlerContext): Promise<Result> => {
        const startedAt = Date.now();
        try {
            const result = await handler(event, context);
            if (successLogging === "every run") {
                console.log(`${name} finished in ${String(Date.now() - startedAt)} ms.`);
            }

            return result;
        } catch (error: unknown) {
            console.error(`${name} failed after ${String(Date.now() - startedAt)} ms:`, error);
            throw error;
        }
    };
}
