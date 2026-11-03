export interface Deferred<Value> {
    readonly promise: Promise<Value>;
    readonly resolve: (value: Value) => void;
}

/** A promise and the function that settles it, for holding an async step open while a test inspects the caller. */
export function defer<Value>(): Deferred<Value> {
    const resolvers: ((value: Value) => void)[] = [];
    const promise = new Promise<Value>((resolvePromise): void => {
        resolvers.push(resolvePromise);
    });

    return {
        promise,
        resolve: (value: Value): void => {
            for (const resolver of resolvers) {
                resolver(value);
            }
        },
    };
}
