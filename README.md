# Product scraper microservice

TypeScript + Express API that uses **Playwright** (Chromium, headless) to scrape Amazon, Flipkart, and Meesho product pages with human-like scrolling, delays, and keyword-based expansion of offers and “see more” sections. If the browser path fails after retries, the service falls back to **axios + cheerio** for a best-effort static parse.

## Install and run

```bash
npm install
npx playwright install chromium
npm start
```

### Verify scraping against real PDPs

Runs Playwright against built-in sample URLs (Amazon, Flipkart, Meesho), prints timing/source and flags missing fields. **Needs network** and may fail if sites block your IP.

```bash
npm run test:sites
```

Custom URLs (space-separated):

```bash
npm run test:sites -- https://www.amazon.in/dp/XXXXXXXXXX https://www.flipkart.com/.../p/itm...
```

Optional flags before URLs: `--headed` (watch Chromium), `--screenshot` (save PNGs under `./screenshots`). Exit code **1** if any scrape throws.

- API: `http://localhost:3000` (set `PORT` to change)
- Simple UI: open the root URL in a browser
- Health: `GET /health`

## API

**`POST /scrape`**

Request body (JSON):

| Field         | Type    | Description                                      |
|--------------|---------|--------------------------------------------------|
| `url`        | string  | **Required.** Product page URL                    |
| `screenshot` | boolean | Optional. Save a PNG under `./screenshots/`     |
| `headed`     | boolean | Optional. Open a visible Chromium window so you can watch the scrape (see below). |

### Watching the browser live (headed mode)

By default scraping runs **headless** (no window). To **see** scrolling and clicks:

- **API:** send `"headed": true` in the JSON body, **or**
- **Environment:** `SCRAPE_HEADED=true` or `HEADLESS=false` before `npm start`

The Chromium window opens on **the same computer that runs the Node server** (where you ran `npm start`), not inside your normal browser tab. Optional: `SCRAPE_SLOW_MO_MS=50` adds a short pause between Playwright actions so steps are easier to follow.

When **headed** mode is on, the browser stays open for **`SCRAPE_HEADED_PAUSE_MS`** milliseconds (default **3000**) after scraping so you can see the page before Chromium closes. Set to `0` to close immediately.

On a headless Linux server with no display, headed mode will fail unless you use X11 forwarding or a virtual framebuffer.

Example:

```bash
curl -s -X POST http://localhost:3000/scrape \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.amazon.in/dp/B0EXAMPLE"}'
```

Success response includes:

- All normalized product fields (`title`, `price`, `original_price`, `discount`, `images`, `rating`, `reviews_count`, `availability`, `seller`, `offers`, `highlights`, `specifications`, `additional_details`, `platform`)
- `success`, `source` (`playwright` or `cheerio`), and optionally `screenshot_path`

`offers` entries look like: `{ "type": "bank_offer", "text": "..." }` with `type` one of `bank_offer`, `cashback`, `no_cost_emi`, `discount`, `other`.

Errors return JSON `{ "success": false, "error": "..." }` with HTTP 400 (validation) or 502 (scraping failure).

## Supported platforms

Platform is inferred from the hostname:

| Platform | Detection              |
|----------|-------------------------|
| Amazon   | `amazon.` in host       |
| Flipkart | `flipkart.com`          |
| Meesho   | `meesho.com`            |

## Architecture

```
src/
  server.ts          Express, POST /scrape, static public/
  scraper.ts         Cache, retries, UA rotation, Playwright flow, cheerio fallback
  types.ts           Shared product shape + emptyProduct()
  platforms/
    amazon.ts        Amazon-specific DOM extraction
    flipkart.ts      Flipkart (login popup dismiss, offers, specs)
    meesho.ts        Meesho tables and sections
  utils/
    cache.ts         In-memory TTL cache (5 minutes, keyed by URL)
    retry.ts         withRetry (3 attempts = up to 2 retries after the first)
    userAgent.ts     Rotating desktop user agents
    parser.ts        Offer classification helpers
public/
  index.html, app.js, styles.css   Minimal tester UI
```

Flow:

1. Check cache → return if fresh  
2. Launch Chromium with a **rotated user agent** per attempt  
3. Navigate, **scroll** to load lazy content, **click** elements whose text matches offer / “view all” / “see more” patterns  
4. Run the **platform scraper** to build a normalized payload  
5. On repeated failure (including “no title and no price”), **axios + cheerio** parses OG tags, visible prices, and coarse offer snippets  

## Limitations

- **Selectors change**: Retail sites redesign often; locators are intentionally broad but will still break or degrade over time.
- **Anti-bot**: Captchas, IP blocks, or aggressive bot detection are not solved here; success rates vary by IP and volume.
- **Meesho “Access denied”**: Often Akamai/WAF. This service uses mobile Chrome + stealth-style hints; persistent blocks usually need a **residential or mobile proxy**, or scraping only from allowed environments.
- **Response time**: Slowness was mainly from long scroll pauses, many “expand” clicks, random delays (often **30–90s** worst case). The flow is now tightened (faster scroll, fewer clicks, shorter waits). Retries only run after a **failure**, not on success.

- **Cheerio fallback** cannot run JavaScript; it only sees server-rendered HTML and is much weaker for modals and lazy sections.
- **Legal / ToS**: Scraping may violate site terms; use only where you have permission and comply with applicable law.

## Future improvements

- **Redis** (or Memcached) for distributed cache and TTL instead of in-process `Map`
- **Job queue** (BullMQ, RabbitMQ, SQS) for async scrape jobs, rate limits, and long timeouts
- **Residential / rotating proxies** and per-platform cookie jars to reduce blocks
- **Structured extraction rules** stored in DB and updated without redeploying code
- **Playwright stealth / fingerprint** tuning only where compliant with policy

## Scaling suggestions (operations)

1. **Redis**: Share scrape results and dedupe hot URLs across API replicas; use sliding TTL for flash sales.
2. **Queues**: Offload `POST /scrape` to workers; respond with `job_id` + webhook or polling for large catalogs.
3. **Proxies**: Route Playwright contexts through providers (Bright Data, Oxylabs, etc.) with geographic affinity to the marketplace.
4. **Rate limiting**: Per-IP and per-API-key limits at the gateway to protect workers and avoid abuse.
5. **Observability**: Log `source` (playwright vs cheerio), attempt count, and duration; alert on cheerio ratio spikes (signal of bot blocks or broken selectors).

---

MIT-style use: ensure compliance with each retailer’s terms and local regulations before production use.
