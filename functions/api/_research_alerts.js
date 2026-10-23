// One presentation contract for Pages Telegram and Worker web push.
// Both closing strategies retain the existing closing30 subscription and receipts.
const trade = (label, topic, tab = topic) => Object.freeze({label, topic, tab});
export const RESEARCH_TRADE_ALERTS = Object.freeze({
  opening: trade('시초가', 'opening'),
  daytrading: trade('데이트레이딩', 'daytrading'),
  crypto: trade('비트코인', 'crypto'),
  soxl: trade('SOXL', 'soxl'),
  closing30: trade('종가 30분', 'closing30'),
  closing_bet: trade('개별 종목 종가 베팅', 'closing30', 'closing_bet')
});
export const RESEARCH_TRADE_TOPICS = Object.freeze([...new Set(
  Object.values(RESEARCH_TRADE_ALERTS).map(x => x.topic)
)]);
export function researchTradeAlert(strategy, kind) {
  if (strategy === 'closing30' && kind != null) {
    if (!['day', 'overnight'].includes(kind)) return null;
    if (kind === 'overnight') strategy = 'closing_bet';
  }
  return Object.hasOwn(RESEARCH_TRADE_ALERTS, strategy) ? RESEARCH_TRADE_ALERTS[strategy] : null;
}
