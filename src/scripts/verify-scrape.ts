/**
 * Acceptance checks against real PDP URLs. Run: npm run test:sites
 * Pass custom URLs: npm run test:sites -- https://... https://...
 */

import { detectPlatform, scrapeProduct } from "../scraper";
import type { ProductPayload } from "../types";
import { cacheDelete } from "../utils/cache";
import { InvalidProductUrlError } from "../utils/productUrl";

const DEFAULT_CASES: { label: string; url: string }[] = [
  {
    label: "Amazon (VAYA lunch box)",
    url: "https://www.amazon.in/VAYA-Leak-Resistant-Containers-Lightweight-Portion-Control/dp/B0F7M17H8S/?_encoding=UTF8&pd_rd_w=zSP6A&content-id=amzn1.sym.c7f0f407-4f52-45a3-96bf-6af296fa6d55&pf_rd_p=c7f0f407-4f52-45a3-96bf-6af296fa6d55&pf_rd_r=R3HCKG85NCNNDKWNV60Q&pd_rd_wg=vRtRW&pd_rd_r=db137d68-3d1b-4e46-a303-be0f227d5908&ref_=pd_hp_d_btf_LPDEALS&th=1",
  },
  {
    label: "Flipkart (Campus shoes PDP)",
    url: "https://www.flipkart.com/campus-hurricane-running-shoes-men/p/itme55da032c2427?pid=SHOG6BNZCWQZ5YZZ&lid=LSTSHOG6BNZCWQZ5YZZX5SIOI&marketplace=FLIPKART&store=osp%2Fcil%2F1cu&srno=b_1_1&otracker=browse&fm=organic&iid=d8df3425-556e-4a4c-9e96-9d14d9126b6c.SHOG6BNZCWQZ5YZZ.SEARCH&ppt=browse&ppn=browse&ssid=tzc7tbwfeo0000001777792497223&ov_redirect=true",
  },
  {
    label: "Meesho (pack of 4 t-shirts)",
    url: "https://www.meesho.com/ftx-pack-of-4-mens-solid-regular-round-multicolor-tshirts/p/1bc9wl",
  },
];

function collectIssues(data: ProductPayload): string[] {
  const issues: string[] = [];
  if (!data.title) issues.push("missing title");
  if (!data.price) issues.push("missing price");
  if (!data.images.length) issues.push("no images");
  if (!data.rating && data.platform !== "meesho") issues.push("missing rating (optional)");
  return issues;
}

function parseCliCases(): { label: string; url: string }[] {
  const argv = process.argv.slice(2);
  const urls = argv.filter((a) => /^https?:\/\//i.test(a));
  const cases =
    urls.length > 0
      ? urls.map((url, i) => ({ label: `CLI URL ${i + 1}`, url }))
      : DEFAULT_CASES;
  return cases.map((c) => ({ ...c, url: c.url.trim() }));
}

export async function runVerify(options?: {
  cases?: { label: string; url: string }[];
  headed?: boolean;
  screenshot?: boolean;
}): Promise<{ ok: boolean; failures: number }> {
  const argv = process.argv.slice(2);
  const headedFromCli = argv.includes("--headed");
  const screenshotFromCli = argv.includes("--screenshot");

  const cases = options?.cases ?? parseCliCases();
  const headed = options?.headed ?? headedFromCli;
  const screenshot = options?.screenshot ?? screenshotFromCli;

  let failures = 0;
  console.log("\n=== Product scrape verification ===\n");

  for (const { label, url } of cases) {
    const platform = detectPlatform(url);
    console.log(`▸ ${label}`);
    console.log(`  URL: ${url.slice(0, 100)}${url.length > 100 ? "…" : ""}`);
    console.log(`  Platform: ${platform ?? "unknown"}`);

    cacheDelete(url);
    const start = Date.now();

    try {
      const result = await scrapeProduct(url, { screenshot, headed });
      const ms = Date.now() - start;
      const d = result.data;
      const issues = collectIssues(d);
      const titleStr = d.title ?? "";
      const titlePreview =
        titleStr.length === 0 ? "(empty)" : titleStr.length > 80 ? `${titleStr.slice(0, 80)}…` : titleStr;

      console.log(`  Status: OK (${result.source}) in ${ms}ms`);
      console.log(`  title: ${titlePreview}`);
      console.log(`  price: ${d.price ?? "(empty)"}`);
      console.log(`  images: ${d.images.length}`);

      const serious = issues.filter((x) => !x.includes("optional"));
      if (serious.length) {
        console.log(`  ⚠ Data gaps: ${serious.join("; ")}`);
      }
      if (issues.some((x) => x.includes("optional"))) {
        console.log(`  ℹ ${issues.find((x) => x.includes("optional"))}`);
      }
      if (result.screenshot_path) console.log(`  screenshot: ${result.screenshot_path}`);
    } catch (e) {
      failures += 1;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  Status: FAIL (${Date.now() - start}ms)`);
      console.log(`  Error: ${msg}`);
      if (e instanceof InvalidProductUrlError) {
        console.log("  Hint: use a single-product PDP link (e.g. Flipkart path must contain /p/itm…).");
      }
    }
    console.log("");
  }

  const ok = failures === 0;
  console.log(ok ? "=== All runs completed (no thrown errors) ===\n" : `=== Done: ${failures} failure(s) ===\n`);
  return { ok, failures };
}

async function main(): Promise<void> {
  const { ok } = await runVerify();
  process.exit(ok ? 0 : 1);
}

void main();
