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

  const competitors = data.header?.competitions?.[0]?.
