/** Whether to open a real Chromium window (headed mode). */

export function resolveHeaded(explicit?: boolean): boolean {
  if (typeof explicit === "boolean") return explicit;
  const h = process.env.SCRAPE_HEADED?.toLowerCase();
  if (h === "1" || h === "true" || h === "yes") return true;
  const headlessEnv = process.env.HEADLESS?.toLowerCase();
  if (headlessEnv === "0" || headlessEnv === "false") return true;
  return false;
}

/** Milliseconds Playwright waits between actions (optional, for debugging). */
export function resolveSlowMoMs(): number | undefined {
  const raw = process.env.SCRAPE_SLOW_MO_MS?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.floor(n), 5000);
}

/** Keeps the Chromium window open briefly in headed mode so you can see the final page (default 3s). */
export function resolveHeadedPauseMs(headed: boolean): number {
  if (!headed) return 0;
  const raw = process.env.SCRAPE_HEADED_PAUSE_MS?.trim();
  const n = raw !== undefined && raw !== "" ? Number(raw) : 3000;
  if (!Number.isFinite(n) || n < 0) return 3000;
  return Math.min(Math.floor(n), 120_000);
}
