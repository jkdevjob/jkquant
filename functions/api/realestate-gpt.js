const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=900, s-maxage=3600",
  "access-control-allow-origin": "*"
};

const SOURCES = {
  price: {
    base: "https://data-api.kbland.kr/bfmstat/weekMnthlyHuseTrnd/priceIndex",
    params: {"월간주간구분코드":"01","매물종별구분":"01","매매전세코드":"01"}
  },
  jeonse: {
    base: "https://data-api.kbland.kr/bfmstat/weekMnthlyHuseTrnd/priceIndex",
    params: {"월간주간구분코드":"01","매물종별구분":"01","매매전세코드":"02"}
  },
  ratio: {
    base: "https://data-api.kbland.kr/bfmstat/weekMnthlyHuseTrnd/dealCntstTnantRato",
    params: {"매물종별구분":"01"}
  },
  buyer: {
    base: "https://data-api.kbland.kr/bfmstat/weekMnthlyHuseTrnd/maktTrnd",
    params: {"메뉴코드":"01","월간주간구분코드":"01"}
  },
  movein: {
    base: "https://api.kbland.kr/land-extra/lots/v1/api/aptMovinCnt",
    params: {"기간구분":"1"}
  },
  supply: {
    base: "https://data-api.kbland.kr/bfmpub/huse/huseSplyArsltInqury",
    params: {"dtailDataSelct":"1"}
  }
};

function json(data, status=200, extra={}) {
  return new Response(JSON.stringify(data), {status, headers:{...JSON_HEADERS, ...extra}});
}

function safeRegion(raw) {
  const v = String(raw || "").replace(/[^0-9]/g, "");
  if (!v) return "";
  return v.slice(0, 10);
}

export async function onRequestGet(context) {
  const reqUrl = new URL(context.request.url);
  const dataset = reqUrl.searchParams.get("dataset") || "sources";
  if (dataset === "sources") {
    return json({
      ok:true,
      datasets:Object.keys(SOURCES),
      note:"GPT 부동산 탭 전용 읽기 프록시. 외부 원천을 수정하지 않습니다."
    });
  }

  const src = SOURCES[dataset];
  if (!src) return json({ok:false,error:"unsupported dataset"}, 400);

  const upstream = new URL(src.base);
  for (const [k,v] of Object.entries(src.params)) upstream.searchParams.set(k,v);

  const region = safeRegion(reqUrl.searchParams.get("region"));
  if (region) {
    if (dataset === "movein" || dataset === "supply") upstream.searchParams.set("법정동코드", region.padEnd(10,"0"));
    else upstream.searchParams.set("지역코드", region);
  }

  try {
    const res = await fetch(upstream.toString(), {
      headers: {
        "accept":"application/json,text/plain,*/*",
        "user-agent":"Mozilla/5.0 JKQuant-RealEstate-GPT/1.0"
      },
      cf: {cacheTtl: 3600, cacheEverything: true}
    });
    const text = await res.text();
    if (!res.ok) {
      return json({ok:false,error:"upstream",status:res.status,body:text.slice(0,500)}, 502);
    }

    let data;
    try { data = JSON.parse(text); }
    catch { return json({ok:false,error:"invalid json",body:text.slice(0,500)}, 502); }

    return json({
      ok:true,
      dataset,
      fetchedAt:new Date().toISOString(),
      source:upstream.origin + upstream.pathname,
      payload:data
    });
  } catch (e) {
    return json({ok:false,error:String(e && e.message || e)}, 502);
  }
}
