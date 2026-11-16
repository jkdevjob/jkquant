#!/usr/bin/env node
// 인스타 자동 발행 workflow 2개(은퇴노트·매니악)를 만든다 — 손으로 고치지 말고 이 파일을 고친 뒤 다시 돌린다.
//   node reel/tools/gen-publish-workflows.mjs   (저장소 맨 위에서)
// 설계(11/16):
//  - 푸시 한 번으로 오늘 + 앞으로 DAYS-1 일의 게시 시각을 다 지킨다(루틴이 늦게 깨어나도 예비·미리 만든 편이 나감).
//  - 작업 하나는 6시간 제한(timeout 340분)이라, 기다리는 간격을 5시간 이하로 쪼갠다(11/14 매니악 20:30 이 6시간 대기로 취소됐음).
//  - 각 작업은 실행이 시작된 날(한국)을 기준일로 '+N일 HH:MM' 까지 기다린다. 이미 150분 넘게 지난 게시 칸은 바로 넘어간다.
//  - 새 푸시가 오면 앞 실행은 취소되고 새 실행이 이어받는다(게시 직전에 최신 큐를 다시 받는다).
import fs from "fs";

const DAYS = 3;
const LATE_MIN = 150;
const CHANNELS = [
  {
    file: ".github/workflows/retire-note-publish.yml", name: "은퇴노트 인스타 자동 발행", group: "retire-note-publish",
    paths: ["reel/queue/queue.json", "reel/queue/publish.config.json", "reel/publish-social.mjs", ".github/workflows/retire-note-publish.yml"],
    sparse: ["reel/publish-social.mjs", "reel/queue/queue.json", "reel/queue/publish.config.json", "reel/queue/published.json", "reel/queue/last_run.txt"],
    records: "reel/queue/published.json reel/queue/last_run.txt", msg: "인스타 자동 발행 기록", chArg: "",
    secrets: { IG_ACCESS_TOKEN: "IG_ACCESS_TOKEN", IG_USER_ID: "IG_USER_ID", YT_CLIENT_ID: "YT_CLIENT_ID", YT_CLIENT_SECRET: "YT_CLIENT_SECRET", YT_REFRESH_TOKEN: "YT_REFRESH_TOKEN" },
    ytCheck: true,
    // [시각, 게시?] — 하루 안 순서. 밤 대기는 다음 날로 넘어감(+1).
    day: [["09:00", 1], ["12:00", 1], ["15:00", 0], ["18:00", 1]], night: [["23:00", 0, 0], ["04:00", 0, 1]],
    intro: "은퇴노트 릴스를 인스타그램 API 로 올린다(유튜브는 당분간 Metricool — 유튜브 API 는 구글 감사 전엔 비공개로 잠김). 게시 칸: 한국 09:00 · 12:00 · 18:00.",
  },
  {
    file: ".github/workflows/mb-publish.yml", name: "매니악 브리핑 인스타 자동 발행", group: "mb-publish",
    paths: ["reel/queue/mb/**", "reel/publish-social.mjs", ".github/workflows/mb-publish.yml"],
    sparse: ["reel/publish-social.mjs", "reel/queue/queue.json", "reel/queue/mb/"],
    records: "reel/queue/mb/published.json reel/queue/mb/last_run.txt", msg: "매니악 브리핑 인스타 자동 발행 기록", chArg: " --channel mb",
    secrets: { IG_ACCESS_TOKEN: "MB_IG_ACCESS_TOKEN", IG_USER_ID: "MB_IG_USER_ID" },
    ytCheck: false,
    day: [["08:30", 1], ["13:00", 0], ["17:00", 0], ["20:30", 1]], night: [["01:00", 0, 1], ["05:00", 0, 1]],
    intro: "매니악 브리핑(@maniacbriefing) 릴스를 인스타그램 API 로 올린다(같은 업로더 --channel mb, 큐·기록 reel/queue/mb/). 게시 칸: 한국 08:30 · 20:30.",
  },
];

const ind = (s, n) => s.split("\n").map((l) => (l ? " ".repeat(n) + l : l)).join("\n");
const checkout = (c) => `- uses: actions/checkout@v4
  with:
    ref: \${{ env.BRANCH }}
    fetch-depth: 1
    filter: blob:none
    sparse-checkout: |
${c.sparse.map((p) => "      " + p).join("\n")}
    sparse-checkout-cone-mode: false
- uses: actions/setup-node@v4
  with:
    node-version: 22`;
const secretEnv = (c) => Object.entries(c.secrets).map(([k, v]) => `  ${k}: \${{ secrets.${v} }}`).join("\n");
const waitStep = (publish) => `- name: 시각까지 기다리기
  id: wait
  run: |
    d=$(date -d "$BASE + $DAY day" +%F)
    target=$(TZ=Asia/Seoul date -d "$d $SLOT" +%s)
    now=$(date +%s)
    if [ "$target" -gt "$now" ]; then
      echo "한국 $d $SLOT 까지 $(( (target - now) / 60 ))분 기다림"
      sleep $(( target - now ))
      echo "go=1" >> "$GITHUB_OUTPUT"
    elif [ $(( now - target )) -le ${LATE_MIN * 60} ]; then
      echo "한국 $d $SLOT 이 막 지남 — 바로 확인"
      echo "go=1" >> "$GITHUB_OUTPUT"
    else
      echo "한국 $d $SLOT 은 ${LATE_MIN}분 넘게 지남 — 넘어감"
      echo "go=0" >> "$GITHUB_OUTPUT"
    fi`;

function publishSteps(c) {
  return `${waitStep(true)}
- name: 최신 큐 받기
  if: \${{ steps.wait.outputs.go == '1' }}
  run: |
    git fetch -q --depth=1 --filter=blob:none origin "$BRANCH"
    git reset -q --hard FETCH_HEAD
    git log -1 --format='큐 커밋 %h %s'
- name: 게시
  if: \${{ steps.wait.outputs.go == '1' }}
  env:
${ind(secretEnv(c), 2)}
  run: cd reel && node publish-social.mjs${c.chArg}
- name: 기록 저장
  if: \${{ !cancelled() && steps.wait.outputs.go == '1' }}
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    files="${c.records}"
    for f in $files; do if [ -f "$f" ]; then git add "$f"; fi; done
    if git diff --cached --quiet; then echo "기록 변경 없음"; exit 0; fi
    git commit -q -m "${c.msg} ($SLOT)"
    for i in 1 2 3 4 5; do
      if git push -q origin "HEAD:$BRANCH"; then echo "기록 푸시 완료"; exit 0; fi
      # 그사이 루틴이 브랜치에 푸시했으면 최신 위에 기록 두 파일만 다시 얹는다(기록은 이 workflow 만 쓴다)
      for f in $files; do if [ -f "$f" ]; then cp "$f" "$RUNNER_TEMP/$(basename "$f")"; fi; done
      git fetch -q --depth=1 --filter=blob:none origin "$BRANCH"
      git reset -q --hard FETCH_HEAD
      for f in $files; do if [ -f "$RUNNER_TEMP/$(basename "$f")" ]; then cp "$RUNNER_TEMP/$(basename "$f")" "$f"; git add "$f"; fi; done
      if git diff --cached --quiet; then echo "기록 변경 없음"; exit 0; fi
      git commit -q -m "${c.msg} ($SLOT)"
      sleep $(( i * 3 ))
    done
    echo "기록 푸시 5회 실패"; exit 1`;
}

const toMin = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
function chain(c) {
  const out = [];
  for (let d = 0; d < DAYS; d++) {
    for (const [hm, pub] of c.day) out.push({ day: d, hm, pub });
    if (d < DAYS - 1) for (const [hm, pub, plus] of c.night) out.push({ day: d + plus, hm, pub });
  }
  // 간격 점검: 5시간 이하
  for (let i = 1; i < out.length; i++) {
    const gap = (out[i].day * 1440 + toMin(out[i].hm)) - (out[i - 1].day * 1440 + toMin(out[i - 1].hm));
    if (gap <= 0 || gap > 300) throw new Error(`${c.group}: ${out[i - 1].hm}→${out[i].hm} 간격 ${gap}분`);
  }
  return out;
}

for (const c of CHANNELS) {
  const steps = chain(c);
  const jobId = (s) => `d${s.day}-${s.pub ? "slot" : "wait"}-${s.hm.replace(":", "")}`;
  let y = `name: ${c.name}

# ⚠ 이 파일은 reel/tools/gen-publish-workflows.mjs 가 만든다 — 손으로 고치지 말 것.
# ${c.intro}
# 이 파일은 main 이 아니라 claude/instagram-reel-video-creation-wl16ee 브랜치에 있다(정해진 시각 실행은 이 저장소에서 4~9시간 늦어 푸시로 깨운다).
# 루틴(Claude)이 큐를 이 브랜치에 푸시하면 실행되고, 오늘부터 ${DAYS}일 동안 게시 칸마다 그 시각에 올릴 것만 올린다.
# 작업 하나 6시간 제한이라 5시간 이하 간격으로 '기다리기만 하는 작업'을 끼운다. 새 푸시가 오면 앞 실행은 취소되고 새 실행이 이어받는다.
# 같은 영상을 두 번 올리지 않게: 기록 커밋(봇 커밋은 다시 깨우지 않음) + 업로더가 계정 최근 게시물 캡션 첫 줄을 한 번 더 확인.
# 발행을 끄려면 그 채널 publish.config.json 의 enabled 를 false.

on:
  push:
    branches: [claude/instagram-reel-video-creation-wl16ee]
    paths:
${c.paths.map((p) => `      - "${p}"`).join("\n")}
  workflow_dispatch:
    inputs:
      dry:
        description: "점검만(키가 통하는지·지금 올릴 것만 확인, 올리지 않음)"
        type: boolean
        default: false

permissions:
  contents: write

concurrency:
  group: ${c.group}
  cancel-in-progress: true

env:
  BRANCH: claude/instagram-reel-video-creation-wl16ee

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    outputs:
      base: \${{ steps.base.outputs.base }}
    steps:
      - name: 기준일(한국)
        id: base
        run: echo "base=$(TZ=Asia/Seoul date +%F)" >> "$GITHUB_OUTPUT"
${ind(checkout(c), 6)}
      - name: 점검
        env:
${ind(secretEnv(c), 10).replace(/^ {10}/gm, "          ")}
        run: cd reel && node publish-social.mjs --dry${c.chArg}
`;
  if (c.ytCheck) y += `      - name: 유튜브 키 점검(올리지 않음)
        env:
          YT_CLIENT_ID: \${{ secrets.YT_CLIENT_ID }}
          YT_CLIENT_SECRET: \${{ secrets.YT_CLIENT_SECRET }}
          YT_REFRESH_TOKEN: \${{ secrets.YT_REFRESH_TOKEN }}
        run: cd reel && node publish-social.mjs --dry --only yt | sed -n 1,2p || true
`;
  let prev = "check";
  for (const s of steps) {
    const id = jobId(s);
    y += `
  ${id}:
    needs: [check${prev === "check" ? "" : ", " + prev}]
    if: \${{ !cancelled() && !inputs.dry }}
    runs-on: ubuntu-latest
    timeout-minutes: 340
    env:
      BASE: \${{ needs.check.outputs.base }}
      DAY: "${s.day}"
      SLOT: "${s.hm}"
    steps:
${ind(s.pub ? checkout(c) + "\n" + publishSteps(c) : waitStep(false), 6)}
`;
    prev = id;
  }
  fs.writeFileSync(c.file, y);
  console.log(`✔ ${c.file} — 작업 ${steps.length + 1}개 (게시 ${steps.filter((s) => s.pub).length}칸, ${DAYS}일)`);
}
