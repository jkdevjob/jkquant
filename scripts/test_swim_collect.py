"""수영대회 수집기 v2 시험 — 외부 접속 없이(고정 HTML · 가짜 수집처) 값으로 확인한다.

실행: python -m unittest discover -s scripts -p test_swim_collect.py -v
"""
import json
import os
import re
import shutil
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("SWIM_TODAY", "2026-11-03")

import collect_swim as m  # noqa: E402
import swim_alerts as A  # noqa: E402
import swim_regions as R  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


class FakeResp:
    def __init__(self, text, status=200):
        self.content = text.encode("utf-8") if isinstance(text, str) else text
        self.text = text if isinstance(text, str) else text.decode("utf-8", "replace")
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise IOError(f"HTTP {self.status_code}")


class FakeSession:
    def __init__(self, pages):
        self.pages, self.headers, self.calls = pages, {}, []

    def get(self, url, timeout=None):
        self.calls.append(url)
        if url.endswith("/robots.txt"):
            return FakeResp(self.pages.get(url, ""), 200 if url in self.pages else 404)
        for k, v in self.pages.items():
            if url == k:
                return FakeResp(v)
        return FakeResp("", 404)


def fetcher(pages):
    return m.Fetcher(session=FakeSession(pages), pause=0, tries=1)


KORSWIM_LIST = """<html><body><div class="s11-list">
<div class="s11-txt2"><a href="https://www.korswim.co.kr/11/355"><div class="s11-t2-flx"><div><strong>공지</strong>
<h2>제1회 오픈워터스위밍 전국 마스터즈 대회</h2><span>- 제주 서귀포시 동방파제</span></div><h3>대회기간 : 2026-11-29 ~ 2026-11-29</h3></div></a></div>
<div class="s11-txt2"><a href="https://www.korswim.co.kr/11/353"><div class="s11-t2-flx"><div><strong>공지</strong>
<h2>2027년 수영(오픈워터스위밍) 국가대표 및 청소년대표 선발대회</h2><span>- 제주 서귀포시 동방파제</span></div><h3>대회기간 : 2026-11-28 ~ 2026-11-28</h3></div></a></div>
<div class="s11-txt2"><a href="https://www.korswim.co.kr/11/347"><div class="s11-t2-flx"><div>
<h2>제4회 김천 전국 마스터즈 수영대회</h2><span>- 김천실내수영장</span></div><h3>대회기간 : 2026-08-29 ~ 2026-08-30</h3></div></a></div>
</div></body></html>"""
KORSWIM_DOWN = "<html><head><title>서버 이전 작업 안내 | 대한수영연맹</title></head><body>서버 이전 작업 중입니다</body></html>"
KORSWIM_DETAIL = """<html><head><title>제1회 오픈워터스위밍 전국 마스터즈 대회 > 대회일정 및 안내 | 대한수영연맹</title></head><body>
<div id="bo_v_con"><p>□ 대회개요</p><p>가. 대 회 명: 제1회 오픈워터스위밍 전국 마스터즈 대회</p><p>나. 대회기간: 2026. 11. 29.(일) / 1일간</p>
<p>다. 대회장소: 제주 서귀포시 동방파제</p><p>라. 대회종목: 오픈워터스위밍</p><p>마. 참가구분 및 참가대상: 5개 그룹(성인부 남자·여자) / 동호인</p>
<p>카. 주요사항</p><p>1) 신청기간은 2026년 10월 31일(토)부터 11월 13일(금) 18시까지</p></div>
<a href="https://www.korswim.co.kr/bbs/download.php?bo_table=11&wr_id=355&no=1">참가요강.hwp (1.8M) [127]</a></body></html>"""

SWIMCOKR = """<html><body><section class="cards">
<article class="swim-card"><div class="card-top"><span class="badge plan">접수예정</span><span class="region">대전</span></div>
<h3>제31회 온통행복한대전 전국마스터즈수영대회</h3><dl>
<div><dt>대회일</dt><dd>2026.12.05 ~ 2026.12.06</dd></div><div><dt>장소</dt><dd>한밭수영장</dd></div>
<div><dt>접수</dt><dd>2026.11.09 ~ 2026.11.16</dd></div><div><dt>대상</dt><dd>학생부 / 성인부 / 동호인 선수등록 완료자</dd></div>
<div><dt>종목</dt><dd>공식요강 확인</dd></div><div><dt>참가비</dt><dd>공식요강 확인</dd></div><div><dt>출처</dt><dd>대전광역시수영연맹 공식 공지</dd></div></dl>
<div class="card-actions"><a href="https://djswimming.or.kr/bizdemo38944/mp5/mp5_sub1.php?sub=01&amp;com_board_basic=read_form&amp;com_board_idx=164">공식요강 보기</a></div></article>
<article class="swim-card"><div class="card-top"><span class="badge soon">마감임박</span><span class="region">경상 부산</span></div>
<h3>제44회 교육감배 초·중학교 수영대회</h3><dl>
<div><dt>대회일</dt><dd>2026.11.21</dd></div><div><dt>장소</dt><dd>사직실내수영장</dd></div><div><dt>접수</dt><dd>2026.10.28 ~ 2026.11.06</dd></div>
<div><dt>대상</dt><dd>부산지역 소재 초등학생 등록·비등록 선수</dd></div>
<div><dt>종목</dt><dd>경영: 자유형·배영·평영·접영·개인혼영 / 다이빙: 1m 스프링보드</dd></div></dl></article>
</section></body></html>"""

WHOISFAST = """<html><body><ul class="meet-list">
<li class="meet upcoming"><div class="meet-date"><span class="d">2026.11.07</span><span class="d muted">~ 2026.11.08</span></div>
<div class="meet-body"><div class="meet-name"><span class="meet-title">경북연맹회장배</span><span class="badge upcoming">예정</span></div>
<div class="meet-meta muted">경북 김천시 · 김천실내수영장 · 50m 장수로 · 접수 마감 2026.10.11</div>
<div class="meet-links"><a href="https://gbaquatics.co.kr/pages/01_competition-info/01_schedule-guide?type=view&amp;id=5">요강</a></div></div></li>
<li class="meet upcoming"><div class="meet-date"><span class="d">2026.11.07</span></div>
<div class="meet-body"><div class="meet-name"><span class="meet-title">2026년 완주 수소도시배전국 마스터즈 수영대회</span></div>
<div class="meet-meta muted">전북 완주군 · 완주군 근로자 종합복지관 수영장 · 50m 장수로</div>
<div class="meet-links"><a href="https://cafe.naver.com/ArticleRead.nhn?clubid=1&amp;articleid=310">요강</a></div></div></li>
</ul></body></html>"""

KUA = ('<html><body><script>self.__next_f.push([1,"[{\\"id\\":11096,\\"category\\":\\"국내\\",\\"title\\":\\"제15회 대한체육회장배 전국생활체육핀수영대회\\",'
       '\\"location\\":\\"경기도 안산시 대부동 복지체육센터 수영장\\",\\"competitionPeriod\\":\\"2026-12-06 ~ 2026-12-06\\",'
       '\\"applicationPeriod\\":\\"2026-10-01 ~ 2026-10-22\\",\\"status\\":\\"신청전\\",\\"isTopFixed\\":false}]"])</script></body></html>')

BOARD_LIST = """<html><body><table>
<tr><td><a href="http://www.seoulswim.or.kr/bbs/board.php?bo_table=schedule&wr_id=369&page=1">2026 성북구체육회장배 수영대회 개최 알림</a></td></tr>
<tr><td><a href="http://www.seoulswim.or.kr/bbs/board.php?bo_table=schedule&wr_id=368">제6회 영등포구청장배 수영대회 결과 및 상장 수령 안내</a></td></tr>
<tr><td><a href="http://www.seoulswim.or.kr/bbs/board.php?bo_table=schedule&wr_id=367">제1회 강남구청장배 수영대회 개최 취소 안내</a></td></tr>
</table></body></html>"""
BOARD_369 = """<html><body><div id="bo_v_con"><p>1. 대회개요</p><p>1) 대 회 명: 2026 성북구 체육회장배 수영대회</p>
<p>2) 일    시: 2026. 11. 8.(일) 06:00~17:00, 개회식 09:00</p><p>3) 장    소: 성북레포츠센터 맑은물수영장(2층)</p>
<p>4) 경기종목: 자유형 50m, 100m / 배영 50m / 평영 50m</p><p>5) 참가비: 개인 20,000원 ※ 환불 불가</p></div></body></html>"""
BOARD_367 = """<html><body><div id="bo_v_con"><p>대회명 : 제1회 강남구청장배 수영대회</p><p>일시 : 2026년 11월 22일(일)</p><p>장소 : 강남스포츠문화센터</p>
<p>사정으로 대회를 취소합니다.</p></div></body></html>"""
# 제주특별자치도수영연맹(kjaq.kr) 실제 화면 형태 — 제목 앞 [도내대회] 꼬리표, 본문은 글자마다 span 으로 쪼개져 있다
KJAQ_LIST = """<html><body><ul class="list">
<li><a href="https://www.kjaq.kr/31/24"><span class="cate">[도내대회]</span>
<span class="subject">제39회 제주특별자치도수영연맹 회장배 전도 수영대회</span></a></li>
<li><a href="https://www.kjaq.kr/31/20"><span class="cate">[전국대회]</span>
<span class="subject">제20회 수애기배 전국 마스터즈 수영대회</span></a></li>
</ul><a href="https://www.kjaq.kr/32/7">2026 전국생활체육대축전 결과 안내</a></body></html>"""
KJAQ_24 = """<html><body><div id="bo_v_con"><p>[제39회 제주특별자치도수영연맹 회장배 전도 수영대회]</p>
<p><span>1.</span> <span>대 회 명</span> <span>:</span> <span>제</span><span>39</span><span>회 제주특별자치도수영연맹 회장배 전도 수영대회</span></p>
<p><span>2.</span> <span>일    시</span> <span>:</span> <span>2026</span><span>년 </span><span>11</span><span>월 </span><span>15</span><span>일</span><span>(</span><span>일</span><span>)</span></p>
<p><span>3.</span> <span>장    소</span> <span>:</span> <span>제주시 종합경기장 실내수영장</span></p>
<p><span>7.</span> <span>참가 신청방법</span></p>
<p><span>❑</span> <span>신청마감</span> <span>:</span> <span>2026</span><span>년 </span><span>11</span><span>월 </span><span>3</span><span>일</span><span>(</span><span>화</span><span>) 18:00</span><span>까지</span></p>
</div></body></html>"""



class DateTests(unittest.TestCase):
    def test_formats(self):
        self.assertEqual(m.parse_dates("2026. 8. 29.(토) - 8. 30.(일)"), ["2026-08-29", "2026-08-30"])
        self.assertEqual(m.parse_dates("2026년 10월 31일(토)부터 11월 13일(금) 18시까지"), ["2026-10-31", "2026-11-13"])
        self.assertEqual(m.parse_dates("2026 년 6 월 1 일 ( 월 ) 09;00~ 2026 년 6 월 2 일"), ["2026-06-01", "2026-06-02"])
        self.assertEqual(m.parse_dates("11월 28일 ~ 29일", 2026), ["2026-11-28", "2026-11-29"])
        self.assertEqual(m.parse_dates("2026.12.30 ~ 1.2"), ["2026-12-30", "2027-01-02"])
        self.assertEqual(m.parse_dates("2026. 11. 29.(일) / 1일간"), ["2026-11-29"])
        self.assertEqual(m.parse_dates("2.5km 바다 수영", 2026), [])
        self.assertEqual(m.parse_dates("2026.19.44"), [])

    def test_range_guard(self):
        self.assertEqual(m.date_range("2026. 12. 5(토) - 12. 6(일), 2일간"), ("2026-12-05", "2026-12-06"))
        self.assertEqual(m.date_range("2026.03.01 신청마감 2026.05.20"), ("2026-03-01", "2026-03-01"))


class RegionTests(unittest.TestCase):
    def test_nationwide(self):
        self.assertEqual(R.resolve("김천실내수영장"), ("경북", "김천시"))
        self.assertEqual(R.resolve("한들문화센터 수영장"), ("충남", "천안시"))
        self.assertEqual(R.resolve("경상 부산", "사직실내수영장"), ("부산", "동래구"))   # 글의 시·도 + 경기장 사전의 구
        self.assertEqual(R.resolve("제주 서귀포시 동방파제"), ("제주", "서귀포시"))
        self.assertEqual(R.resolve("2026 고양 전국 마스터즈 수영대회"), ("경기", "고양시"))
        self.assertEqual(R.resolve("경기도 광주시 · 광주시 G 스타디움 수영장"), ("경기", "광주시"))
        self.assertEqual(R.resolve("경기 광주시 오포읍 체육센터"), ("경기", "광주시"))
        self.assertEqual(R.resolve("광주시 남구 염주체육관"), ("광주", "남구"))
        self.assertEqual(R.resolve("부산 강서구"), ("부산", "강서구"))
        self.assertEqual(R.resolve("강서구 수영장"), ("", ""))              # 서울·부산 둘 다 — 확정하지 않는다

    def test_common_words_are_not_regions(self):
        self.assertEqual(R.resolve("경기종목 자유형"), ("", ""))
        self.assertEqual(R.resolve("50m 장수로"), ("", ""))
        self.assertEqual(R.resolve("허용인원 300명"), ("", ""))

    def test_all_17_sido(self):
        self.assertEqual(len(R.SIDO), 17)
        for sido in R.SIDO:
            self.assertIn(sido, R.SIGUNGU)

    def test_foreign_excluded(self):
        self.assertTrue(R.is_foreign("KANSAI MASTERS 2026", "오사카"))
        self.assertIsNone(m.make_obs("x", "secondary", "KANSAI MASTERS 2026", start="2026-12-01", venue="오사카 수영장"))


class ParserTests(unittest.TestCase):
    def test_korswim_list_and_detail(self):
        pages = {"https://www.korswim.co.kr/11": KORSWIM_LIST, "https://www.korswim.co.kr/11/355": KORSWIM_DETAIL}
        obs = m.scrape_korswim(fetcher(pages), {}, max_pages=1)
        lst = [o for o in obs if o["source"] == "korswim"]
        self.assertEqual(len(lst), 3)
        ow = next(o for o in lst if "마스터즈 대회" in o["title"])
        self.assertEqual((ow["start_date"], ow["sido"], ow["sigungu"], ow["tier"]), ("2026-11-29", "제주", "서귀포시", "official"))
        self.assertEqual(ow["sports"], ["오픈워터"])
        det = next(o for o in obs if o["source"] == "korswim_detail")
        self.assertEqual((det["apply_open"], det["apply_close"]), ("2026-10-31", "2026-11-13"))
        self.assertIn("동호인", det["eligibility"])

    def test_notice_events_must_be_events(self):
        lines = ["대 회 명 : 제2회 경상북도수영연맹 회장배 전국 마스터즈 수영대회", "기 간 : 2026. 11. 7. (토) ~ 11. 8. (일)",
                 "종목 : 개인별 참가 신청을 완료하여도 상기 메일로 단체전 참가신청을 하지 않으면 단체전 출전 불가"]
        self.assertEqual(m.notice_fields(lines, 2026)["events"], "")
        self.assertEqual(m.notice_fields(["일시 : 2026. 11. 7.", "경기종목 : 자유형 50m, 배영 50m"], 2026)["events"], "자유형 50m, 배영 50m")

    def test_robots_respected(self):
        pages = {"https://myranking.co.kr/robots.txt": "User-agent: Googlebot\nAllow: /\n\nUser-agent: *\nDisallow: /\n",
                 "https://myranking.co.kr/index.php?page=schedule": "<html>calendar</html>"}
        f = fetcher(pages)
        self.assertFalse(f.allowed("https://myranking.co.kr/index.php?page=schedule"))
        with self.assertRaises(m.RobotsDenied):
            f.get("https://myranking.co.kr/index.php?page=schedule")
        self.assertNotIn("https://myranking.co.kr/index.php?page=schedule", f.s.calls)    # 본문은 요청조차 하지 않는다
        self.assertTrue(fetcher({}).allowed("https://www.korswim.co.kr/11"))              # robots.txt 없음(404) = 허용

    def test_maintenance_page_is_failure_not_success(self):
        with self.assertRaises(m.StructureError):
            m.scrape_korswim(fetcher({"https://www.korswim.co.kr/11": KORSWIM_DOWN}), {}, max_pages=1)

    def test_swimming_co_kr(self):
        obs = m.scrape_swimming_co_kr(fetcher({"https://swimming.co.kr/": SWIMCOKR}), {})
        dj = obs[0]
        self.assertEqual((dj["start_date"], dj["end_date"], dj["apply_open"], dj["apply_close"]),
                         ("2026-12-05", "2026-12-06", "2026-11-09", "2026-11-16"))
        self.assertEqual((dj["sido"], dj["sigungu"]), ("대전", "중구"))
        self.assertTrue(dj["official_url"].startswith("https://djswimming.or.kr/"))
        self.assertEqual(dj["events"], "")                                  # '공식요강 확인'은 값이 아니다
        bs = obs[1]
        self.assertEqual(bs["sido"], "부산")                                # '경상 부산' 묶음 표기
        self.assertEqual(bs["sports"], ["다이빙", "경영"])

    def test_swimming_co_kr_structure_change(self):
        with self.assertRaises(m.StructureError):
            m.scrape_swimming_co_kr(fetcher({"https://swimming.co.kr/": "<div class='card'><h3>대회</h3></div>"}), {})
        broken = SWIMCOKR.replace("<dt>대회일</dt>", "<dt>일정</dt>")
        with self.assertRaises(m.StructureError):
            m.scrape_swimming_co_kr(fetcher({"https://swimming.co.kr/": broken}), {})

    def test_whoisfast_pool_length_ignored(self):
        obs = m.scrape_whoisfast(fetcher({"https://whoisfast.com/meets?year=2026": WHOISFAST}), {})
        gb = obs[0]
        self.assertEqual((gb["start_date"], gb["end_date"], gb["apply_close"]), ("2026-11-07", "2026-11-08", "2026-10-11"))
        self.assertEqual((gb["sido"], gb["sigungu"], gb["venue"]), ("경북", "김천시", "김천실내수영장"))
        self.assertEqual(gb["pool"], "")                                    # whoisfast 는 모든 대회를 '50m 장수로'로 표시
        self.assertTrue(gb["official_url"].startswith("https://gbaquatics.co.kr/"))
        self.assertEqual(obs[1]["official_url"], "")                         # 네이버 카페는 공식 공고가 아니다
        # 그래도 요강 링크는 버리지 않는다(2026-11-04 사용자: 전북도지사배 요강이 whoisfast 에 있는데 왜 없나)
        self.assertEqual(obs[1]["guide_url"], "https://cafe.naver.com/ArticleRead.nhn?clubid=1&articleid=310")
        self.assertEqual(obs[0]["guide_url"], "")                            # 공식 주소는 official_url 로만
        d = m.derive({"id": "x", "obs": {"whoisfast:1": obs[1]}})
        self.assertEqual(d["guide_links"][0]["host"], "cafe.naver.com")
        self.assertTrue(any("자동으로 읽지 못함" in w for w in d["warnings"]))

    def test_kua_embedded_json(self):
        obs = m.scrape_kua(fetcher({"https://www.kua.or.kr/competition-info/schedule": KUA}), {}, max_pages=1)
        self.assertEqual(len(obs), 1)
        o = obs[0]
        self.assertEqual((o["sido"], o["sigungu"], o["sports"], o["apply_close"]), ("경기", "안산시", ["핀수영"], "2026-10-22"))
        with self.assertRaises(m.StructureError):
            m.scrape_kua(fetcher({"https://www.kua.or.kr/competition-info/schedule": "<html>개편</html>"}), {}, max_pages=1)

    def test_board_notice_detail(self):
        cfg = m.BOARDS[0]
        pages = {cfg["url"]: BOARD_LIST,
                 "http://www.seoulswim.or.kr/bbs/board.php?bo_table=schedule&wr_id=369": BOARD_369,
                 "http://www.seoulswim.or.kr/bbs/board.php?bo_table=schedule&wr_id=367": BOARD_367}
        obs = m.scrape_board(fetcher(pages), {}, cfg)
        titles = [o["title"] for o in obs]
        self.assertEqual(len(obs), 2, titles)                               # 결과·상장 안내는 대회 공고가 아니다
        sb = next(o for o in obs if "성북" in o["title"])
        self.assertEqual((sb["start_date"], sb["sido"], sb["sigungu"]), ("2026-11-08", "서울", "성북구"))
        self.assertEqual(sb["sports"], ["경영"])
        self.assertTrue(sb["fee"].startswith("개인 20,000원"))
        gn = next(o for o in obs if "강남" in o["title"])
        self.assertEqual(gn["status"], "cancelled")


    def test_federation_boards_registered(self):
        """시·도 연맹 게시판을 추가하면 이름·우선순위·연맹 구분·공식 판정이 같이 따라와야 한다."""
        keys = [b["key"] for b in m.BOARDS]
        self.assertTrue({"jnsf", "gwswim", "kjaq"} <= set(keys), keys)       # 2026-11-06 전남·강원·제주 추가
        self.assertEqual(len(keys), len(set(keys)))
        for b in m.BOARDS:
            self.assertIn(b["key"], m.SOURCE_NAMES)
            self.assertIn(b["key"], m.SOURCE_ORDER)
            self.assertIn(b["key"], m.SWIM_FEDERATION_SOURCES)
            self.assertTrue(m.is_official_url(b["url"]), b["url"])
        self.assertTrue({"jnsf", "gwswim", "kjaq"} <= {k for k, *_ in m.SOURCES})

    def test_kjaq_board(self):
        cfg = next(b for b in m.BOARDS if b["key"] == "kjaq")
        pages = {cfg["url"]: KJAQ_LIST, "https://www.kjaq.kr/31/24": KJAQ_24}
        obs = m.scrape_board(fetcher(pages), {}, cfg)
        self.assertEqual(len(obs), 1, [o["title"] for o in obs])         # 본문을 못 읽은 글(31/20)은 만들어 내지 않는다
        o = obs[0]
        self.assertEqual(o["title"], "제39회 제주특별자치도수영연맹 회장배 전도 수영대회")
        self.assertEqual((o["start_date"], o["end_date"], o["apply_close"]), ("2026-11-15", "2026-11-15", "2026-11-03"))
        self.assertEqual((o["sido"], o["sigungu"]), ("제주", "제주시"))
        self.assertEqual((o["source"], o["tier"]), ("kjaq", "official"))
        self.assertEqual(o["url"], "https://www.kjaq.kr/31/24")


class SportTests(unittest.TestCase):
    def test_negated_discipline(self):
        sp, inferred = m.sports_for("제31회 대전 전국마스터즈수영대회", "기 간 : 2026. 12. 5(토) - 12. 6(일), 2일간 / 다이빙 미개최")
        self.assertEqual(sp, ["경영"])
        self.assertTrue(inferred)


class SameMeetTests(unittest.TestCase):
    def o(self, title, start, end=None, place="", venue="", **kw):
        return m.make_obs(kw.pop("src", "s"), kw.pop("tier", "secondary"), title, start=start, end=end or start, place=place, venue=venue, **kw)

    def test_aliases(self):
        pairs = [
            (self.o("부산시장배", "2026-05-03", place="부산광역시"), self.o("제5회 부산광역시장배 전국생활체육 수영대회", "2026-05-03", place="부산")),
            (self.o("수원연맹회장배", "2026-04-26", place="경기도 수원시"), self.o("2026 수원 연맹회장배 수영대회", "2026-04-26", place="경기 수원시")),
            (self.o("경북연맹회장배", "2026-11-07", "2026-11-08", venue="김천실내수영장"),
             self.o("제2회 경상북도수영연맹 회장배 전국 마스터즈 수영대회", "2026-11-07", "2026-11-08", venue="김천실내수영장")),
            (self.o("2026년 제16회 흥타령배전국마스터즈수영대회", "2026-11-28", "2026-11-29", venue="한들문화센터"),
             self.o("2026년 제16회 천안 흥타령 마스터즈 수영대회", "2026-11-29", place="충남 천안시")),
            (self.o("서울대축전선발전", "2026-03-08", place="서울시"), self.o("2026 전국생활체육대축전 서울시 대표 선발전 수영대회", "2026-03-08", place="서울")),
            (self.o("서울연맹회장배", "2026-06-27", place="서울시"), self.o("제12회 서울특별시연맹회장배 수영대회", "2026-06-27", place="서울")),
        ]
        for a, b in pairs:
            self.assertTrue(m.same_meet(a, b), (a["title"], b["title"]))

    def test_reschedule_same_year(self):
        a = self.o("제5회 양천구청장배 수영대회", "2026-11-15", place="서울 양천구")
        b = self.o("제5회 양천구청장배 수영대회", "2026-12-06", place="서울 양천구")
        self.assertTrue(m.same_meet(a, b))
        b2 = self.o("제6회 양천구청장배 수영대회", "2027-11-14", place="서울 양천구")
        self.assertFalse(m.same_meet(a, b2))

    def test_distinct_meets(self):
        cases = [
            (self.o("제1회 오픈워터스위밍 전국 마스터즈 대회", "2026-11-29", venue="제주 서귀포시 동방파제"),
             self.o("2027년 수영(오픈워터스위밍) 국가대표 및 청소년대표 선발대회", "2026-11-28", venue="제주 서귀포시 동방파제")),
            (self.o("2027년 수영(다이빙) 국가대표 선발대회", "2026-11-12", "2026-11-14", venue="김천실내수영장"),
             self.o("2027년 수영(수구) 국가대표 및 국가대표 후보선수 선발대회", "2026-11-12", "2026-11-14", venue="김천실내수영장")),
            (self.o("제15회 오산시장기 종목별 체육대회 수영경기", "2026-04-04", place="경기 오산시"),
             self.o("제2회 오산시장배 수영대회", "2026-04-04", place="경기 오산시")),
            (self.o("2026 수원 연맹회장배 수영대회", "2026-04-26", place="경기 수원시"),
             self.o("2026년 군포시장배 수영대회", "2026-04-26", place="경기 군포시")),
            (self.o("2026 안산시장배 수영대회", "2026-09-19", place="경기 안산시"), self.o("이천시장배", "2026-09-19", place="경기도 이천시")),
        ]
        for a, b in cases:
            self.assertFalse(m.same_meet(a, b), (a["title"], b["title"]))


class MergeRuleTests(unittest.TestCase):
    """2026-11-03 Actions 첫 수집에서 나온 실제 사례."""

    def rec(self, *obs):
        return {"id": "x", "obs": {f"{o['source']}:{i}": o for i, o in enumerate(obs)}}

    def test_official_sports_win(self):
        # 수구 선수권: 2차 자료가 종목을 '자유형/배영/평영/접영'으로 적었지만 공식은 수구
        k = m.make_obs("korswim", "official", "제14회 회장배 전국 종별 수구 선수권대회", start="2026-06-10", venue="김천실내수영장")
        sc = m.make_obs("swimming_co_kr", "secondary", "제14회 회장배 전국 종별 수구 선수권대회", start="2026-06-10",
                        venue="김천실내수영장", events="자유형 / 배영 / 평영 / 접영")
        d = m.derive(self.rec(k, sc))
        self.assertEqual(d["sports"], ["수구"])

    def test_body_rules_are_not_sports(self):
        # 부산 교육감배 원문의 '비등록선수 … 핀수영, 수구, 아티스틱스위밍 종목 포함'은 종목이 아니다
        body = "비등록선수는 대한수영연맹에 등록한 사실이 없어야한다. 핀수영, 근대3종, 수구, 아티스틱스위밍 종목 포함"
        ol = m.make_obs("official_link", "official", "제44회 교육감배 초·중학교 수영대회", start="2026-11-21",
                        venue="사직실내수영장", extra_text=body)
        self.assertTrue(ol["sports_inferred"])
        sc = m.make_obs("swimming_co_kr", "secondary", "제44회 교육감배 초·중학교 수영대회", start="2026-11-21",
                        venue="사직실내수영장", events="경영: 자유형·배영·평영·접영 / 다이빙: 1m 스프링보드")
        d = m.derive(self.rec(ol, sc))
        self.assertEqual(d["sports"], ["다이빙", "경영"])

    def test_federations_not_merged_and_split(self):
        kua = m.make_obs("kua", "official", "2024 전국생활체육 대축전", start="2024-04-20", place="경상북도 김천시", sport_force="핀수영")
        ks = m.make_obs("korswim", "official", "2024 전국생활체육대축전", start="2024-04-27", end="2024-04-28", venue="김천실내수영장")
        sc = m.make_obs("swimming_co_kr", "secondary", "2024 전국생활체육 대축전", start="2024-04-20", place="경북 김천시")
        self.assertEqual((ks["sports"], ks["sports_inferred"]), (["경영"], True))   # 수영연맹 일정 — 종목 낱말 없으면 경영(추정)
        self.assertFalse(m.same_meet(kua, ks))
        self.assertTrue(m.same_meet(kua, sc))
        records = {"r1": {"id": "r1", "obs": {"kua:1": kua, "korswim:1": ks, "swimming_co_kr:1": sc}, "first_seen": "2026-11-03"}}
        records["r1"]["derived"] = m.derive(records["r1"])
        moved = m.split_federations(records)
        self.assertEqual(len(moved), 1)
        self.assertEqual(len(records), 2)
        r1 = records["r1"]
        self.assertEqual(set(o["source"] for o in r1["obs"].values()), {"korswim"})
        self.assertEqual(r1["derived"]["start_date"], "2024-04-27")
        other = records[moved[0][1]]
        self.assertEqual(set(o["source"] for o in other["obs"].values()), {"kua", "swimming_co_kr"})
        self.assertEqual(other["derived"]["start_date"], "2024-04-20")
        self.assertEqual(m.collapse_duplicates(records), {})                 # 다시 합치지 않는다


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        m.DATA_DIR = self.tmp
        m.CACHE_FILE = self.tmp / "cache" / "cache.json"
        A.DATA_DIR = self.tmp
        self.v1 = {"competitions": [
            {"title": "마이랭킹에만 있는 대회", "source": "마이랭킹 전국 대회 일정", "start_date": "2026-12-01", "venue": "x"},
            {"title": "2026 고양 전국 마스터즈 수영대회", "source": "전국 수영대회 통합 목록", "start_date": "2026-05-30",
             "end_date": "2026-05-31", "venue": "고양체육관 수영장", "source_url": "https://swimming.co.kr/"}]}
        (self.tmp / "competitions.json").write_text(json.dumps(self.v1, ensure_ascii=False), encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        os.environ["SWIM_TODAY"] = "2026-11-03"

    def run_with(self, batches):
        srcs = []
        for key, val in batches.items():
            def fn(f, st, val=val):
                if isinstance(val, Exception):
                    raise val
                return [m.make_obs(key, "official" if key == "korswim" else "secondary", **x) for x in val]
            srcs.append((key, "official" if key == "korswim" else "secondary", "https://example/" + key, fn))
        return m.refresh(fetcher=m.Fetcher(session=FakeSession({}), pause=0, tries=1), sources=srcs,
                         do_search=False, do_confirm=False)

    def load(self, name):
        return json.loads((self.tmp / name).read_text(encoding="utf-8"))

    def test_lifecycle(self):
        meet = dict(title="제5회 양천구청장배 수영대회", start="2026-11-15", place="서울 양천구", apply_close="2026-11-05")
        # ① v1 → v2 전환: 마이랭킹 출처 제외 · 기준선(가짜 신규 없음)
        s = self.run_with({"swimming_co_kr": [meet]})
        doc = self.load("competitions.json")
        titles = [c["title"] for c in doc["competitions"]]
        self.assertNotIn("마이랭킹에만 있는 대회", titles)
        self.assertIn("2026 고양 전국 마스터즈 수영대회", titles)          # 종료 대회도 이력으로 보존
        self.assertEqual(s["new"], 0)
        self.assertEqual(doc["schema_version"], 2)
        self.assertTrue(any(c["type"] == "migration" for c in self.load("changes.json")["changes"]))
        rid = next(c["id"] for c in doc["competitions"] if "양천" in c["title"])
        # ② 같은 자료 다시 → 파일 그대로(중복 저장 없음)
        before = (self.tmp / "competitions.json").read_bytes()
        self.run_with({"swimming_co_kr": [meet]})
        self.assertEqual(before, (self.tmp / "competitions.json").read_bytes())
        # ③ 다른 이름 표기 + 일정 변경 → 같은 대회로 묶고 변경 기록
        os.environ["SWIM_TODAY"] = "2026-11-04"
        moved = dict(meet, title="2026년 제5회 양천구청장배 수영대회", start="2026-12-06")
        s = self.run_with({"swimming_co_kr": [moved]})
        doc = self.load("competitions.json")
        yc = [c for c in doc["competitions"] if "양천" in c["title"]]
        self.assertEqual(len(yc), 1)
        self.assertEqual(yc[0]["id"], rid)
        self.assertEqual(yc[0]["start_date"], "2026-12-06")
        self.assertEqual(yc[0]["last_changed"], "2026-11-04")
        ch = [c for c in self.load("changes.json")["changes"] if c.get("id") == rid]
        self.assertEqual(ch[-1]["fields"]["start_date"], ["2026-11-15", "2026-12-06"])
        self.assertEqual(s["changed"], 1)
        # ④ 수집처 실패 → 기존 대회 유지 · 상태에 실패 기록 · 마지막 성공 시각 유지
        before = (self.tmp / "competitions.json").read_bytes()
        s = self.run_with({"swimming_co_kr": IOError("connection reset"), "whoisfast": [dict(title="새 대회", start="2026-12-20", place="부산")]})
        st = self.load("sources.json")
        sc = next(x for x in st["sources"] if x["key"] == "swimming_co_kr")
        self.assertEqual(sc["status"], "failed")
        self.assertTrue(sc["last_success"])
        doc = self.load("competitions.json")
        self.assertTrue(any("양천" in c["title"] for c in doc["competitions"]))
        # ⑤ 전부 실패 → 대회 자료는 건드리지 않는다
        before = (self.tmp / "competitions.json").read_bytes()
        s = self.run_with({"swimming_co_kr": m.StructureError("카드 없음"), "whoisfast": IOError("x")})
        self.assertEqual(s["ok_sources"], 0)
        self.assertEqual(before, (self.tmp / "competitions.json").read_bytes())
        self.assertIn("구조 변경 의심", next(x for x in self.load("sources.json")["sources"] if x["key"] == "swimming_co_kr")["error"])

    def test_related_search_links_attached(self):
        (self.tmp / "leads.json").write_text(json.dumps({"leads": [
            {"url": "https://blog.naver.com/x/1", "title": "[대회정보] 2026 전북특별자치도지사배 마스터즈 수영대회", "host": "blog.naver.com",
             "first_seen": "2026-11-03", "official_host": False},
            {"url": "https://other.example/2", "title": "2026 다른 수영대회", "host": "other.example", "first_seen": "2026-11-03"}]},
            ensure_ascii=False), encoding="utf-8")
        self.run_with({"whoisfast": [dict(title="2026년 전북특별자치도지사배 마스터즈수영대회", start="2026-11-22", place="전북 전주시")]})
        c = next(x for x in self.load("competitions.json")["competitions"] if "전북" in x["title"])
        self.assertEqual([r["url"] for r in c["related"]], ["https://blog.naver.com/x/1"])

    def test_official_overrides_secondary_and_cancel(self):
        self.run_with({"swimming_co_kr": [dict(title="제1회 강남구청장배 수영대회", start="2026-11-22", place="서울 강남구")]})
        os.environ["SWIM_TODAY"] = "2026-11-04"
        self.run_with({"swimming_co_kr": [dict(title="제1회 강남구청장배 수영대회", start="2026-11-22", place="서울 강남구")],
                       "korswim": [dict(title="제1회 강남구청장배 수영대회 개최 취소 안내", start="2026-11-22", place="서울 강남구")]})
        doc = self.load("competitions.json")
        c = next(x for x in doc["competitions"] if "강남구청장배" in x["title"])
        self.assertEqual(c["verification"], "official")
        self.assertEqual(c["status"], "cancelled")
        self.assertEqual(c["title"], "제1회 강남구청장배 수영대회")


class AlertTests(unittest.TestCase):
    def comp(self, **kw):
        base = {"id": "abc123def456", "title": "제31회 대전 마스터즈", "region": "대전 중구", "venue": "한밭수영장",
                "start_date": "2026-12-05", "end_date": "2026-12-06", "apply_open": "2026-11-09", "apply_close": "2026-11-16",
                "status": "scheduled", "first_seen": "2026-11-01"}
        base.update(kw)
        return base

    def test_baseline_then_changes_once(self):
        from datetime import date
        t = date(2026, 11, 3)
        _, known = A.events([self.comp()], {}, t)
        state = {"known": known, "sent": {}}
        self.assertEqual(A.events([self.comp()], state, t)[0], [])                       # 바뀐 것 없음
        ev, known2 = A.events([self.comp(start_date="2026-12-12", end_date="2026-12-13")], state, t)
        self.assertEqual([e["kind"] for e in ev], ["date"])
        self.assertTrue(ev[0]["url"].endswith("/swim?id=abc123def456"))
        state2 = {"known": known2, "sent": {e["key"]: "2026-11-03" for e in ev}}
        self.assertEqual(A.events([self.comp(start_date="2026-12-12", end_date="2026-12-13")], state2, t)[0], [])
        # 이전 기록(known)이 그대로여도 이미 보낸 열쇠면 다시 보내지 않는다(전송 뒤 기록 저장이 늦은 경우)
        resent = {"known": known, "sent": {e["key"]: "2026-11-03" for e in ev}}
        self.assertEqual(A.events([self.comp(start_date="2026-12-12", end_date="2026-12-13")], resent, t)[0], [])
        ev, _ = A.events([self.comp(status="cancelled")], state, t)
        self.assertIn("status", [e["kind"] for e in ev])
        ev, _ = A.events([self.comp(apply_close="2026-11-20")], state, t)
        self.assertIn("apply", [e["kind"] for e in ev])
        ev, _ = A.events([self.comp(venue="용운국제수영장")], state, t)
        self.assertIn("venue", [e["kind"] for e in ev])

    def test_new_open_deadline(self):
        from datetime import date
        state = {"known": {}, "sent": {}}
        ev, _ = A.events([self.comp(id="aaaaaaaaaaaa", first_seen="2026-11-03")], {"known": {"x": {}}, "sent": {}}, date(2026, 11, 3))
        self.assertEqual([e["kind"] for e in ev], ["new"])
        _, known = A.events([self.comp()], state, date(2026, 11, 9))
        ev, _ = A.events([self.comp()], {"known": known, "sent": {}}, date(2026, 11, 9))
        self.assertEqual([e["kind"] for e in ev], ["apply_start"])
        ev, _ = A.events([self.comp()], {"known": known, "sent": {}}, date(2026, 11, 14))
        self.assertEqual([e["kind"] for e in ev], ["deadline"])
        sent = {e["key"]: "2026-11-14" for e in ev}
        self.assertEqual(A.events([self.comp()], {"known": known, "sent": sent}, date(2026, 11, 15))[0], [])  # 다음 날 또 보내지 않음
        ev, _ = A.events([self.comp(end_date="2026-11-01", start_date="2026-11-01")], {"known": {}, "sent": {}}, date(2026, 11, 3))
        self.assertEqual(ev, [])                                                          # 끝난 대회는 알리지 않는다

    def test_run_baseline_does_not_send(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            A.DATA_DIR = tmp
            (tmp / "competitions.json").write_text(json.dumps({"competitions": [self.comp()]}), encoding="utf-8")
            os.environ["SWIM_TODAY"] = "2026-11-14"
            self.assertEqual(A.run(dry=False), 0)                                         # 기준선 — 전송 시도 없음
            st = json.loads((tmp / "alerts.json").read_text(encoding="utf-8"))
            self.assertIn("deadline:abc123def456:2026-11-16", st["sent"])
            self.assertEqual(A.run(dry=True), 0)
        finally:
            os.environ["SWIM_TODAY"] = "2026-11-03"
            shutil.rmtree(tmp, ignore_errors=True)

    def test_message_links(self):
        msg = A.message([{"kind": "new", "title": "<대회>", "text": "12/5 대전", "url": "https://jkquant.pages.dev/swim?id=abc123def456"}])
        self.assertTrue(msg.startswith("<b>[수영대회]"))
        self.assertIn("&lt;대회&gt;", msg)
        self.assertEqual(set(re.findall(r'href="([^"]+)"', msg)), {"https://jkquant.pages.dev/swim?id=abc123def456", "https://jkquant.pages.dev/swim"})


class PublishedDataTests(unittest.TestCase):
    """저장소에 올라간 자료 자체를 검사한다(수집 결과가 화면 계약을 지키는지)."""

    def test_schema(self):
        doc = json.loads((ROOT / "data" / "swim" / "competitions.json").read_text(encoding="utf-8"))
        self.assertEqual(doc["schema_version"], 2)
        comps = doc["competitions"]
        self.assertGreater(len(comps), 50)
        ids = [c["id"] for c in comps]
        self.assertEqual(len(ids), len(set(ids)))
        for c in comps:
            self.assertTrue(c["title"] and re.match(r"^\d{4}-\d{2}-\d{2}$", c["start_date"]), c)
            self.assertLessEqual(c["start_date"], c["end_date"])
            self.assertIn(c["sido"], R.SIDO + ("",))
            if c["sigungu"]:
                self.assertIn(c["sigungu"], R.SIGUNGU[c["sido"]])
            self.assertIn(c["kind"], ("masters", "elite", "student", "other"))
            self.assertIn(c["verification"], ("official", "secondary", "unverified"))
            self.assertNotIn("free50", c)                                   # 자유형 50·100 기능 삭제(2026-11-04 사용자)
            self.assertIn(c["status"], ("scheduled", "cancelled", "postponed"))
            if c["apply_open"] and c["apply_close"]:
                self.assertLessEqual(c["apply_open"], c["apply_close"])
            for s in c["sources"]:
                self.assertNotIn("myranking", s["url"])                     # robots.txt 수집 금지 사이트
            if c["verification"] == "official":
                self.assertTrue(any(s["tier"] == "official" for s in c["sources"]))

    def test_sources_status(self):
        st = json.loads((ROOT / "data" / "swim" / "sources.json").read_text(encoding="utf-8"))
        keys = {s["key"] for s in st["sources"]}
        self.assertTrue({"korswim", "kua", "swimming_co_kr", "whoisfast"} <= keys)
        for s in st["sources"]:
            self.assertIn(s["status"], ("ok", "failed", "blocked"))
            if s["status"] != "ok":
                self.assertTrue(s["error"])


if __name__ == "__main__":
    unittest.main()
