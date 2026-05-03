const form = document.getElementById("form");
const urlInput = document.getElementById("url");
const shot = document.getElementById("shot");
const headed = document.getElementById("headed");
const statusEl = document.getElementById("status");
const out = document.getElementById("out");
const go = document.getElementById("go");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusEl.textContent = "Scraping… this may take up to a minute.";
  out.textContent = "";
  go.disabled = true;
  try {
    const res = await fetch("/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: urlInput.value.trim(),
        screenshot: shot.checked,
        headed: headed.checked,
      }),
    });
    const body = await res.json();
    if (!res.ok || body.success === false) {
      statusEl.textContent = "Error: " + (body.error || res.statusText);
      out.textContent = JSON.stringify(body, null, 2);
      return;
    }
    statusEl.textContent =
      "Done (" + (body.source === "cheerio" ? "static fallback" : "Playwright") + ").";
    const { success: _s, ...rest } = body;
    out.textContent = JSON.stringify(rest, null, 2);
  } catch (err) {
    statusEl.textContent = "Request failed: " + (err && err.message ? err.message : String(err));
  } finally {
    go.disabled = false;
  }
});
