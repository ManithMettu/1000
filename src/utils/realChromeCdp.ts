import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright";

/**
 * Resolves a real Chrome/Chromium binary. Checks env first, then common install locations.
 * Returns `undefined` if none found — Playwright will use `channel` lookup (works when Chrome is on PATH / default install).
 */
export function resolveChromeExecutable(): string | undefined {
  for (const key of ["SCRAPER_CHROME_EXECUTABLE", "CHROME_PATH", "GOOGLE_CHROME_BIN"]) {
    const v = process.env[key];
    if (v && existsSync(v)) return v;
  }

  const sys = platform();

  if (sys === "darwin") {
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.join(homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return undefined;
  }

  if (sys === "win32") {
    const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const localApp = process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local");
    const candidates = [
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(localApp, "Google", "Chrome", "Application", "chrome.exe"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return undefined;
  }

  /* Linux, freebsd, etc. */
  const linuxCandidates = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/var/lib/flatpak/exports/bin/com.google.Chrome",
  ];
  for (const c of linuxCandidates) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

function inferBrowserChannel(executablePath: string): "chrome" | "chromium" {
  const lower = executablePath.toLowerCase();
  if (lower.includes("chromium") && !lower.includes("google chrome")) return "chromium";
  return "chrome";
}

export interface LaunchedChromePersistent {
  context: BrowserContext;
  /** Empty temp user-data dir; delete after `context.close()` so no profile is reused. */
  userDataDir: string;
}

/**
 * `headed === true`: visible Chrome (e.g. UI checkbox “Show Chrome window (live)”).
 * `headed === false`: headless in the background (`headless: true`).
 * Always uses a **new** temp profile directory (never reuses `~/Desktop/meesho_profile` or similar).
 */
export async function launchChromePersistentContext(headed: boolean): Promise<LaunchedChromePersistent> {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "product-scraper-chrome-"));

  const headless = !headed;
  const exe = resolveChromeExecutable();

  const args = headed
    ? ["--start-maximized", "--disable-blink-features=AutomationControlled"]
    : ["--disable-blink-features=AutomationControlled"];

  const common = {
    headless,
    viewport: null,
    args,
  };

  try {
    if (exe) {
      const context = await chromium.launchPersistentContext(userDataDir, {
        ...common,
        executablePath: exe,
        channel: inferBrowserChannel(exe),
      });
      return { context, userDataDir };
    }

    const context = await chromium.launchPersistentContext(userDataDir, {
      ...common,
      channel: "chrome",
    });
    return { context, userDataDir };
  } catch (err) {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw err;
  }
}
