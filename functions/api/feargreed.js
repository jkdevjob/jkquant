// Cloudflare Pages Function — GET /api/feargreed[?days=400]
// CNN Fear & Greed 지수를 엣지에서 수집 → 동일 출처로 반환 (CORS 없음).
// 응답: { score, rating, hist: [{t: ms, v: score}], src }
//
// 배포 위치: functions/api/feargreed.js
// CNN 원본: https://production.dataviz.cnn.io/index/fearandgreed/graphdata[/YYYY-MM-DD]
//   - fear_and_greed        : { score, rating, ... }        (현재값)
//   - fear_and_greed_historical.data : [{ x: ms, y: score }] (히스토리)

const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=900",   // 15분 캐시
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const BASE = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: JH });
}

async function fetchCNN(startDate) {
  const url = startDate ? `${BASE}/${startDate}` : BASE;
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://edition.cnn.com/",
      "Origin": "https://edition.cnn.com",
    },
    cf: { cacheTtl: 900, cacheEverything: true },
  });
  if (!r.ok) throw new Error(`CNN ${r.status}`);
  return await r.json();
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "400", 10) || 400, 30), 3650);
  const debug = url.searchParams.get("debug") === "1";

  // 시작일: days일 전 (CNN은 시작일을 붙이면 그 날짜부터 반환)
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

  const attempts = [];
  for (const sd of [start, null]) {          // 시작일 지정 → 실패 시 기본 URL
    try {
      const j = await fetchCNN(sd);
      const cur = j && j.fear_and_greed;
      if (!cur || typeof cur.score !== "number") {
        attempts.push({ sd, ok: false, why: "no fear_and_greed" });
        continue;
      }
      let hist = [];
      const h = j.fear_and_greed_historical && j.fear_and_greed_historical.data;
      if (Array.isArray(h)) {
        hist = h
          .map((p) => ({ t: p.x, v: Math.round(p.y) }))
          .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
          .sort((a, b) => a.t - b.t);
        // 중복 제거 (CNN이 마지막 행을 두 번 주는 경우가 있음)
        hist = hist.filter((p, i) => i === 0 || p.t !== hist[i - 1].t);
      }
      const out = {
        score: Math.round(cur.score),
        rating: cur.rating || "",
        hist,
        src: sd ? "cnn+start" : "cnn",
      };
      if (debug) out.debug = { requested: sd, histLen: hist.length, attempts };
      return json(out);
    } catch (e) {
      attempts.push({ sd, ok: false, why: String(e && e.message || e) });
    }
  }

  return json({ error: "fear&greed unavailable", attempts }, 502);
}
