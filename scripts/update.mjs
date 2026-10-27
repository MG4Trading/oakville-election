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
const STRICT = /(elect|vote|voting|voter|ballot|candidate|trustee|acclaim|recount|turnout|\bpolls?\b|debate|councillor|mayoral|ward\s*\d)/i;
const OAKVILLE = /(oakville|halton)/i;
const LOCAL_SOURCES = /^(Oakville News|Town of Oakville|Reddit r\/oakville|Team)$/i;
let CANDIDATE_RE = null; // built from data/races.json

// Final relevance test applied to every item, old and new
export function relevant(i) {
  const t = i.title || "";
  if (CANDIDATE_RE && CANDIDATE_RE.test(t)) return true;
  if (/reddit\.com\/r\/oakville/i.test(i.url)) i.source = "Reddit r/oakville";
  const core = /(elect|vote|voting|voter|ballot|candidate|trustee|acclaim|recount|turnout|\bpolls?\b|debate)/i;
  if (/^(Town of Oakville|Reddit r\/oakville|Team)$/i.test(i.source || "")) return core.test(t);
  if (/oakville/i.test(t)) return STRICT.test(t);
  // Oakville News also carries national wire stories; keep only local race items
  if (/^Oakville News$/i.test(i.source || "")) return /ward\s*\d|mayoral candidate/i.test(t) && core.test(t);
  return false;
}

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
  const cfg = await readJson("data/races.json", { races: [], acclaimed: [] });
  const names = [...cfg.races.flatMap(r => r.c.map(n => n.replace(/\s*\(.*?\)\s*/g, " ").trim())), ...(cfg.acclaimed || []).map(a => a.split(": ").pop())];
  CANDIDATE_RE = new RegExp("\\b(" + names.map(n => n.replace(/[.*+?^${}()|[\]\\']/g, "\\$&").replace(/\s+/g, "\\s+")).join("|") + ")\\b", "i");
  const found = [];
  const tasks = FEEDS.map(async f => {
    try {
      const items = parseFeed(await get(f.url)).filter(i => keep(i, f.filter));
      for (const i of items) found.push({ title: cleanTitle(i.title, i.source), url: i.url, type: typeFor(i, f.type), source: f.src || i.source || "", at: toIso(i.at) });
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
        if (title.length < 20 || !STRICT.test(title)) continue;
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
    if (!t || seenU.has(i.url) || seenT.has(t) || !relevant(i)) continue;
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
        // skip numbers that are labels (Ward 7, Poll 704, 2026), not vote counts
        const re = new RegExp(NUM.source, "g"); let m;
        while ((m = re.exec(after))) {
          const before = after.slice(Math.max(0, m.index - 12), m.index);
          if (/(ward|wards|poll|polls|district|area|seat|no\.|#|&)\s*$/i.test(before)) continue;
          if (/^20\d\d$/.test(m[1])) continue;
          val = parseInt(m[1].replace(/,/g, ""), 10); break;
        }
        idx = lower.indexOf(v.toLowerCase(), idx + 1);
      }
      if (val !== null) break;
    }
    totals[c] = val ?? 0;
    if (val !== null) hits++;
  }
  const vals = Object.values(totals), sum = vals.reduce((a, b) => a + b, 0);
  // identical numbers for every candidate means we read a label, not votes
  if (new Set(vals).size === 1 && race.c.length > 1) return null;
  return hits >= Math.ceil(race.c.length / 2) && sum >= 10 ? totals : null;
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

/* ---------- official Town data file ---------- */
const TOWN_JSON = "https://www.oakville.ca/2026results/data/arearesults.json";
const clean = s => decode(String(s || "")).replace(/\s+/g, " ").trim();
export function fromTown(d, cfg) {
  const st = d.statistics || {};
  const out = { stats: { electors: st.eligibleVoters, ballots: st.globBallotCast, turnout: parseFloat(st.globTurnout), tabulators: st.globTabulators, closedTabulators: st.globClosedTabulators, wards: {} }, races: {} };
  const byNames = cfg.races.map(r => ({ r, set: new Set(r.c.map(n => n.toLowerCase())) }));
  for (const blk of d.areaResults || []) for (const a of Object.values(blk)) {
    for (const c of a.contestResults || []) {
      const ch = c.choiceResults || [];
      if (c.isAcclaimed || !ch.length) continue;
      const names = ch.map(x => clean(x.choiceName).toLowerCase());
      const hit = byNames.find(b => names.length === b.set.size && names.every(n => b.set.has(n)));
      if (!hit) continue;
      const totals = {}; for (const x of ch) totals[hit.r.c.find(n => n.toLowerCase() === clean(x.choiceName).toLowerCase())] = x.votes;
      const winner = ch.find(x => x.isWinner); const s = a.statistics || {};
      out.races[hit.r.id] = { totals, ballots: c.ballotCast || s.ballotCast, wardBallots: s.ballotCast, winner: winner ? clean(winner.choiceName) : null,
        pollsReporting: s.closedTabulators, pollsTotal: s.tabulators, final: s.tabulators > 0 && s.closedTabulators === s.tabulators,
        source: "Town of Oakville", url: "https://www.oakville.ca/2026results/", updatedAt: NOW };
      const w = String(c.contestName).match(/^TOWN COUNCILLOR - WARD (\d)/i);
      if (w) out.stats.wards["Ward " + w[1]] = s.ballotCast;
    }
  }
  return out;
}

async function collectResults() {
  const cfgTown = await readJson("data/races.json", { races: [] });
  try {
    const town = fromTown(JSON.parse(await get(TOWN_JSON + "?t=" + Date.now())), cfgTown);
    if (Object.keys(town.races).length) {
      const manual = await readJson("data/manual.json", {});
      for (const [id, r] of Object.entries(manual)) if (!id.startsWith("_") && r?.totals) town.races[id] = { ...r, source: "Team entry", updatedAt: r.updatedAt || NOW };
      const tb = town.stats;
      await writeJson("data/results.json", { generatedAt: NOW, pollsText: `${tb.closedTabulators} of ${tb.tabulators} tabulators reporting`, sources: [TOWN_JSON], stats: tb, races: town.races });
      log("results from Town data file:", Object.keys(town.races).length, "races");
      return;
    }
  } catch (e) { log("town json skip", e.message.slice(0, 100)); }
  await collectResultsFromPages();
}

async function collectResultsFromPages() {
  const cfg = await readJson("data/races.json", { races: [] });
  const prev = await readJson("data/results.json", { races: {} });
  const manual = await readJson("data/manual.json", {});
  const out = { generatedAt: NOW, pollsText: "", sources: [], races: {} };
  // no counts exist before polls close (8 p.m. Toronto); skip reading pages until then
  const pollsClosed = Date.now() >= Date.parse("2026-10-26T20:00:00-04:00") || process.env.FORCE_RESULTS === "1";
  const pages = pollsClosed ? await resultPages() : [];
  if (!pollsClosed) log("results: polls still open, skipping");
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
  if (pollsClosed) for (const [id, r] of Object.entries(prev.races || {})) if (!out.races[id] && r.source !== "Team entry") out.races[id] = { ...r, stale: true };
  // manual overrides win
  for (const [id, r] of Object.entries(manual)) {
    if (id.startsWith("_") || !r?.totals) continue;
    out.races[id] = { ...r, source: "Team entry", updatedAt: r.updatedAt || NOW };
  }
  await writeJson("data/results.json", out);
  log("results races", Object.keys(out.races).length, "from", out.sources.length, "pages");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // News collection retired after election night; results only.
  if (process.argv[2] === "news") await collectNews();
  else await collectResults();
}
