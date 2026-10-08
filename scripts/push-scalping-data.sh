#!/usr/bin/env bash
# 연구 작업끼리 pull 직후 다른 작업이 push해도 다시 최신 상태에 rebase하고 저장한다.
# 실제 데이터 충돌은 멈춘다. 강제 push/이력 덮어쓰기/오류 무시는 하지 않는다.
set -euo pipefail
if [ "$(git branch --show-current)" != "scalping-data" ]; then
  echo "::error::데이터 저장은 scalping-data 브랜치에서만 가능합니다."
  exit 1
fi
delay="${JKQ_DATA_PUSH_RETRY_DELAY:-2}"
case "$delay" in 0|1|2|3|4|5) ;; *) echo "::error::잘못된 데이터 저장 재시도 간격"; exit 1;; esac
for attempt in 1 2 3 4 5; do
  if ! git pull --rebase origin scalping-data; then
    echo "::error::최신 데이터 병합 실패 — 실제 충돌/조회 오류를 확인해야 합니다."
    exit 1
  fi
  if git push origin HEAD:refs/heads/scalping-data; then
    echo "데이터 저장 성공 (시도 $attempt)"
    exit 0
  fi
  if [ "$attempt" -lt 5 ]; then
    echo "::notice::동시 저장으로 브랜치가 이동했거나 전송이 실패했습니다. 최신 데이터에 병합 후 재시도합니다 ($attempt/5)."
    sleep "$delay"
  fi
done
echo "::error::데이터 저장 재시도 5회 실패 — 기존 이력은 유지하며 실패로 보고합니다."
exit 1
