import unittest
from pathlib import Path
from bs4 import BeautifulSoup
import collect_swim as m

class SwimCollectorTests(unittest.TestCase):
    def test_parse_date(self):
        self.assertEqual(m.date_norm("2026. 11. 03"), "2026-11-03")
        self.assertEqual(m.date_norm("2026.19.44"), "")
    def test_scope(self):
        self.assertEqual(m.region_for("김천실내수영장"), "김천")
        self.assertEqual(m.region_for("한들문화센터 수영장"), "천안")
        self.assertEqual(m.region_for("서울 잠실수영장"), "")
    def test_free_50m_not_a_venue(self):
        self.assertIsNone(m.freestyle("50m 장수로 · 자유형",50))
        self.assertTrue(m.freestyle("자유형 50m·100m",50))
        self.assertTrue(m.freestyle("자유형 50m·100m",100))
        self.assertTrue(m.freestyle("자유형 50m / 자유형 100m",100))
    def test_type_classification(self):
        self.assertEqual(m.kind_for("경북연맹 전국 마스터즈 대회",""),"masters")
        self.assertEqual(m.kind_for("국가대표 선발대회",""),"elite")
        self.assertEqual(m.kind_for("꿈나무 수영대회",""),"student")
    def test_alias_and_reschedule_dedup(self):
        a={"title":"제16회 흥타령배전국마스터즈수영대회","region":"천안","start_date":"2026-11-28","official_url":""}
        b={"title":"제16회 천안 흥타령 마스터즈 수영대회","region":"천안","start_date":"2026-11-29","official_url":""}
        self.assertTrue(m.same_meet(a,b))
        b["start_date"]="2027-11-29"
        self.assertFalse(m.same_meet(a,b))
        b["start_date"]="2026-11-29"
        b["region"]="김천"
        self.assertFalse(m.same_meet(a,b))
    def test_secondary_date_subset_keeps_two_day_event(self):
        a=m.base_item("제16회 천안 흥타령 마스터즈수영대회","한들문화센터",start="2026-11-28",end="2026-11-29")
        b=m.base_item("제16회 천안 흥타령 마스터즈수영대회","한들문화센터",start="2026-11-29",end="2026-11-29")
        merged,diff=m.merge_entry(a,b)
        self.assertEqual(merged["start_date"],"2026-11-28")
        self.assertEqual(merged["end_date"],"2026-11-29")
        self.assertEqual(diff,{})
    def test_preserves_missing_from_weak_source(self):
        old=m.base_item("제1회 대전 마스터즈 수영대회","한밭수영장",start="2026-12-01",source_url="https://www.korswim.co.kr/11/1",verification="official")
        old["eligibility"]="등록 선수만";old["free50"]=True;old["last_changed"]="2026-11-01"
        weak=m.base_item("제1회 대전 마스터즈 수영대회","한밭수영장",start="2026-12-01",source_url="https://swimming.co.kr/")
        item,changes=m.merge_entry(old,weak)
        self.assertTrue(item["free50"])
        self.assertEqual(item["eligibility"],"등록 선수만")
        self.assertEqual(item["verification"],"official")
        self.assertEqual(changes,{})
    def test_extract_card(self):
        soup=BeautifulSoup('<section><article><small>접수예정 대전</small><h3>대전 마스터즈 수영대회</h3><b>대회일</b><span>2026.12.05 ~ 2026.12.06</span><b>장소</b><span>한밭수영장</span><b>접수</b><span>2026.11.09 ~ 2026.11.16</span><b>대상</b><span>성인 동호인</span><b>종목</b><span>자유형 50m</span></article></section>',"html.parser")
        card=m.card_for(soup.h3)
        self.assertIsNotNone(card)
        lines=m.extract_lines(card)
        self.assertEqual(m.value_after(lines,"장소"),"한밭수영장")
        self.assertEqual(m.dates(m.value_after(lines,"대회일")),["2026-12-05","2026-12-06"])
    def test_seed_schema(self):
        import json
        src=Path(__file__).resolve().parents[1]/"data"/"swim"/"competitions.json"
        doc=json.loads(src.read_text(encoding="utf-8"))
        self.assertTrue(doc["competitions"])
        for item in doc["competitions"]:
            self.assertTrue(item["id"] and item["title"] and item["region"])
            self.assertIn(item["kind"],("masters","elite","student","other"))
            self.assertIn(item["free50"],(True,False,None))
            self.assertIn(item["free100"],(True,False,None))

if __name__=="__main__":
    unittest.main()
