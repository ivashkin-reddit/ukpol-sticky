import { vi } from "vitest";
import type { MockInstance } from "vitest";

/** Replaces console.<method> with a silent spy for the current test; vitest restores it afterwards. */
export function silenceConsole(method: "error" | "log" | "warn"): MockInstance<(...data: readonly unknown[]) => void> {
    return vi.spyOn(console, method).mockImplementation((): undefined => undefined);
}
