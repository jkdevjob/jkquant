// 주가 일간 시세 수집 — Yahoo Finance chart API 직접 호출.
// 저장소의 functions/api/quote.js 와 동일한 소스(Yahoo)를 Node에서 직접 사용한다.
// 미국 종목: 티커 그대로(TQQQ, AAPL). 한국 종목: 6자리코드 → .KS(코스피)/.KQ(코스닥) 자동 시도.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// 한국 6자리 코드면 야후용 심볼 후보를 만든다(.KS 우선, 실패 시 .KQ).
function yahooSymbolCandidates(symbol) {
  const s = symbol.trim().toUpperCase();
  if (/^\d{6}$/.test(s)) return [`${s}.KS`, `${s}.KQ`];
  return [s];
}

async function fetchChart(ySymbol, { range = "5y", period1, period2 } = {}) {
  const rangeParam =
    period1 != null && period2 != null
      ? `period1=${period1}&period2=${period2}`
      : `range=${encodeURIComponent(range)}`;
  const hosts = ["query1", "query2"];
  let lastErr;
  for (const host of hosts) {
    const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      ySymbol
    )}?interval=1d&${rangeParam}&includePrePost=false&events=div%2Csplit`;
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          Referer: "https://finance.yahoo.com/",
          Origin: "https://finance.yahoo.com",
        },
      });
      if (!r.ok) {
        lastErr = new Error(`HTTP ${r.status}`);
        continue;
      }
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      if (!res) {
        lastErr = new Error("empty result");
        continue;
      }
      const ts = res.timestamp || [];
      const q = res.indicators?.quote?.[0] || {};
      const adj = res.indicators?.adjclose?.[0]?.adjclose || [];
      const rawClose = q.close || [];
      const closeArr = adj.length ? adj : rawClose; // 배당·분할 반영 조정종가 우선
      const series = [];
      for (let i = 0; i < ts.length; i++) {
        const c = closeArr[i];
        if (c == null) continue;
        series.push({
          date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
          close: +(+c).toFixed(6),
        });
      }
      if (!series.length) {
        lastErr = new Error("no close points");
        continue;
      }
      const meta = res.meta || {};
      return {
        symbol: ySymbol,
        currency: meta.currency || (/(\.KS|\.KQ)$/.test(ySymbol) ? "KRW" : "USD"),
        longName: meta.longName || meta.shortName || null,
        series,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("fetch failed");
}

// 공개 API: 종목의 일간 조정종가 시리즈를 반환.
export async function fetchSeries(symbol, opts = {}) {
  const candidates = yahooSymbolCandidates(symbol);
  let lastErr;
  for (const cand of candidates) {
    try {
      const data = await fetchChart(cand, opts);
      // 코스피/코스닥 판별: 데이터가 충분하면 채택
      if (data.series.length >= 10) return data;
      lastErr = new Error(`too few points for ${cand}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`시세 수집 실패(${symbol}): ${lastErr?.message || "unknown"}`);
}

// 시리즈를 [startDate, endDate] 로 자른다(문자열 YYYY-MM-DD, 경계 포함).
export function sliceByDate(series, startDate, endDate) {
  return series.filter(
    (p) => (!startDate || p.date >= startDate) && (!endDate || p.date <= endDate)
  );
}
