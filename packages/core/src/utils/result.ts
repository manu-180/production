/**
 * Result<T, E> — a lightweight discriminated union for explicit error handling.
 * Avoids thrown exceptions for expected failure paths.
 *
 * Usage:
 *   function divide(a: number, b: number): Result<number, string> {
 *     if (b === 0) return err("division by zero");
 *     return ok(a / b);
 *   }
 *   const result = divide(10, 2);
 *   if (result.ok) console.log(result.value); // 5
 *   else console.error(result.error);
 */

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

/** Wrap a successful value. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Wrap a failure. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Narrow a Result to its success value, or throw the error. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error;
}

/** Map the success value of a Result, leaving errors untouched. */
export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (result.ok) return ok(fn(result.value));
  return result;
}

/** Async-safe wrapper: converts a Promise into a Result, catching rejections. */
export async function tryAsync<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
