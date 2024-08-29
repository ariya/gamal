/**
 * Creates a new function by chaining multiple async functions from left to right.
 *
 * @param  {...any} fns - Functions to chain
 */
export function pipe(...fns) {
    /**
     * @param {any} arg
     */
    return (arg) => fns.reduce((d, fn) => d.then(fn), Promise.resolve(arg));
}
