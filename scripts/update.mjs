// Collects Oakville election news and results, writes data/news.json and data/results.json.
// Runs in GitHub Actions on a timer. No external packages; Node 20+.
import fs from "node:fs/promises";

const UA = "Mozilla/5.0 (compatible; OakvilleElectionApp/1.0; +https://github.com/MG4Trading/oakville-election)";
const NOW = new Date().toISOString();
const log = (...a) => console.log("[update]", ...a);

async function get(url, ms = 20000) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
async function readJson(p, d) { try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return d; } }
async function writeJson(p, v) { await fs.writeFile(p, JSON.stringify(v, null, 1) + "\n"); }

/* ---------- text helpers ---------- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…" };
export function decode(s = "") {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .trim();
}
export function htmlToText(html) {
  return decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d|\/td|\/th)[^>]*>/gi, " \n ").replace(/<[^>]+>/g, " "))
    .replace(/[ \t\r\f\v]+/g, " ");
}
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i")); return m ? decode(m[1]) : ""; };

/* ---------- RSS / Atom ---------- */
export function parseFeed(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const b = m[0];
    out.push({ title: decode(tag(b, "title").replace(/<[^>]+>/g, "")), url: tag(b, "link") || (b.match(/<guid[^>]*>(https?:[^<]+)<\/guid>/i)?.[1] ?? ""), at: tag(b, "pubDate") || tag(b, "dc:date"), source: tag(b, "source") });
  }
  for (const m of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)) {
    const b = m[0];
    const link = b.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i)?.[1] || b.match(/<link[^>]*href="([^"]+)"/i)?.[1] || "";
    out.push({ title: tag(b, "title"), url: decode(link), at: tag(b, "published") || tag(b, "updated"), source: tag(b, "name") });
  }
  return out.filter(x => x.title && /^https?:/.test(x.url));
}

const ELECTION = /(elect|vote|voting|voter|ballot|poll|mayor|council|ward|candidate|trustee|acclaim|recount|turnout|campaign)/i;
const OAKVILLE = /(oakville|halton)/i;

const q = s => encodeURIComponent(s);
const gnews = (s, when = "2d") => `https://news.google.com/rss/search?q=${q(s + " when:" + when)}&hl=en-CA&gl=CA&ceid=CA:en`;
const FEEDS = [
  { url: gnews('Oakville election'), type: "Press", filter: "none" },
  { url: gnews('Oakville mayor'), type: "Press", filter: "election" },
  { url: gnews('"Bilal Kader" OR "Nav Nanda" OR "Ward 7" Oakville', "14d"), type: "Press", filter: "none" },
  { url: gnews('Halton municipal election results'), type: "Press", filter: "oakville" },
  { url: gnews('site:youtube.com Oakville election', "7d"), type: "YouTube", filter: "none" },
  { url: "https://www.oakvillenews.org/rss", type: "Press", src: "Oakville News", filter: "election" },
  { url: "https://www.chch.com/feed/", type: "TV", src: "CHCH News", filter: "both" },
  { url: "https://www.insidehalton.com/search/?f=rss&t=article&c=news/oakville*&l=50&s=start_time&sd=desc", type: "Press", src: "Inside Halton", filter: "election" },
  { url: "https://www.reddit.com/r/oakville/new/.rss", type: "Social", src: "Reddit r/oakville", filter: "election" },
];
const YT_CHANNELS = ["@CHCHNews11", "@CP24", "@CBCNews", "@YourTVCanada", "@OakvilleNews"];
const OFFICIAL_PAGES = ["https://www.oakville.ca/town-hall/news-notices/"];

function keep(item, filter) {
  const t = item.title;
  if (filter === "none") return true;
  if (filter === "election") return ELECTION.test(t);
  if (filter === "oakville") return OAKVILLE.test(t);
  return ELECTION.test(t) && OAKVILLE.test(t);
}
function cleanTitle(t, source) {
  // Google News appends " - Source" to titles
  if (source && t.endsWith(" - " + source)) return t.slice(0, -(source.length + 3));
  return t;
}
function typeFor(item, base) {
  const u = item.url + " " + (item.source || "");
  if (/youtube\.com|youtu\.be/i.test(u)) return "YouTube";
  if (/oakville\.ca|halton\.ca/i.test(u)) return "Official";
  if (/reddit|x\.com|twitter|instagram|facebook|tiktok/i.test(u)) return "Social";
  if (/chch|cp24|ctv|global|cbc|yourtv|citynews/i.test(u)) return base === "Press" ? "TV" : base;
  return base;
}

async function ytChannelFeed(handle) {
  const page = await get(`https://www.youtube.com/${handle}`);
  const id = page.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/)?.[1];
  if (!id) throw new Error("no channel id for " + handle);
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
}

async function collectNews() {
  const prev = await readJson("data/news.json", { items: [] });
  const found = [];
  const tasks = FEEDS.map(async f => {
    try {
      const items = parseFeed(await get(f.url)).filter(i => keep(i, f.filter));
      for (const i of items) found.push({ title: cleanTitle(i.title, i.source), url: i.url, type: typeFor(i, f.type), source: i.source || f.src || "", at: toIso(i.at) });
      log("feed ok", items.length, f.src || f.url.slice(0, 80));
    } catch (e) { log("feed skip", e.message.slice(0, 120)); }
  });
  tasks.push(...YT_CHANNELS.map(async h => {
    try {
      const items = parseFeed(await get(await ytChannelFeed(h))).filter(i => OAKVILLE.test(i.title));
      for (const i of items) found.push({ title: i.title, url: i.url, type: "YouTube", source: i.source || h, at: toIso(i.at) });
      log("youtube ok", items.length, h);
    } catch (e) { log("youtube skip", e.message.slice(0, 120)); }
  }));
  tasks.push(...OFFICIAL_PAGES.map(async u => {
    try {
      const html = await get(u);
      for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const title = htmlToText(m[2]).trim();
        if (title.length < 20 || !ELECTION.test(title)) continue;
        found.push({ title, url: new URL(decode(m[1]), u).href, type: "Official", source: "Town of Oakville", at: NOW });
      }
    } catch (e) { log("official skip", e.message.slice(0, 120)); }
  }));
  await Promise.all(tasks);

  const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const seenU = new Set(), seenT = new Set(), merged = [];
  // existing items first so their original timestamps are kept
  for (const i of [...(prev.items || []), ...found]) {
    const t = norm(i.title);
    if (!t || seenU.has(i.url) || seenT.has(t)) continue;
    seenU.add(i.url); seenT.add(t); merged.push(i);
  }
  const cutoff = Date.now() - 45 * 864e5;
  const items = merged.filter(i => new Date(i.at).getTime() > cutoff).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 200);
  await writeJson("data/news.json", { generatedAt: NOW, items });
  log("news total", items.length, "new this run", items.length - (prev.items || []).length);
}
function toIso(s) { const d = s ? new Date(s) : null; return d && !isNaN(d) ? d.toISOString() : NOW; }

/* ---------- results ---------- */
const NUM = /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?![\d,]*\.\d)(?![\d,.]*\s*%)/;
export function nameVariants(n) {
  const clean = n.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const parts = clean.split(" ");
  const last = parts.slice(-1)[0], first = parts.slice(0, -1).join(" ");
  const nick = n.match(/\((.*?)\)/)?.[1];
  const v = [n, clean, `${last}, ${first}`, `${last} ${first}`];
  if (nick) v.push(`${nick} ${last}`, `${last}, ${nick}`);
  return [...new Set(v)];
}
export function extractRace(text, race) {
  const lower = text.toLowerCase();
  const totals = {}; let hits = 0;
  for (const c of race.c) {
    let val = null;
    for (const v of nameVariants(c)) {
      let idx = lower.indexOf(v.toLowerCase());
      while (idx !== -1 && val === null) {
        const after = text.slice(idx + v.length, idx + v.length + 140);
        const m = after.match(NUM);
        if (m) val = parseInt(m[1].replace(/,/g, ""), 10);
        idx = lower.indexOf(v.toLowerCase(), idx + 1);
      }
      if (val !== null) break;
    }
    totals[c] = val ?? 0;
    if (val !== null) hits++;
  }
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  return hits >= Math.ceil(race.c.length / 2) && sum > 0 ? totals : null;
}

async function resultPages() {
  const pages = [];
  const seeds = [process.env.RESULTS_URL, "https://elections.oakville.ca/results", "https://elections.oakville.ca/", "https://www.oakville.ca/town-hall/elections/"].filter(Boolean);
  const visited = new Set();
  for (const s of seeds) {
    if (visited.has(s)) continue; visited.add(s);
    try {
      const html = await get(s);
      pages.push({ url: s, html, official: true });
      // follow up to 4 links that look like results pages
      const links = [...html.matchAll(/href="([^"]+)"/gi)].map(m => { try { return new URL(decode(m[1]), s).href; } catch { return null; } })
        .filter(u => u && /result/i.test(u) && !visited.has(u)).slice(0, 4);
      for (const l of links) { visited.add(l); try { pages.push({ url: l, html: await get(l), official: true }); } catch (e) { log("result link skip", e.message.slice(0, 100)); } }
    } catch (e) { log("results seed skip", e.message.slice(0, 100)); }
  }
  try { pages.push({ url: "https://www.poliwave.com/ca/on/live/municipal-2026/oakville", html: await get("https://www.poliwave.com/ca/on/live/municipal-2026/oakville"), official: false }); }
  catch (e) { log("poliwave skip", e.message.slice(0, 100)); }
  return pages;
}

async function collectResults() {
  const cfg = await readJson("data/races.json", { races: [] });
  const prev = await readJson("data/results.json", { races: {} });
  const manual = await readJson("data/manual.json", {});
  const out = { generatedAt: NOW, pollsText: "", sources: [], races: {} };
  const pages = await resultPages();
  for (const p of pages) {
    const text = htmlToText(p.html);
    const polls = text.match(/(\d+)\s*(?:of|\/)\s*(\d+)\s*(?:polls|voting locations|precincts)/i);
    if (polls && !out.pollsText) out.pollsText = `${polls[1]} of ${polls[2]} polls reporting`;
    let used = false;
    for (const r of cfg.races) {
      if (out.races[r.id]) continue;
      const totals = extractRace(text, r);
      if (totals) { out.races[r.id] = { totals, source: p.official ? "Town of Oakville" : "Poliwave", url: p.url, updatedAt: NOW, final: /final|official results/i.test(text) && p.official }; used = true; }
    }
    if (used) out.sources.push(p.url);
  }
  // keep last known numbers for races the pages did not return this run
  for (const [id, r] of Object.entries(prev.races || {})) if (!out.races[id] && r.source !== "Team entry") out.races[id] = { ...r, stale: true };
  // manual overrides win
  for (const [id, r] of Object.entries(manual)) {
    if (id.startsWith("_") || !r?.totals) continue;
    out.races[id] = { ...r, source: "Team entry", updatedAt: r.updatedAt || NOW };
  }
  await writeJson("data/results.json", out);
  log("results races", Object.keys(out.races).length, "from", out.sources.length, "pages");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv[2];
  if (!only || only === "news") await collectNews();
  if (!only || only === "results") await collectResults();
}
