/** A mock as far as its calls go: all a check that a use case only reads asks of a writing method. */
export type CalledMock = Readonly<{ mock: Readonly<{ calls: readonly unknown[] }> }>;

/** A set of fakes' writing methods, by name. */
export type Writes = Readonly<Record<string, CalledMock>>;

/** The names of the writing methods in `writes` that were called: none, for a use case that only reads. */
export function writesMade(writes: Writes): readonly string[] {
    return Object.entries(writes)
        .filter(([, method]: readonly [string, CalledMock]): boolean => method.mock.calls.length > 0)
        .map(([name]: readonly [string, CalledMock]): string => name);
}
