// GET /api/game?id=<ESPN event id>
// Live team stats + win probability for one FBS/FCS game.

const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary";

const WANTED = [
  ["totalYards", "Total yards"],
  ["netPassingYards", "Passing"],
  ["rushingYards", "Rushing"],
  ["firstDowns", "First downs"],
  ["thirdDownEff", "3rd down"],
  ["turnovers", "Turnovers"],
  ["totalPenaltiesYards", "Penalties"],
  ["possessionTime", "Possession"],
];

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^\d{1,12}$/.test(id)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }

  let data;
  try {
    const res = await fetch(`${SUMMARY}?event=${id}`, {
      headers: { "User-Agent": "gameday-board/1.0 (personal project)" },
    });
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch (e) {
    return Response.json({ error: "upstream failed" }, { status: 502 });
  }

  const competitors = data.header?.competitions?.[0]?.competitors ?? [];
  const awayId = String(competitors.find((c) => c.homeAway === "away")?.id ?? "");
  const homeId = String(competitors.find((c) => c.homeAway === "home")?.id ?? "");
  const teams = data.boxscore?.teams ?? [];
  const forSide = (tid) => teams.find((t) => String(t.team?.id) === tid)?.statistics ?? [];
  const away = forSide(awayId);
  const home = forSide(homeId);

  const pick = (list, name) => list.find((s) => s.name === name)?.displayValue ?? null;
  const rows = WANTED.map(([name, label]) => ({
    label,
    away: pick(away, name),
    home: pick(home, name),
  })).filter((r) => r.away != null || r.home != null);

  // ESPN reports home win %, so flip it to the away side to match the UI
  const wpList = data.winprobability ?? [];
  const lastWp = wpList.length ? wpList[wpList.length - 1].homeWinPercentage : null;
  const wp = lastWp == null ? null : Math.round((1 - lastWp) * 100);

  // Most recent play, if the feed has one
  let last = null;
  const cur = data.drives?.current?.plays;
  if (cur?.length) last = cur[cur.length - 1].text ?? null;
  else {
    const prev = data.drives?.previous;
    const plays = prev?.length ? prev[prev.length - 1].plays : null;
    if (plays?.length) last = plays[plays.length - 1].text ?? null;
  }

  return Response.json(
    { rows, wp, last },
    {
      headers: {
        "Cache-Control": "public, max-age=0",
        "Netlify-CDN-Cache-Control": "public, s-maxage=8, stale-while-revalidate=15",
      },
    }
  );
};

export const config = { path: "/api/game" };
