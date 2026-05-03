import { InvalidProductUrlError } from "./productUrl";

export const MAX_SCRAPE_ATTEMPTS = 3;

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  maxAttempts = MAX_SCRAPE_ATTEMPTS
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastError = e;
      if (e instanceof InvalidProductUrlError) throw e;
      if (attempt === maxAttempts - 1) break;
      await new Promise((r) => setTimeout(r, 350 + attempt * 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
