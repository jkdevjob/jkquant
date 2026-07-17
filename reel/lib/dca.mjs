// 적립식(DCA, 정액분할매수) 백테스트.
// 규칙: interval 간격마다 amount 만큼 종가로 매수(소수점 주식 허용).
// 반환: 원금/평가액/수익/수익률 + 자산곡선(에쿼티 커브) + 가격곡선.

// interval: "daily" | "weekly" | "monthly"
function isBuyDay(prevDate, curDate, interval) {
  if (interval === "daily") return true;
  const d = new Date(curDate + "T00:00:00Z");
  if (interval === "weekly") {
    if (!prevDate) return true;
    const p = new Date(prevDate + "T00:00:00Z");
    // ISO 주가 바뀌면 매수(주 1회)
    const isoWeek = (x) => {
      const t = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
      const day = (t.getUTCDay() + 6) % 7;
      t.setUTCDate(t.getUTCDate() - day + 3);
      const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
      const fday = (firstThu.getUTCDay() + 6) % 7;
      firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
      return `${t.getUTCFullYear()}-${Math.round((t - firstThu) / 6048e5)}`;
    };
    return isoWeek(p) !== isoWeek(d);
  }
  if (interval === "monthly") {
    if (!prevDate) return true;
    return prevDate.slice(0, 7) !== curDate.slice(0, 7); // 월이 바뀌면 매수
  }
  return true;
}

export function runDCA(series, { amount = 10000, interval = "daily" } = {}) {
  if (!series.length) throw new Error("빈 시세");
  let shares = 0;
  let invested = 0;
  let buys = 0;
  let prevDate = null;
  const equity = []; // { date, invested, value }
  for (const p of series) {
    if (isBuyDay(prevDate, p.date, interval)) {
      shares += amount / p.close;
      invested += amount;
      buys++;
    }
    prevDate = p.date;
    equity.push({ date: p.date, invested, value: shares * p.close });
  }
  const last = series[series.length - 1];
  const finalValue = shares * last.close;
  const profit = finalValue - invested;
  const returnPct = invested > 0 ? (profit / invested) * 100 : 0;

  // 단순 매수후보유(lump sum) 비교치: 첫날 전액 투입 시
  const first = series[0];
  const lumpValue = (invested / first.close) * last.close;

  return {
    startDate: first.date,
    endDate: last.date,
    firstClose: first.close,
    lastClose: last.close,
    amount,
    interval,
    buys,
    shares,
    invested,
    finalValue,
    profit,
    returnPct,
    lumpValue,
    lumpProfit: lumpValue - invested,
    equity,
    prices: series.map((p) => ({ date: p.date, close: p.close })),
  };
}
