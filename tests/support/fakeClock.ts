import { onTestFinished, vi } from "vitest";

/** Fakes the clock at `isoTime` until the current test finishes. */
export function freezeTime (isoTime: string): void {
    vi.useFakeTimers({ now: new Date(isoTime) });
    onTestFinished((): void => {
        vi.useRealTimers();
    });
}
