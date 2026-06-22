// Cloudflare Pages Function — GET /api/feargreed
const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=600",
};
const UA = "Mozilla/5.0 (compatible; JKQuant/1.0)";

export async function onRequestGet() {
  try {
    const r = await fetch(
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
      { headers: { "User-Agent": UA, "Accept": "application/json" }, cf: { cacheTtl: 600 } }
    );
    if (!r.ok) throw new Error("cnn http " + r.status);
    const j = await r.json();
    const fg = j && j.fear_and_greed;
    if (!fg) throw new Error("cnn empty");
    return new Response(
      JSON.stringify({ score: Math.round(fg.score), rating: fg.rating || null, ts: fg.timestamp || null }),
      { headers: JH }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: JH });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type",
  }});
}
