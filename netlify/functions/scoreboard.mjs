// GET /api/scoreboard?date=YYYYMMDD
//
// FBS + FCS  -> ESPN's public scoreboard feed (includes odds when a book has posted a line)
// D2 + D3    -> NCAA.com data via the community-run ncaa-api.henrygd.me proxy
//
// Debug: /api/scoreboard?raw=fbs|fcs|d2|d3 returns the untouched upstream JSON,
// which makes field-mapping fixes quick if either feed changes shape.

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";
const NCAA = "https://ncaa-api.henrygd.me/scoreboard/football";
const HEADERS = { "User-Agent": "gameday-board/1.0 (personal project)" };

async function getJSON(url, ms = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctl.signal });
    if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const pad = (n) => String(n).padStart(2, "0");

// YYYYMMDD in Pacific time, so a late Saturday West Coast kickoff still counts as Saturday
function pacificDate(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms)).replaceAll("-", "");
}

/* ---------------- ESPN (FBS, FCS) ---------------- */

const moneyline = (v) =>
  v == null || v === "" ? null : typeof v === "number" ? (v > 0 ? `+${v}` : String(v)) : String(v);

function mapEspn(ev, div) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const competitors = comp.competitors ?? [];
  const away = competitors.find((c) => c.homeAway === "away");
  const home = competitors.find((c) => c.homeAway === "home");
  if (!away || !home) return null;

  const type = ev.status?.type ?? {};
  const state = type.state === "in" ? "live" : type.state === "post" ? "final" : "pre";

  let clock = "";
  if (state === "live") {
    if (type.name === "STATUS_HALFTIME") clock = "Halftime";
    else if (type.name === "STATUS_END_PERIOD") clock = type.shortDetail || "End of quarter";
    else {
      const p = ev.status?.period ?? 0;
      clock = `${p > 4 ? "OT" : "Q" + p} ${ev.status?.displayClock ?? ""}`.trim();
    }
  } else if (state === "final") {
    clock = type.shortDetail || "Final";
  } else if (["STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_DELAYED", "STATUS_SUSPENDED"].includes(type.name)) {
    clock = type.shortDetail || type.description || "";
  }

  const team = (c) => {
    const rank = c.curatedRank?.current;
    const rec = c.records?.find((r) => r.type === "total") ?? c.records?.[0];
    return {
      name: c.team?.location || c.team?.displayName || "TBD",
      abbr: c.team?.abbreviation || "",
      record: rec?.summary || "",
      rank: rank && rank <= 25 ? rank : null,
      score: state === "pre" ? null : Number(c.score ?? 0),
      logo: c.team?.logo || null,
    };
  };

  const o = comp.odds?.[0];
  const odds =
    o && (o.details || o.overUnder != null)
      ? {
          spread: o.details ?? null,
          total: o.overUnder ?? null,
          provider: o.provider?.name ?? null,
          ml: {
            away: moneyline(o.awayTeamOdds?.moneyLine ?? o.moneyline?.away?.close?.odds),
            home: moneyline(o.homeTeamOdds?.moneyLine ?? o.moneyline?.home?.close?.odds),
          },
        }
      : null;

  const s = comp.situation;
  const sit =
    state === "live" && s
      ? {
          down: s.shortDownDistanceText || s.downDistanceText || null,
          last: s.lastPlay?.text || null,
          poss: s.possession
            ? [away, home].find((c) => String(c.id) === String(s.possession))?.team?.abbreviation ?? null
            : null,
        }
      : null;

  return {
    id: String(ev.id), src: "espn", div, state, clock, start: ev.date || null,
    away: team(away), home: team(home), odds, sit, stats: true,
  };
}

/* ---------------- NCAA.com (D2, D3) ---------------- */

function ncaaClock(g) {
  const per = String(g.currentPeriod ?? "").toUpperCase();
  const clk = g.contestClock ?? "";
  if (per.includes("HALF")) return "Halftime";
  const q = per.match(/[1-4]/);
  if (q) return `Q${q[0]} ${clk}`.trim();
  if (per.includes("OT")) return `OT ${clk}`.trim();
  return `${g.currentPeriod ?? ""} ${clk}`.trim() || "Live";
}

function mapNcaa(item, div) {
  const g = item.game ?? item;
  if (!g?.home || !g?.away) return null;
  const gs = String(g.gameState ?? "").toLowerCase();
  const state = gs.includes("final") ? "final" : gs.includes("live") || gs === "in" ? "live" : "pre";

  const team = (t) => {
    const raw = t.score;
    const rec = String(t.description ?? "");
    return {
      name: t.names?.short || t.names?.full || "TBD",
      abbr: t.names?.char6 || "",
      record: /\d+-\d+/.test(rec) ? rec.replace(/[()]/g, "").trim() : "",
      rank: parseInt(t.rank, 10) || null,
      score: state === "pre" || raw === "" || raw == null ? null : Number(raw),
      logo: null,
    };
  };

  const epoch = Number(g.startTimeEpoch);
  return {
    id: `n-${g.gameID}`, src: "ncaa", div, state,
    clock: state === "live" ? ncaaClock(g) : state === "final" ? "Final" : "",
    start: epoch ? new Date(epoch * 1000).toISOString() : null,
    away: team(g.away), home: team(g.home), odds: null, sit: null, stats: false,
  };
}

/* ---------------- handler ---------------- */

export default async (req) => {
  const url = new URL(req.url);
  const raw = url.searchParams.get("raw");
  let date = url.searchParams.get("date");
  if (!/^\d{8}$/.test(date ?? "")) date = pacificDate(Date.now());

  const espnUrl = (group) => `${ESPN}?dates=${date}&groups=${group}&limit=300`;
  const sources = {
    fbs: () => getJSON(espnUrl(80)),
    fcs: () => getJSON(espnUrl(81)),
    d2: () => getJSON(`${NCAA}/d2`),
    d3: () => getJSON(`${NCAA}/d3`),
  };

  if (raw && sources[raw]) {
    try {
      return Response.json(await sources[raw](), { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 502 });
    }
  }

  const names = Object.keys(sources);
  const results = await Promise.allSettled(names.map((n) => sources[n]()));

  const games = [];
  const warnings = [];
  results.forEach((r, i) => {
    const div = names[i];
    const label = { fbs: "FBS", fcs: "FCS", d2: "D2", d3: "D3" }[div];
    if (r.status !== "fulfilled") {
      warnings.push(`${label} data didn't respond`);
      return;
    }
    if (div === "fbs" || div === "fcs") {
      for (const ev of r.value.events ?? []) {
        const g = mapEspn(ev, label);
        if (g) games.push(g);
      }
    
