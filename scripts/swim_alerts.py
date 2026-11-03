#!/usr/bin/env python3
"""수영대회 알림 — 수집 결과(competitions.json)와 지난 알림 기록(alerts.json)을 비교해 텔레그램으로 한 번에 보낸다.

알리는 것 (다가오는 대회만)
  1) 새 대회 발표   2) 접수 시작   3) 접수 마감 임박(3일 이내)
  4) 개최일·장소 변경   5) 접수 기간 변경   6) 대회 취소·연기

중복 방지
- 보낸 알림은 열쇠(종류:대회id:값)로 alerts.json 에 남긴다. 같은 열쇠는 다시 보내지 않는다.
- alerts.json 이 없으면(첫 실행) 지금 상태를 기준선으로만 저장하고 보내지 않는다 — 이미 있던 대회를 '새 대회'로 쏟아내지 않는다.
- 전송이 실패하면 기록을 바꾸지 않는다(다음 실행에서 다시 보낸다).
각 항목 링크는 해당 대회 상세 화면(https://jkquant.pages.dev/swim?id=…)으로 바로 간다.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import date, datetime, timedelta
from html import escape
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("SWIM_DATA_DIR") or ROOT / "data" / "swim")
KST = ZoneInfo("Asia/Seoul")
HEAD = "[수영대회]"
APP = "https://jkquant.pages.dev/swim"
SOON_DAYS = 3
WATCH = ("start_date", "end_date", "venue", "apply_open", "apply_close", "status")


def today():
    v = os.environ.get("SWIM_TODAY")
    return date.fromisoformat(v) if v else datetime.now(KST).date()


def read_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return default


def snapshot(c):
    return {k: c.get(k) or "" for k in WATCH}


def _md(d):
    try:
        x = date.fromisoformat(d)
        return f"{x.month}/{x.day}"
    except (TypeError, ValueError):
        return "미정"


def period(c):
    s, e = c.get("start_date"), c.get("end_date")
    return _md(s) + ("~" + _md(e) if e and e != s else "")


def events(comps, state, t=None):
    """보낼 알림 목록과 새 기록. 순수 함수(시험 대상)."""
    t = t or today()
    ts = t.isoformat()
    known = state.get("known", {})
    sent = dict(state.get("sent", {}))
    out = []

    def add(key, kind, c, text):
        if key in sent:
            return
        out.append({"key": key, "kind": kind, "id": c["id"], "title": c["title"], "text": text,
                    "url": APP + "?id=" + c["id"]})

    new_known = dict(known)
    for c in comps:
        cid = c.get("id")
        if not cid or not c.get("start_date"):
            continue
        upcoming = (c.get("end_date") or c["start_date"]) >= ts
        snap = snapshot(c)
        old = known.get(cid)
        new_known[cid] = snap
        if not upcoming:
            continue
        where = " · ".join(x for x in (c.get("region"), c.get("venue")) if x)
        if old is None:
            if c.get("first_seen", ts) >= (t - timedelta(days=2)).isoformat():
                add(f"new:{cid}", "new", c, f"{period(c)} {where}")
        else:
            if old.get("status") != snap["status"] and snap["status"] in ("cancelled", "postponed"):
                word = "대회 취소" if snap["status"] == "cancelled" else "대회 연기"
                add(f"status:{cid}:{snap['status']}", "status", c, f"{word} — {period(c)} {where}")
            if (old.get("start_date"), old.get("end_date")) != (snap["start_date"], snap["end_date"]):
                add(f"date:{cid}:{snap['start_date']}~{snap['end_date']}", "date", c,
                    f"개최일 {period(old)} → {period(c)}")
            if old.get("venue") and snap["venue"] and old["venue"] != snap["venue"]:
                add(f"venue:{cid}:{snap['venue']}", "venue", c, f"장소 {old['venue']} → {snap['venue']}")
            if (old.get("apply_open"), old.get("apply_close")) != (snap["apply_open"], snap["apply_close"]) and \
                    (old.get("apply_open") or old.get("apply_close")):
                add(f"apply:{cid}:{snap['apply_open']}~{snap['apply_close']}", "apply", c,
                    f"접수 {_md(old.get('apply_open'))}~{_md(old.get('apply_close'))} → "
                    f"{_md(snap['apply_open'])}~{_md(snap['apply_close'])}")
        if c.get("status") in ("cancelled", "postponed"):
            continue
        ao, ac = c.get("apply_open"), c.get("apply_close")
        open_now = (not ao or ao <= ts) and (not ac or ts <= ac) and not c.get("apply_closed")
        if ao and ao <= ts <= (ac or ao) and (t - date.fromisoformat(ao)).days <= 2 and open_now:
            add(f"apply_start:{cid}:{ao}", "apply_start", c, f"접수 시작 {_md(ao)} · 마감 {_md(ac)} — {period(c)} {where}")
        if ac and open_now and 0 <= (date.fromisoformat(ac) - t).days <= SOON_DAYS:
            left = (date.fromisoformat(ac) - t).days
            add(f"deadline:{cid}:{ac}", "deadline", c, f"접수 마감 {'오늘' if left == 0 else f'D-{left}'} ({_md(ac)}) — {period(c)} {where}")
    return out, new_known


TITLES = {"new": "🆕 새 대회", "apply_start": "📝 접수 시작", "deadline": "⏰ 접수 마감 임박",
          "date": "📅 개최일 변경", "venue": "📍 장소 변경", "apply": "🗓 접수 기간 변경", "status": "⚠️ 취소·연기"}


def message(evts, t=None, limit=40):
    t = t or today()
    lines = [f"<b>{HEAD} 🏊 새 소식 {len(evts)}건</b> ({t.isoformat()})"]
    for kind in ("status", "date", "venue", "apply", "deadline", "apply_start", "new"):
        group = [e for e in evts if e["kind"] == kind]
        if not group:
            continue
        lines.append("")
        lines.append(f"<b>{TITLES[kind]}</b>")
        for e in group[:limit]:
            lines.append(f"• <a href=\"{escape(e['url'])}\">{escape(e['title'])}</a> — {escape(e['text'])}")
        if len(group) > limit:
            lines.append(f"… 외 {len(group) - limit}건")
    lines.append("")
    lines.append(f"🔗 <a href=\"{APP}\">전국 수영대회 전체 보기</a>")
    return "\n".join(lines)


def send(text, count):
    base = os.environ.get("JKQUANT_BASE", "https://jkquant.pages.dev").rstrip("/")
    key = os.environ.get("AUTOTRADE_KEY", "").strip()
    if not key:
        raise RuntimeError("AUTOTRADE_KEY 없음 — 알림 전송 생략")
    body = json.dumps({"text": text, "count": count}, ensure_ascii=False).encode("utf-8")
    proc = subprocess.run(["curl", "-sS", "--max-time", "30", "-X", "POST", "-H", f"x-monitor-key: {key}",
                           "-H", "content-type: application/json", "--data-binary", "@-", "-w", "\n%{http_code}",
                           f"{base}/api/swim-alert"], input=body, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    out = proc.stdout.decode("utf-8", "replace")
    resp, _, code = out.rpartition("\n")
    if proc.returncode != 0 or code.strip() != "200":
        raise RuntimeError(f"swim-alert HTTP {code.strip()} {resp[:300]}")
    data = json.loads(resp or "{}")
    if not data.get("ok"):
        raise RuntimeError(f"swim-alert error {data}")
    return data


def run(dry=False):
    t = today()
    comp = read_json(DATA_DIR / "competitions.json", {})
    comps = comp.get("competitions", [])
    path = DATA_DIR / "alerts.json"
    state = read_json(path, None)
    if not comps:
        print("대회 자료 없음 — 알림 생략")
        return 0
    if state is None:
        _, known = events(comps, {}, t)
        evts, _ = events(comps, {"known": known}, t)    # 기준선: 지금 해당하는 마감 임박 등도 '보낸 것'으로 둔다
        sent = {e["key"]: t.isoformat() for e in evts}
        Path(path).write_text(json.dumps({"schema_version": 1, "baseline_at": t.isoformat(), "known": known,
                                          "sent": sent, "last_sent_at": "", "last_count": 0},
                                         ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"알림 기준선 저장 — 대회 {len(known)}건 · 보내지 않음")
        return 0
    evts, known = events(comps, state, t)
    keep_after = (t - timedelta(days=400)).isoformat()
    sent = {k: v for k, v in state.get("sent", {}).items() if v >= keep_after}
    if evts:
        text = message(evts, t)
        if dry:
            print(text)
        else:
            send(text, len(evts))
            print(f"알림 {len(evts)}건 전송")
        for e in evts:
            sent[e["key"]] = t.isoformat()
        state["last_sent_at"] = datetime.now(KST).isoformat(timespec="seconds")
        state["last_count"] = len(evts)
    else:
        print("새 알림 없음")
    if not dry:
        state.update(known=known, sent=sent)
        Path(path).write_text(json.dumps(state, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return len(evts)


if __name__ == "__main__":
    try:
        run(dry=os.environ.get("SWIM_ALERT_DRY_RUN") == "1")
    except Exception as exc:
        # 알림이 실패해도 수집 결과 저장은 막지 않는다(기록은 그대로 두어 다음 실행에서 다시 보낸다).
        print(f"알림 실패: {exc}", file=sys.stderr)
        sys.exit(3)
