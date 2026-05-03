import express from "express";
import path from "path";
import { detectPlatform, scrapeProduct } from "./scraper";
import { InvalidProductUrlError } from "./utils/productUrl";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "512kb" }));
app.use(express.static(path.join(__dirname, "../public")));

app.post("/scrape", async (req, res) => {
  try {
    const rawUrl = req.body?.url as string | undefined;
    const screenshot = Boolean(req.body?.screenshot);
    const headed =
      typeof req.body?.headed === "boolean"
        ? req.body.headed
        : req.body?.headed === "true" || req.body?.headed === "1";

    if (!rawUrl || typeof rawUrl !== "string") {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid 'url' in JSON body",
      });
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      return res.status(400).json({ success: false, error: "Invalid URL format" });
    }

    if (!/^https?:$/i.test(parsed.protocol)) {
      return res.status(400).json({ success: false, error: "Only http(s) URLs are allowed" });
    }

    const platform = detectPlatform(parsed.href);
    if (!platform) {
      return res.status(400).json({
        success: false,
        error: "Unsupported domain. Supported: Amazon, Flipkart, Meesho product pages",
      });
    }

    const result = await scrapeProduct(parsed.href, { screenshot, headed });

    return res.json({
      success: true,
      source: result.source,
      screenshot_path: result.screenshot_path ?? null,
      ...result.data,
    });
  } catch (e) {
    if (e instanceof InvalidProductUrlError) {
      return res.status(400).json({ success: false, error: e.message });
    }
    const message = e instanceof Error ? e.message : "Unknown server error";
    return res.status(502).json({ success: false, error: message });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Product scraper API listening on http://localhost:${PORT}`);
});
