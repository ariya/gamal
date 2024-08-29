/**
 * @template I, O
 * @typedef {(input: I) => Promise<O>} Fn
 */

/**
 * @param {...Fn<any, any>} fns
 * @returns {(input: any) => Promise<any>}
 */
const createPipeline = (...fns) => {
    return (arg) => fns.reduce((d, fn) => d.then(fn), Promise.resolve(arg));
};

/**
 * This is a better typed version of createPipeline above.
 *
 * @type {{
 *   <A, R>(...fns: [Fn<A, R>]): (input: A) => Promise<R>
 *   <A, B, R>(...fns: [Fn<A, B>, Fn<B, R>]): (input: A) => Promise<R>
 *   <A, B, C, R>(...fns: [Fn<A, B>, Fn<B, C>, Fn<C, R>]): (input: A) => Promise<R>
 *   <A, B, C, D, R>(...fns: [Fn<A, B>, Fn<B, C>, Fn<C, D>, Fn<D, R>]): (input: A) => Promise<R>
 * }}
 */
export const pipe = createPipeline;
