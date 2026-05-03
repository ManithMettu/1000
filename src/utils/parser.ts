import type { ClassifiedOffer, OfferType } from "../types";

const BANK_RE =
  /\b(icici|hdfc|sbi|axis|kotak|yes bank|rbl|indusind|bob|pnb|canara|idfc|au bank|federal|hsbc|standard chartered)\b/i;
const EMI_RE = /\b(no[\s-]?cost\s+emi|emi|equated monthly)\b/i;
const CASHBACK_RE = /\bcash\s*back\b|\bcashback\b/i;
const DISCOUNT_RE = /\b\d+\s*%?\s*off\b|\bdiscount\b|\brupees?\s*off\b/i;

export function classifyOfferText(text: string): ClassifiedOffer {
  const t = text.replace(/\s+/g, " ").trim();
  let type: OfferType = "other";
  if (BANK_RE.test(t) || /\bcard\b.*\boffer\b/i.test(t)) type = "bank_offer";
  else if (CASHBACK_RE.test(t)) type = "cashback";
  else if (EMI_RE.test(t)) type = "no_cost_emi";
  else if (DISCOUNT_RE.test(t)) type = "discount";
  return { type, text: t };
}

export function dedupeOffers(offers: ClassifiedOffer[]): ClassifiedOffer[] {
  const seen = new Set<string>();
  const out: ClassifiedOffer[] = [];
  for (const o of offers) {
    const k = o.text.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(o);
  }
  return out;
}

export function textOrNull(s: string | null | undefined): string | null {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length ? t : null;
}
