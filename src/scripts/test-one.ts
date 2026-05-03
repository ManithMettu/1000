/**
 * Quick single-platform test. Usage:
 *   node dist/scripts/test-one.js amazon
 *   node dist/scripts/test-one.js flipkart
 *   node dist/scripts/test-one.js meesho
 */
import { scrapeProduct } from "../scraper";
import { cacheDelete } from "../utils/cache";

const URLS: Record<string, string> = {
  amazon:
    "https://www.amazon.in/VAYA-Leak-Resistant-Containers-Lightweight-Portion-Control/dp/B0F7M17H8S/?_encoding=UTF8&pd_rd_w=zSP6A&content-id=amzn1.sym.c7f0f407-4f52-45a3-96bf-6af296fa6d55&pf_rd_p=c7f0f407-4f52-45a3-96bf-6af296fa6d55&pf_rd_r=R3HCKG85NCNNDKWNV60Q&pd_rd_wg=vRtRW&pd_rd_r=db137d68-3d1b-4e46-a303-be0f227d5908&ref_=pd_hp_d_btf_LPDEALS&th=1",
  flipkart:
    "https://www.flipkart.com/campus-hurricane-running-shoes-men/p/itme55da032c2427?pid=SHOG6BNZCWQZ5YZZ&lid=LSTSHOG6BNZCWQZ5YZZX5SIOI&marketplace=FLIPKART&store=osp%2Fcil%2F1cu&srno=b_1_1&otracker=browse&fm=organic&iid=d8df3425-556e-4a4c-9e96-9d14d9126b6c.SHOG6BNZCWQZ5YZZ.SEARCH&ppt=browse&ppn=browse&ssid=tzc7tbwfeo0000001777792497223&ov_redirect=true",
  meesho:
    "https://www.meesho.com/ftx-pack-of-4-mens-solid-regular-round-multicolor-tshirts/p/1bc9wl",
};

async function main(): Promise<void> {
  const platform = process.argv[2]?.toLowerCase();
  const url = platform && URLS[platform];
  if (!url) {
    console.error("Usage: node dist/scripts/test-one.js [amazon|flipkart|meesho]");
    process.exit(1);
  }

  console.log(`\n=== Testing ${platform} ===`);
  console.log(`URL: ${url.slice(0, 100)}…`);
  cacheDelete(url);

  const t0 = Date.now();
  try {
    const result = await scrapeProduct(url);
    const ms = Date.now() - t0;
    const d = result.data;
    console.log(`\nOK (${result.source}) in ${ms}ms`);
    console.log(`  title:          ${d.title ?? "(empty)"}`);
    console.log(`  price:          ${d.price ?? "(empty)"}`);
    console.log(`  original_price: ${d.original_price ?? "(empty)"}`);
    console.log(`  discount:       ${d.discount ?? "(empty)"}`);
    console.log(`  rating:         ${d.rating ?? "(empty)"}`);
    console.log(`  reviews_count:  ${d.reviews_count ?? "(empty)"}`);
    console.log(`  availability:   ${d.availability ?? "(empty)"}`);
    console.log(`  seller:         ${d.seller ?? "(empty)"}`);
    console.log(`  images:         ${d.images.length}`);
    console.log(`  highlights:     ${d.highlights.length}`);
    console.log(`  offers:         ${d.offers.length}`);
    console.log(`  specs keys:     ${Object.keys(d.specifications).length}`);
    if (d.offers.length) {
      console.log("\n  Offers:");
      d.offers.slice(0, 5).forEach((o) => console.log(`    [${o.type}] ${o.text.slice(0, 80)}`));
    }
    if (d.highlights.length) {
      console.log("\n  Highlights:");
      d.highlights.slice(0, 4).forEach((h) => console.log(`    • ${h.slice(0, 80)}`));
    }
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`\nFAIL (${ms}ms): ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

void main();
