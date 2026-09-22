// Cloudflare Pages Function — /api/opening-monitor
// 브라우저 없이 시초가 눌림→재돌파 전략을 서버에서 감시한다.
// GitHub Actions가 장중 매분 5개 shard를 호출하고, 실제 계산/Telegram 전송은 Cloudflare에서 한다.
// 인증키는 OPENING_MONITOR_KEY 또는 기존 AUTOTRADE_KEY 를 사용한다.

const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function kstNow() {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = t => p.find(x => x.type === t)?.value || "";
  const hh = +g("hour"), mm = +g("minute");
  return {
    date: g("year") + "-" + g("month") + "-" + g("day"),
    hm: hh * 100 + mm,
    hh, mm,
    targetHm: mm > 0 ? hh * 100 + (mm - 1) : (hh - 1) * 100 + 59,
  };
}

function authorized(request, env) {
  const got = request.headers.get("x-monitor-key") || "";
  const want = String(env.OPENING_MONITOR_KEY || env.AUTOTRADE_KEY || "").trim();
  return !!want && got === want;
}

function minuteVolume(rows) {
  const a = (rows || []).map(x => ({ ...x })).sort((x, y) => String(x.t || "").localeCompare(String(y.t || "")));
  let prevDay = "", prevCum = 0;
  for (const x of a) {
    const d = String(x.t || "").slice(0, 10);
    const cum = Math.max(0, +x.vol || 0);
    x.vol = d === prevDay ? Math.max(0, cum - prevCum) : cum;
    prevDay = d; prevCum = cum;
  }
  return a;
}

function dailyMeta(daily, date) {
  const a = (daily && daily.ohlc) || [];
  const i = a.findIndex(x => x.date === date);
  if (i < 0) return null;
  const cur = a[i], prev = i > 0 ? a[i - 1] : null;
  if (!cur || !prev || !(+cur.open > 0) || !(+prev.close > 0)) return null;
  return { open: +cur.open, prevClose: +prev.close };
}

function liveRebreakFeature(rows, meta, targetHm) {
  const obs = 3, gmin = 2, gmax = 7;
  if (!Array.isArray(rows) || rows.length < obs + 3 || !meta) return null;
  const gap = (meta.open / meta.prevClose - 1) * 100;
  if (gap < gmin || gap > gmax) return null;

  const a = rows
    .filter(x => {
      const t = String(x.t || "");
      const h = +t.slice(11, 13), m = +t.slice(14, 16);
      return h === 9 && h * 100 + m <= targetHm;
    })
    .sort((x, y) => String(x.t || "").localeCompare(String(y.t || "")))
    .map(x => ({
      date: x.t,
      close: +x.close || 0,
      high: +(x.high ?? x.close) || 0,
      vol: +x.vol || 0,
    }));

  if (a.length < obs + 3) return null;
  const hi = x => x.high > 0 ? x.high : x.close;
  const px = x => x.close;
  const vol = x => x.vol;
  const firstHigh = Math.max(...a.slice(0, obs).map(hi));
  const sessionOpen = +meta.open;

  let bi = -1;
  for (let i = obs; i < a.length - 2; i++) {
    const p = px(a[i]);
    if (hi(a[i]) > firstHigh && p >= sessionOpen && (p / sessionOpen - 1) * 100 >= 0.5) {
      bi = i; break;
    }
  }
  if (bi < 0) return null;

  let peak = hi(a[bi]), peakI = bi;
  for (let i = bi + 1; i < a.length - 1; i++) {
    if (hi(a[i]) > peak) { peak = hi(a[i]); peakI = i; continue; }
    const p = px(a[i]), dd = (peak - p) / peak * 100;
    if (dd < 0.3 || dd > 1.0 || p < sessionOpen) continue;

    const pull = a.slice(peakI + 1, i + 1);
    if (!pull.length) continue;
    const baseVol = pull.reduce((s, x) => s + vol(x), 0) / pull.length;
    const baseAmt = pull.reduce((s, x) => s + px(x) * vol(x), 0) / pull.length;

    for (let j = i + 1; j < a.length; j++) {
      const jp = px(a[j]), jv = vol(a[j]), ja = jp * jv;
      const vr = jv / Math.max(1, baseVol);
      const ar = ja / Math.max(1, baseAmt);
      const t = String(a[j].date || "");
      const hm = +t.slice(11, 13) * 100 + +t.slice(14, 16);
      if (jp > peak && vr >= 1.0 && ar >= 1.2) {
        return { gap, firstHigh, peak, pullbackPct: dd, rebreakPrice: jp, volRatio: vr, amountRatio: ar, estAmount: ja, time: hm };
      }
    }
    break;
  }
  return null;
}

async function sendTelegram(env, title, lines) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) throw new Error("Telegram 환경변수 없음");
  const r = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "🔥 " + title + "\n\n" + lines.join("\n"),
      disable_web_page_preview: true,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error("Telegram 전송 실패");
}

export async function onRequestGet({ request, env }) {
  if (!authorized(request, env)) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: JH });
  }

  const now = kstNow();
  // 09:05~09:31 호출만 실제 스캔. 09:31 호출은 09:30 완료봉까지 본다.
  if (now.hm < 905 || now.hm > 931) {
    return new Response(JSON.stringify({ ok: true, skipped: "outside_market_window", now }), { headers: JH });
  }

  const url = new URL(request.url);
  const shard = Math.max(0, parseInt(url.searchParams.get("shard") || "0", 10) || 0);
  const shards = Math.max(1, Math.min(10, parseInt(url.searchParams.get("shards") || "5", 10) || 5));
  const limit = Math.max(10, Math.min(100, parseInt(url.searchParams.get("limit") || "100", 10) || 100));
  const origin = url.origin;

  try {
    const uj = await (await fetch(origin + "/api/universe?limit=" + limit)).json();
    const universe = (uj.universe || []).filter((_, i) => i % shards === shard);
    const found = [];
    const errors = [];
    let idx = 0;

    async function worker() {
      while (idx < universe.length) {
        const u = universe[idx++];
        try {
          const [mj, dj] = await Promise.all([
            fetch(origin + "/api/quote?symbol=" + encodeURIComponent(u.code) + "&minute=1").then(r => r.json()),
            fetch(origin + "/api/quote?symbol=" + encodeURIComponent(u.code) + "&range=5d&intraday=0&div=0").then(r => r.json()),
          ]);
          if (!mj.minutes || !mj.minutes.length || !dj.ohlc || !dj.ohlc.length) continue;
          const rows = minuteVolume(mj.minutes).filter(x => String(x.t || "").slice(0, 10) === now.date);
          const meta = dailyMeta(dj, now.date);
          const f = liveRebreakFeature(rows, meta, now.targetHm);
          // '완료된 직전 1분봉'에서 새로 발생한 신호만 보낸다 → 분당 재호출해도 중복 방지.
          if (f && f.time === now.targetHm) found.push({ code: u.code, name: u.name || u.code, ...f });
        } catch (e) {
          errors.push({ code: u.code, error: String(e.message || e).slice(0, 120) });
        }
      }
    }

    // Cloudflare Free는 동시 외부 연결 6개 제한. worker 2개 × 종목당 2 fetch = 최대 4개.
    await Promise.all([worker(), worker()]);

    found.sort((a, b) => (b.amountRatio - a.amountRatio) || (b.volRatio - a.volRatio));
    if (found.length) {
      const lines = found.slice(0, 10).flatMap((x, i) => [
        (i + 1) + ". " + x.name + " (" + x.code + ")",
        "갭 " + (x.gap >= 0 ? "+" : "") + x.gap.toFixed(2) + "% · 눌림 -" + x.pullbackPct.toFixed(2) + "%",
        "재돌파 " + Math.round(x.rebreakPrice).toLocaleString("ko-KR") + "원 · 거래량 " + x.volRatio.toFixed(2) + "배 · 거래대금 " + x.amountRatio.toFixed(2) + "배",
      ]);
      await sendTelegram(env, "서버 시초가 후보 · " + String(now.targetHm).padStart(4, "0"), lines);
    }

    return new Response(JSON.stringify({
      ok: true, date: now.date, targetHm: now.targetHm, shard, shards,
      universe: universe.length, candidates: found, errors: errors.length,
    }), { headers: JH });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), { status: 500, headers: JH });
  }
}
