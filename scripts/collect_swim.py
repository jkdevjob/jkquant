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
# Whole Republic of Korea. A missing locality is '지역 미확인', never excluded.
REGIONS = ("서울","인천","경기","부산","대구","광주","대전","울산","세종","강원",
           "충북","충남","전북","전남","경북","경남","제주")
CITY_ALIASES = {
    "천안":"천안","아산":"아산","청주":"청주","공주":"공주","계룡":"계룡","논산":"논산","금산":"금산",
    "옥천":"옥천","보은":"보은","영동":"영동","김천":"김천","증평":"증평","괴산":"괴산",
    "부여":"부여","완주":"완주","전주":"전주","익산":"익산","군산":"군산","목포":"목포",
    "여수":"여수","순천":"순천","포항":"포항","안동":"안동","구미":"구미","경산":"경산",
    "창원":"창원","김해":"김해","진주":"진주","거제":"거제","양산":"양산","통영":"통영",
    "양천":"서울","성북":"서울","송파":"서울","강남":"서울","성동":"서울","강서":"서울",
    "잠실":"서울","서초":"서울","관악":"서울","노원":"서울","도봉":"서울","종로":"서울",
    "수원":"수원","성남":"성남","안산":"안산","안양":"안양","파주":"파주",
    "시흥":"시흥","광명":"광명","용인":"용인","평택":"평택","화성":"화성","부천":"부천",
    "안성":"안성","오산":"오산","여주":"여주","포천":"포천","남양주":"남양주","김포":"김포",
    "충주":"충주","제천":"제천","음성":"음성","강릉":"강릉","속초":"속초","춘천":"춘천",
    "원주":"원주","동해":"동해","삼척":"삼척","제주":"제주","서귀포":"서귀포",
    "울산":"울산","문수":"울산","대구":"대구","광주":"광주","부산":"부산",
}
PROVINCE_ALIASES = {"서울특별시":"서울","서울시":"서울","인천광역시":"인천","경기도":"경기",
"부산광역시":"부산","대구광역시":"대구","광주광역시":"광주","대전광역시":"대전",
"울산광역시":"울산","세종특별자치시":"세종","강원특별자치도":"강원","강원도":"강원",
"충청북도":"충북","충청남도":"충남","전북특별자치도":"전북","전라북도":"전북",
"전라남도":"전남","경상북도":"경북","경상남도":"경남","제주특별자치도":"제주",
"충남":"충남","충북":"충북","경북":"경북","경남":"경남","전북":"전북","전남":"전남"}
VENUES = {"한밭수영장":"대전","한들문화센터":"천안","김천실내수영장":"김천",
"정부세종청사체육관":"세종","배미수영장":"아산","청주실내수영장":"청주",
"공주대학교수영장":"공주","문수실내수영장":"울산","사직실내수영장":"부산",
"남부대시립국제수영장":"광주","문학박태환수영장":"인천","잠실":"서울",
"완산실내수영장":"전주","창원실내수영장":"창원","목포실내수영장":"목포"}
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
    s=clean(x)
    # Prioritize actual swimming pool locations over a competition's sponsor name.
    for venue, city in VENUES.items():
        if venue in s: return city
    for city, result in sorted(CITY_ALIASES.items(), key=lambda kv: -len(kv[0])):
        if city in s: return result
    for province, result in sorted(PROVINCE_ALIASES.items(), key=lambda kv: -len(kv[0])):
        if province in s: return result
    for province in REGIONS:
        if province in s: return province
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
    if distance == 100 and re.search(r"자유형\s*50\s*m\s*(?:[·,/]|및)\s*100\s*m", s):
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
    if not title: return None
    region = region or "지역 미확인"
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

def scrape_whoisfast():
    # Independent nationwide masters calendar; names/venues are secondary evidence.
    # Parse lightweight visible text instead of assuming a fragile CSS class.
    url=f"https://whoisfast.com/meets?year={TODAY.year}"
    soup=get_soup(url)
    lines=[clean(x) for x in soup.get_text("\n",strip=True).split("\n") if clean(x)]
    out=[]
    for i,line in enumerate(lines):
        if not re.match(r"^20\d{2}[.]\d{1,2}[.]\d{1,2}(?:\s*~\s*20\d{2}[.]\d{1,2}[.]\d{1,2})?",line):
            continue
        ds=dates(line)
        if not ds: continue
        title=""
        for x in lines[i+1:i+5]:
            if re.search(r"수영대회|마스터즈|생활체육|연맹회장배|도지사배|시장배|수영\s*대회",x) and len(x)<130:
                title=re.sub(r"\s*예정\s*$","",x).strip()
                break
        if not title:continue
        venue=""
        for x in lines[i+2:i+7]:
            if "수영장" in x or "스포츠센터" in x or "체육관" in x:
                venue=x.split("·")[0].strip()
                break
        item=base_item(title,venue,start=ds[0],end=ds[-1],
                       source="Whoisfast 전국 마스터즈 일정",source_url=url)
        if item:out.append(item)
    if not out: raise ValueError("no recognized nationwide masters entries")
    return out

def read_json(path, default):
    try:return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError,ValueError):return default

def filled(x):
    return x not in (None,"",[],{},"확인 필요","공식요강 확인")

def event_family(title):
    s=clean(title).replace(" ","")
    if "흥타령" in s:return "흥타령"
    if ("경북" in s or "경상북도" in s) and "연맹회장배" in s:return "경북연맹회장배"
    if ("충남" in s or "충청남도" in s) and "도지사배" in s:return "충남도지사배"
    if "온통행복한대전" in s:return "대전전국마스터즈"
    return ""

def normalized_title(title):
    s=re.sub(r"제\s*\d+\s*회","",clean(title))
    s=re.sub(r"20\d{2}\s*년?","",s)
    return re.sub(r"[^가-힣a-z0-9]","",s.lower())

def same_meet(a,b):
    # A new authoritative announcement may resolve an initially unknown city.
    if a.get("region")!=b.get("region") and "지역 미확인" not in (a.get("region"),b.get("region")):
        return False
    a_date,b_date=a.get("start_date") or "",b.get("start_date") or ""
    if not (a_date and b_date) or a_date[:4]!=b_date[:4]:return False
    try:
        days=abs((datetime.fromisoformat(a_date)-datetime.fromisoformat(b_date)).days)
    except ValueError:return False
    f1,f2=event_family(a["title"]),event_family(b["title"])
    a_url,b_url=a.get("official_url"),b.get("official_url")
    if a_url and b_url and a_url==b_url:return True
    if f1 and f1==f2 and days<=14:return True
    return normalized_title(a["title"])==normalized_title(b["title"]) and days<=45

def merge_entry(old,new):
    item=dict(old)
    # Official new data may override the index; otherwise absence must not erase good fields.
    prefer_new = new.get("verification")=="official" or old.get("verification")!="official"
    # If a secondary index describes only the Sunday of a two-day meet,
    # keep the wider published date interval instead of shrinking it.
    if old.get("verification")=="secondary" and new.get("verification")=="secondary":
        if old.get("start_date") and old.get("end_date") and new.get("start_date") and new.get("end_date"):
            if old["start_date"]<=new["start_date"]<=new["end_date"]<=old["end_date"]:
                new=dict(new)
                new["start_date"]=old["start_date"]
                new["end_date"]=old["end_date"]
    for field in FIELDS:
        val=new.get(field)
        if field=="region" and val=="지역 미확인" and item.get("region")!="지역 미확인":
            continue
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
    for name,fn in [("대회 통합 목록",scrape_swim_index),
                    ("전국 마스터즈 일정",scrape_whoisfast),
                    ("대한수영연맹",scrape_korswim)]:
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
            match=next((known_id for known_id,known in entries.items() if same_meet(known,fresh)),None)
            if match:
                fresh["id"]=match
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
    payload={"schema_version":1,"updated_at":NOW,"range":"대한민국 전국","sources_failed":failed,
             "competitions":values}
    DATA.parent.mkdir(parents=True,exist_ok=True)
    DATA.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    CHANGES.write_text(json.dumps({"updated_at":NOW,"changes":changes[-500:]},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"total={len(values)} new={count_new} changed={count_changed} failed={len(failed)}")

if __name__=="__main__":
    refresh()
