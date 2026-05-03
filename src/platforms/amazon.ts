import type { Page } from "playwright";
import type { ProductPayload } from "../types";
import { emptyProduct } from "../types";
import { classifyOfferText, dedupeOffers, textOrNull } from "../utils/parser";

async function grabOfferTexts(page: Page): Promise<string[]> {
  const modalSelectors = [
    ".a-popover-inner",
    "#a-popover-offer-list",
    '[data-action="a-popover"]',
    "#offer-list",
    ".offers-items",
  ];
  const texts: string[] = [];
  for (const sel of modalSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      const t = await loc.innerText().catch(() => "");
      t.split("\n").forEach((line) => {
        const s = line.trim();
        if (s.length > 3) texts.push(s);
      });
    }
  }
  return texts;
}

export async function scrapeAmazon(page: Page): Promise<ProductPayload> {
  const p = emptyProduct("amazon");

  const title = await page
    .locator("#productTitle, h1#title, #title_feature_div h1")
    .first()
    .innerText()
    .catch(() => "");
  p.title = textOrNull(title);

  const priceWhole = await page.locator(".a-price .a-offscreen").first().innerText().catch(() => "");
  const priceAlt = await page
    .locator(".a-price-whole, #priceblock_dealprice, #corePrice_feature_div .a-price")
    .first()
    .innerText()
    .catch(() => "");
  p.price = textOrNull(priceWhole || priceAlt);

  const orig = await page
    .locator(".basisPrice .a-offscreen, .a-text-price .a-offscreen")
    .first()
    .innerText()
    .catch(() => "");
  p.original_price = textOrNull(orig);

  const disc = await page
    .locator(".savingsPercentage, #discountPercentage_feature_div")
    .first()
    .innerText()
    .catch(() => "");
  p.discount = textOrNull(disc);

  const imgs = await page.evaluate(() => {
    const out: string[] = [];
    const push = (u: string | null) => {
      if (u && u.startsWith("http")) out.push(u.split(" ")[0]);
    };
    document.querySelectorAll("#landingImage, #imgTagWrapperId img, li.item img").forEach((el) => {
      push((el as HTMLImageElement).src);
    });
    document.querySelectorAll("#altImages img").forEach((el) => {
      push((el as HTMLImageElement).src);
    });
    return [...new Set(out)];
  });
  p.images = imgs;

  const rating = await page.locator("#acrPopover .a-size-base").first().innerText().catch(() => "");
  p.rating = textOrNull(rating);

  const reviews = await page.locator("#acrCustomerReviewText, #acrCustomerReviewLink").first().innerText().catch(() => "");
  p.reviews_count = textOrNull(reviews?.replace(/ratings?/i, "").trim());

  const avail = await page
    .locator("#availability span, #deliveryBlockMessage, #mir-layout-DELIVERY_BLOCK")
    .first()
    .innerText()
    .catch(() => "");
  p.availability = textOrNull(avail);

  const seller = await page.locator("#sellerProfileTriggerId, #merchant-info").first().innerText().catch(() => "");
  p.seller = textOrNull(seller);

  const offerSnippets = await page.evaluate(() => {
    const blocks = Array.from(
      document.querySelectorAll(
        "#coupons-at-glance, #promoPriceBlockMessage, .offers-items, [data-csa-c-content-id*='offer']"
      )
    );
    return blocks.map((b) => (b.textContent || "").trim()).filter(Boolean);
  });
  const modalOffers = await grabOfferTexts(page);
  const allOfferStrings = [...offerSnippets, ...modalOffers];
  p.offers = dedupeOffers(allOfferStrings.map((t) => classifyOfferText(t)));

  const bullets = await page
    .locator("#feature-bullets ul li span.a-list-item")
    .allInnerTexts()
    .catch(() => [] as string[]);
  p.highlights = bullets.map((x) => x.trim()).filter((x) => x.length > 0);

  const specRows = await page.evaluate(() => {
    const obj: Record<string, string> = {};
    document.querySelectorAll("#productDetails_detailBullets_sections1 tr, #prodDetails tr").forEach((tr) => {
      const cells = tr.querySelectorAll("th, td");
      if (cells.length >= 2) {
        const k = (cells[0].textContent || "").replace(/\s+/g, " ").trim();
        const v = (cells[1].textContent || "").replace(/\s+/g, " ").trim();
        if (k && v) obj[k] = v;
      }
    });
    return obj;
  });
  p.specifications = specRows;

  const tech = await page.locator("#productDescription_feature_div, #aplus").first().innerText().catch(() => "");
  if (tech) p.additional_details["description"] = tech.slice(0, 8000);

  return p;
}
