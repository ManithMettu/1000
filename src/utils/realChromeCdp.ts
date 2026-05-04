import { existsSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright";

/** Default profile dir per OS (override with `SCRAPER_CHROME_USER_DATA`). */
function defaultChromeUserDataDir(): string {
  const sys = platform();
  if (sys === "win32") {
    const base = process.env.LOCALAPPDATA || process.env.USERPROFILE || homedir();
    return path.join(base, "product-scraper-chrome-profile");
  }
  if (sys === "darwin") {
    return path.join(homedir(), "Desktop", "meesho_profile");
  }
  /* Linux and others: XDG-style path (no Desktop required). */
  return path.join(homedir(), ".local", "share", "product-scraper-chrome-profile");
}

export const CHROME_USER_DATA_DIR =
  process.env.SCRAPER_CHROME_USER_DATA ?? defaultChromeUserDataDir();

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

/**
 * Matches `scraper_service.py`: `launch_persistent_context` with real Chrome,
 * `headless=False` (unless `SCRAPER_CHROME_HEADLESS=1`), `no_viewport=True`,
 * and `args: --start-maximized`, `--disable-blink-features=AutomationControlled`.
 */
export async function launchChromePersistentContext(): Promise<BrowserContext> {
  mkdirSync(CHROME_USER_DATA_DIR, { recursive: true });

  const headless = process.env.SCRAPER_CHROME_HEADLESS === "1";
  const exe = resolveChromeExecutable();

  const common = {
    headless,
    viewport: null,
    args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
  };

  if (exe) {
    return chromium.launchPersistentContext(CHROME_USER_DATA_DIR, {
      ...common,
      executablePath: exe,
      channel: inferBrowserChannel(exe),
    });
  }

  /* Let Playwright resolve Google Chrome from the OS (default installs). */
  return chromium.launchPersistentContext(CHROME_USER_DATA_DIR, {
    ...common,
    channel: "chrome",
  });
}
