#!/usr/bin/env python3
"""JKQuant aquatic competition collector.
Public listing discovery + federation notices; preserve unknown fields and historical changes.
Only a detailed official notice is treated as authoritative. No PDF inference/false yes/no.
"""
from __future__ import annotations
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "swim" / "competitions.json"
CHANGES = ROOT / "data" / "swim" / "changes.json"
TODAY = datetime.now(ZoneInfo("Asia/Seoul")).date()
NOW = datetime.now(ZoneInfo("Asia/Seoul")).isoformat(timespec="seconds")
UA = "JKQuantAquatics/1.0 (public scheduled competition lookup; contact via repository)"
REGIONS = ("천안", "아산", "세종", "청주", "공주", "대전", "계룡", "논산",
           "금산", "옥천", "보은", "영동", "김천", "증평", "괴산", "부여")
VENUES = {"한밭수영장": "대전", "한들문화센터": "천안",
          "김천실내수영장": "김천", "정부세종청사체육관": "세종",
          "배미수영장": "아산", "청주실내수영장": "청주",
          "공주대학교수영장": "공주"}
OFFICIAL_HOSTS = ("korswim.co.kr", "djswimming.or.kr", "gbaquatics.co.kr",
                  "sjswim.or.kr", "cnswimming.or.kr", "cnsports.or.kr")
FIELDS = ("title", "region", "venue", "start_date", "end_date", "apply_open", "apply_close",
          "eligibility", "events", "free50", "free100", "kind", "sport",
          "adult_possible", "official_url", "verification")
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7"})

def clean(x):
    return re.sub(r"\s+", " ", str(x or "")).strip()

def date_norm(x):
    match = re.search(r"(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})", str(x or ""))
    if not match: return ""
    try: return datetime(int(match[1]), int(match[2]), int(match[3])).date().isoformat()
    except ValueError: return ""

def dates(x):
    return [date_norm(m.group(0)) for m in re.finditer(r"20\d{2}[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}", str(x or ""))]

def region_for(x):
    s = clean(x)
    for label in REGIONS:
        if label in s: return label
    for label, city in VENUES.items():
        if label in s: return city
    return ""

def kind_for(title, target):
    s = title + " " + target
    if re.search(r"마스터즈|생활체육|동호인|회장배 전국 마스터즈", s): return "masters"
    if re.search(r"국가대표|전문선수|전국수영대회|선수권|종별|체전|선발대회|대통령배", s): return "elite"
    if re.search(r"유소년|꿈나무|초등|중등|고등|학생|교육감배", s): return "student"
    return "other"

def sport_for(title, events):
    s = title + " " + events
    for pattern, label in [
        (r"핀수영|프리다이빙", "핀수영"), (r"아티스틱", "아티스틱"),
        (r"다이빙", "다이빙"), (r"수구", "수구"),
        (r"오픈워터|장거리 수영|아쿠아마라톤", "오픈워터"),
        (r"경영|자유형|배영|평영|접영|개인혼영", "경영"),
    ]:
        if re.search(pattern, s): return label
    if re.search(r"수영|마스터즈", s): return "경영"  # 대회 유형만, 구체 경기종목은 미확정
    return "기타"

def freestyle(events, distance):
    # Do NOT read venue '50m 풀' as freestyle event, and do not infer absence.
    s = clean(events).replace("ｍ", "m").replace("M", "m")
    pattern = rf"(?:자유형|Free\s*style)\s*(?:[·:/,]\s*)?{distance}\s*m\b|{distance}\s*m\s*(?:자유형|Free\s*style)"
    if re.search(pattern, s, flags=re.I): return True
    # e.g. '자유형 50m·100m' explicitly lists both freestyle distances.
    if distance == 100 and re.search(r"자유형\\s*50\\s*m\\s*(?:[·,/]|및)\\s*100\\s*m", s):
        return True
    return None

def adult_possible(title, eligibility):
    s = title + " " + eligibility
    if re.search(r"성인|일반부|동호인|마스터즈|20대|30대|40대|50대|60대", s): return True
    if re.search(r"유소년|초등학생|초·중|초중|꿈나무", s) and not re.search(r"성인|일반부", s): return False
    return None

def is_official(url):
    host = urlparse(url or "").netloc.lower()
    return any(host == d or host.endswith("." + d) for d in OFFICIAL_HOSTS)

def uid(item):
    s = re.sub(r"제\s*\d+\s*회", "", item["title"])
    s = re.sub(r"20\d{2}\s*년?", "", s)
    s = re.sub(r"[^가-힣a-z0-9]", "", s.lower())[:85]
    basis = s + "|" + (item.get("start_date") or "undated") + "|" + item.get("region", "")
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:16]

def base_item(title, venue="", region="", start="", end="", source="", source_url="", verification="secondary"):
    title = clean(title); venue = clean(venue); region = region or region_for(venue+" "+title)
    if not title or not region: return None
    kind = kind_for(title, "")
    out = dict(title=title, region=region, venue=venue, start_date=start or "",
               end_date=end or start or "", apply_open="", apply_close="",
               eligibility="", events="", free50=None, free100=None, adult_possible=adult_possible(title,""),
               kind=kind, sport=sport_for(title,""), official_url=source_url if is_official(source_url) else "",
               source_url=source_url, source=source, verification=verification,
               first_seen=TODAY.isoformat(), last_seen=TODAY.isoformat(), last_changed=TODAY.isoformat())
    if out["sport"] in ("다이빙","수구","아티스틱","오픈워터","핀수영"):
        out["free50"] = False
        out["free100"] = False
    out["id"] = uid(out)
    return out

def get_soup(url):
    r = SESSION.get(url, timeout=22); r.raise_for_status()
    if len(r.content)>5_000_000: raise ValueError("response too large")
    return BeautifulSoup(r.content, "html.parser")

def extract_lines(card):
    return [clean(v) for v in card.get_text("\n", strip=True).split("\n") if clean(v)]

def value_after(lines, label):
    # Labels are displayed individually by the swim index; never use another card's fields.
    for i, line in enumerate(lines):
        if line == label and i+1 < len(lines):
            return lines[i+1]
        if line.startswith(label + ":"):
            return clean(line[len(label)+1:])
    return ""

def card_for(h3):
    # Nearest enclosing element containing precisely one card heading and its labels.
    p = h3
    for _ in range(9):
        p = p.parent
        if p is None: return None
        txt = p.get_text(" ", strip=True)
        if "대회일" in txt and "장소" in txt and "접수" in txt and "대상" in txt and len(p.find_all("h3"))==1:
            return p
    return None

def scrape_swim_index():
    url = "https://swimming.co.kr/"
    soup = get_soup(url); out = []
    for h3 in soup.find_all("h3"):
        card = card_for(h3)
        if card is None: continue
        title = clean(h3.get_text(" ", strip=True))
        if "수영" not in title and "마스터즈" not in title and "대회" not in title and "선발" not in title: continue
        lines = extract_lines(card)
        venue = value_after(lines, "장소")
        region = region_for(" ".join(lines[:12]) + " " + venue + " " + title)
        if not region: continue
        ds = dates(value_after(lines,"대회일"))
        item = base_item(title,venue,region,ds[0] if ds else "",ds[-1] if ds else "",
                         "전국 수영대회 통합 목록",url,"secondary")
        if not item: continue
        applied = dates(value_after(lines,"접수"))
        if len(applied)>1: item["apply_open"],item["apply_close"]=applied[0],applied[-1]
        elif applied: item["apply_close"]=applied[0]
        item["eligibility"]=value_after(lines,"대상")
        item["events"]=value_after(lines,"종목")
        item["kind"]=kind_for(title,item["eligibility"])
        item["sport"]=sport_for(title,item["events"])
        item["adult_possible"]=adult_possible(title,item["eligibility"])
        if item["sport"] == "경영":
            item["free50"]=freestyle(item["events"],50)
            item["free100"]=freestyle(item["events"],100)
        elif item["sport"] in ("다이빙","수구","아티스틱","오픈워터","핀수영"):
            item["free50"]=False
            item["free100"]=False
        for a in card.find_all("a",href=True):
            if "공식요강" in a.get_text(" ",strip=True):
                target=urljoin(url,a["href"])
                if is_official(target):item["official_url"]=target
                break
        item["id"]=uid(item)
        out.append(item)
    if not out: raise ValueError("no parsable competition cards")
    return out

def scrape_korswim():
    out=[]
    for page in range(1,5):
        url = "https://www.korswim.co.kr/11" + (f"?page={page}" if page>1 else "")
        try: soup=get_soup(url)
        except Exception:
            if not out: raise
            break
        seen=0
        for a in soup.find_all("a",href=True):
            label=clean(a.get_text(" ",strip=True))
            if "대회기간" not in label:continue
            m=re.search(r"대회기간\s*:\s*(20\d\d-\d\d-\d\d)\s*~\s*(20\d\d-\d\d-\d\d)",label)
            if not m: continue
            before=label[:m.start()].removeprefix("공지").strip()
            if " - " not in before: continue
            title,venue=before.rsplit(" - ",1)
            item=base_item(title,venue,start=m[1],end=m[2],source="대한수영연맹 공식 일정",
                           source_url=urljoin(url,a["href"]),verification="official")
            if item: out.append(item)
            seen+=1
        if not seen:break
        time.sleep(0.2)
    if not out: raise ValueError("no official schedule entries")
    return out

def read_json(path, default):
    try:return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError,ValueError):return default

def filled(x):
    return x not in (None,"",[],{},"확인 필요","공식요강 확인")

def merge_entry(old,new):
    item=dict(old)
    # Official new data may override the index; otherwise absence must not erase good fields.
    prefer_new = new.get("verification")=="official" or old.get("verification")!="official"
    for field in FIELDS:
        val=new.get(field)
        if filled(val) and (prefer_new or not filled(item.get(field))):
            item[field]=val
    # Even an official schedule with no eligibility details must not erase known secondary details.
    for field in ("source", "source_url"):
        if new.get(field) and (prefer_new or not item.get(field)):item[field]=new[field]
    if new.get("verification")=="official":item["verification"]="official"
    item["last_seen"]=TODAY.isoformat()
    item["last_changed"]=old.get("last_changed") or TODAY.isoformat()
    changed={field:dict(old=old.get(field),new=item.get(field))
             for field in FIELDS if old.get(field)!=item.get(field)}
    if changed:item["last_changed"]=TODAY.isoformat()
    return item,changed

def refresh():
    previous=read_json(DATA,{"competitions":[]})
    entries={x["id"]:x for x in previous.get("competitions",[]) if isinstance(x,dict) and x.get("id")}
    changes=read_json(CHANGES,{"changes":[]}).get("changes",[])
    results=[];failed=[]
    for name,fn in [("전국 수영대회 목록",scrape_swim_index),("대한수영연맹",scrape_korswim)]:
        try:
            batch=fn();results.extend(batch);print(f"{name}: {len(batch)} entries")
        except Exception as exc:
            failed.append(f"{name}: {type(exc).__name__}")
            print(f"{name} failed: {exc}",file=sys.stderr)
    if not results:
        raise RuntimeError("No sources succeeded. Keep previous data unchanged.")
    count_new=count_changed=0
    # Secondary first, official second so detailed primary URLs are preferred.
    for fresh in sorted(results,key=lambda r:r.get("verification")=="official"):
        if fresh["id"] not in entries:
            entries[fresh["id"]]=fresh;count_new+=1
            changes.append({"id":fresh["id"],"title":fresh["title"],"date":TODAY.isoformat(),"type":"new"})
        else:
            old=entries[fresh["id"]];updated,diff=merge_entry(old,fresh);entries[fresh["id"]]=updated
            if diff:
                count_changed+=1
                changes.append({"id":fresh["id"],"title":fresh["title"],"date":TODAY.isoformat(),
                                "type":"updated","fields":sorted(diff)})
    # Archives are retained; missing from current sources is NOT a cancellation.
    values=sorted(entries.values(),key=lambda e:(e.get("start_date") or "9999",e["title"]))
    payload={"schema_version":1,"updated_at":NOW,"range":"천안~김천","sources_failed":failed,
             "competitions":values}
    DATA.parent.mkdir(parents=True,exist_ok=True)
    DATA.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    CHANGES.write_text(json.dumps({"updated_at":NOW,"changes":changes[-500:]},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"total={len(values)} new={count_new} changed={count_changed} failed={len(failed)}")

if __name__=="__main__":
    refresh()
