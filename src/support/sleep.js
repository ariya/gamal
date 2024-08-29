/**
 * Suspends the execution for a specified amount of time.
 *
 * @param {number} ms - The amount of time to suspend execution in milliseconds.
 * @returns {Promise<void>} - A promise that resolves after the specified time has elapsed.
 */
export async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
