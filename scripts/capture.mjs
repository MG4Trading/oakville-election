// One-off: open the Town of Oakville results app in a real browser and save
// every data response plus the rendered text of each contest page.
import { chromium } from "playwright";
import fs from "node:fs/promises";

const BASE = "https://www.oakville.ca/2026results/";
await fs.mkdir("capture/net", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 2000 } });
let n = 0; const index = [];
page.on("response", async r => {
  try {
    const ct = r.headers()["content-type"] || "";
    const u = r.url();
    if (!/json|xml|csv|text\/plain|javascript/i.test(ct) && !/\.(json|xml|csv|js)(\?|$)/i.test(u)) return;
    if (/google|gtag|analytics|facebook|hotjar|cdn\./i.test(u)) return;
    const body = await r.body();
    if (body.length > 3_000_000) return;
    const f = `capture/net/${String(++n).padStart(3, "0")}.${/json/.test(ct) ? "json" : /xml/.test(ct) ? "xml" : /javascript/.test(ct) ? "js" : "txt"}`;
    await fs.writeFile(f, body);
    index.push({ f, u, ct, size: body.length });
  } catch {}
});
async function grab(hash, name) {
  await page.goto(BASE + hash, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await fs.writeFile(`capture/${name}.txt`, await page.evaluate(() => document.body.innerText));
}
await grab("", "home");
await grab("#at/1/ar/16/ct/1016", "ct1016");
// collect every contest link the app exposes and visit those for Ward 7 and Mayor
const links = await page.evaluate(() => [...document.querySelectorAll("a[href*='#']")].map(a => ({ h: a.getAttribute("href"), t: a.innerText.trim() })));
await fs.writeFile("capture/links.json", JSON.stringify(links, null, 1));
const wanted = links.filter(l => /mayor|ward 7|ward7/i.test(l.t)).slice(0, 12);
let i = 0; for (const l of wanted) await grab(l.h.slice(l.h.indexOf("#")), "link" + (++i));
await fs.writeFile("capture/index.json", JSON.stringify({ index, wanted }, null, 1));
await browser.close();
console.log("captured", index.length, "responses,", wanted.length, "contest pages");
