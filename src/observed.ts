// Every Devvit handler runs through `observed`: a failure is logged with the handler's name and how long it ran, then
// passed on for Devvit to record. Handlers that run rarely also log each success; the ones that fire on every
// comment, post deletion or mod action in the subreddit stay quiet, and the use cases log what they change.

type Handler<HandlerEvent, HandlerContext> = (event: HandlerEvent, context: HandlerContext) => Promise<void>;

/** Whether successful runs are logged too, or only failures. */
export type SuccessLogging = "failures only" | "every run";

export function observed<HandlerEvent, HandlerContext>(
    name: string,
    successLogging: SuccessLogging,
    handler: Handler<HandlerEvent, HandlerContext>,
): Handler<HandlerEvent, HandlerContext> {
    return async (event: HandlerEvent, context: HandlerContext): Promise<void> => {
        const startedAt = Date.now();
        try {
            await handler(event, context);
        } catch (error: unknown) {
            console.error(`${name} failed after ${String(Date.now() - startedAt)} ms:`, error);
            throw error;
        }

        if (successLogging === "every run") {
            console.log(`${name} finished in ${String(Date.now() - startedAt)} ms.`);
        }
    };
}
