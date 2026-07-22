// AI 기획·카피 모듈 — Claude API로 (1) "오늘 뭐 만들지" 종목/앵글 기획,
// (2) 실제 백테스트 숫자 기반 캡션·해시태그·후킹/펀치 문구 생성.
//
// 인증: ANTHROPIC_API_KEY 환경변수(또는 `ant auth login` 프로필)를 SDK가 자동 사용.
//   export ANTHROPIC_API_KEY=sk-ant-...
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-8";

function client() {
  // 키 미설정 시 명확한 안내로 실패
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error(
      "ANTHROPIC_API_KEY가 없습니다. `export ANTHROPIC_API_KEY=sk-ant-...` 후 다시 실행하세요."
    );
  }
  return new Anthropic();
}

// 응답에서 첫 text 블록의 JSON을 파싱
function parseJSON(response) {
  const block = response.content.find((b) => b.type === "text");
  if (!block) throw new Error("빈 응답");
  return JSON.parse(block.text);
}

// ── (1) 릴스 기획: n개의 종목/앵글 아이디어 ──
// market: "KR" | "US" | "MIX"
export async function planReels({ count = 5, market = "KR", note = "" } = {}) {
  const c = client();
  const marketDesc =
    market === "US"
      ? "미국 상장 종목(티커, 예: TQQQ, AAPL, TSLA)"
      : market === "MIX"
        ? "한국(6자리 종목코드) 또는 미국(티커) 종목 섞어서"
        : "한국 상장 종목(6자리 종목코드, 예: 삼성전자 005930, 카카오 035720)";

  const schema = {
    type: "object",
    properties: {
      reels: {
        type: "array",
        items: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "한국 6자리 종목코드 또는 미국 티커" },
            name: { type: "string", description: "화면 표시용 종목명(한글)" },
            market: { type: "string", enum: ["KR", "US"] },
            amount: { type: "number", description: "회당 적립금액(KR=원, US=달러). KR은 10000 권장" },
            interval: { type: "string", enum: ["daily", "weekly", "monthly"] },
            start: { type: "string", description: "시작일 YYYY-MM-DD" },
            angle: { type: "string", description: "왜 자극적인가(1줄). 급등/급락/화제성 근거" },
            hook: { type: "string", description: "오프닝 후킹 문구(15자 내외)" },
          },
          required: ["symbol", "name", "market", "amount", "interval", "start", "angle", "hook"],
          additionalProperties: false,
        },
      },
    },
    required: ["reels"],
    additionalProperties: false,
  };

  const system =
    "너는 한국 주식 릴스(숏폼) 콘텐츠 기획자다. 인스타 계정 'exitantai' 스타일 — " +
    "'○○에 매일 1만원씩 샀다면?' 적립식 시뮬레이션으로 손실/수익을 자극적으로 보여주는 콘텐츠를 기획한다. " +
    "조회수가 터질 만한, 대중이 아는 화제성 종목을 고른다. 종목코드/티커는 정확해야 한다(모르면 유명 종목만).";

  const user =
    `${marketDesc} 중에서 릴스로 만들 아이디어 ${count}개를 뽑아줘.\n` +
    `- 손실이 크게 난 종목과 크게 오른 종목을 섞어서(반응이 갈리게)\n` +
    `- start는 화제의 고점/저점 부근으로 잡아 드라마틱하게\n` +
    (note ? `- 추가 요청: ${note}\n` : "") +
    `각 항목의 symbol(코드/티커)은 반드시 실제 존재하는 정확한 값으로.`;

  const response = await c.messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  });
  return parseJSON(response).reels;
}

// ── (2) 카피 생성: 실제 백테스트 결과로 캡션·해시태그·문구 ──
// dca: lib/dca.mjs 의 runDCA 결과 + { name, currency, amountLabel }
export async function writeCopy({
  name,
  currency = "KRW",
  amountLabel,
  intervalLabel,
  startLabel,
  endLabel,
  invested,
  finalValue,
  profit,
  returnPct,
  handle = "",
} = {}) {
  const c = client();
  const unit = currency === "KRW" ? "원" : "$";
  const fmt = (v) =>
    currency === "KRW"
      ? `${Math.round(v / 10000).toLocaleString()}만원`
      : `$${Math.round(v).toLocaleString()}`;

  const schema = {
    type: "object",
    properties: {
      hook: { type: "string", description: "오프닝 후킹 문구(15자 내외)" },
      punch: { type: "string", description: "마지막 펀치라인(18자 내외, 자극적)" },
      caption: { type: "string", description: "인스타 캡션(2~4문장, 이모지 약간, 반응 유도)" },
      hashtags: {
        type: "array",
        items: { type: "string" },
        description: "해시태그 8~12개(# 포함, 종목/투자/릴스 관련)",
      },
    },
    required: ["hook", "punch", "caption", "hashtags"],
    additionalProperties: false,
  };

  const gain = profit >= 0;
  const system =
    "너는 한국 주식 릴스 카피라이터다. 인스타 'exitantai' 스타일 — 짧고 자극적이고 약간 풍자적. " +
    "수익이면 부러움/후회, 손실이면 조롱/위로를 자극한다. 과장은 하되 허위 수치는 만들지 않는다(주어진 숫자만 사용).";

  const user =
    `아래 적립식 백테스트 결과로 릴스 카피를 써줘.\n` +
    `종목: ${name}\n` +
    `규칙: ${intervalLabel} ${amountLabel}씩\n` +
    `기간: ${startLabel} ~ ${endLabel}\n` +
    `투자원금: ${fmt(invested)}\n` +
    `평가금액: ${fmt(finalValue)}\n` +
    `수익: ${fmt(profit)} (${gain ? "+" : ""}${returnPct.toFixed(1)}%)\n` +
    (handle ? `계정: ${handle}\n` : "") +
    `\n결과는 ${gain ? "수익" : "손실"}이다. 톤을 거기에 맞춰라.`;

  const response = await c.messages.create({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  });
  return parseJSON(response);
}
