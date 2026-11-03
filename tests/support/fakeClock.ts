import { onTestFinished, vi } from "vitest";

/** Fakes the clock at `isoTime` until the current test finishes. */
export function freezeTime(isoTime: string): void {
    vi.useFakeTimers({ now: new Date(isoTime) });
    onTestFinished((): void => {
        vi.useRealTimers();
    });
}

/**
 * Fakes only Date, at `isoTime`, until the current test finishes: durations measured with Date.now() read 0 ms, while
 * timers, and the streams an HTTP request's body is read through, run for real.
 */
export function freezeDate(isoTime: string): void {
    vi.useFakeTimers({ now: new Date(isoTime), toFake: ["Date"] });
    onTestFinished((): void => {
        vi.useRealTimers();
    });
}
