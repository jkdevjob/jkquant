"""텐배거(클로드) 매수 후보 점수 — 30년 분석(analyze.py)과 전향 시험(forward.py)이 같이 쓴다.

같은 걸 두 군데서 세지 않는다: 특징 표(frame_at) · 순위 특징(model_cols) · 매수 후보 범위(buy_universe) ·
그날 점수와 순서(score_day)를 여기 한 곳에만 둔다.

순위 기준(백테와 같다): 그날 '살 수 있는 종목 전체(inv)' 안에서 특징별 백분위를 매긴다.
점수 순서는 매수 후보 범위(M0) 종목만, 점수 높은 순(같으면 종목코드 순)이다.
"""
import numpy as np
import pandas as pd

from model import predict

RANK_FEATS = ['lcap', 'lraw', 'lA20', 'dd3', 'ret20', 'ret60', 'ret250', 'pos52', 'low52', 'vol60',
              'turn', 'surge', 'ma200p', 'ma200s', 'age']
AGE_MIN = 60                 # 상장(재상장) 뒤 60거래일이 지나야 매수 후보
EXCLUDE_DEPT = (1, 2)        # 관리종목 · 투자주의환기종목


def index_on(dates, rows):
    s = pd.Series({d: v for d, v in rows})
    s.index = pd.to_datetime(s.index)
    return s.reindex(pd.to_datetime(dates)).ffill().values.astype(float)


def drawdown(x, w=250):
    hi = pd.Series(x).rolling(w, min_periods=20).max().values
    return x / hi - 1


def buy_universe(D):
    """매수 후보 범위 M0 = 그날 살 수 있음(inv) · 관리·환기 아님 · 상장 60거래일 이상."""
    return D['inv'] & ~np.isin(D['dept'], EXCLUDE_DEPT) & (np.nan_to_num(D['age']) >= AGE_MIN)


# ── 특징 표(한 날짜) ─────────────────────────────────────────────
def frame_at(s, D, js, extra):
    C = D['C']
    d = {'s': np.full(len(js), s), 'j': js}
    for k in ('cap', 'raw', 'A20', 'A250', 'vol60', 'hi250', 'lo250', 'hi750', 'ma200', 'ret20', 'ret60', 'ret120',
              'ret250', 'age', 'mkt', 'dept'):
        d[k] = D[k][s, js]
    d['c'] = C[s, js]
    d['ma200_20'] = D['ma200'][max(0, s - 20), js]
    for k, v in extra.items():
        d[k] = np.full(len(js), v[s])
    X = pd.DataFrame(d)
    X['pos52'] = X['c'] / X['hi250']
    X['low52'] = X['c'] / X['lo250']
    X['dd3'] = X['c'] / X['hi750'] - 1
    X['turn'] = X['A20'] / X['cap']
    X['surge'] = X['A20'] / X['A250']
    X['ma200p'] = X['c'] / X['ma200']
    X['ma200s'] = X['ma200'] / X['ma200_20'] - 1
    X['lcap'] = np.log(X['cap'])
    X['lraw'] = np.log(X['raw'])
    X['lA20'] = np.log(X['A20'])
    return X


def model_cols(X):
    for c in RANK_FEATS:
        X[c + '_r'] = X.groupby('s')[c].rank(pct=True).fillna(0.5)
        X[c + '_r2'] = (X[c + '_r'] - 0.5) ** 2
    X['kosdaq'] = (X['mkt'] == 2).astype(float)
    X['kan'] = X['dept'].isin([1, 2]).astype(float)
    X['kddn'] = -X['kdd'].fillna(0)
    X['qddn'] = -X['qdd'].fillna(0)
    return [c + '_r' for c in RANK_FEATS] + [c + '_r2' for c in RANK_FEATS] + ['kosdaq', 'kan', 'kddn', 'qddn']


def score_day(D, s, M0, model, kdd, qdd, codes):
    """s 일 종가까지의 자료로 매긴 점수 — M0 종목만, 점수 높은 순(같으면 코드 순).
    model: {'cols','mu','sd','w'}. 반환 표의 'score' = 3년 안 3배 추정 확률."""
    js = np.flatnonzero(D['inv'][s])
    X = frame_at(s, D, js, {'kdd': kdd, 'qdd': qdd})
    cols = model_cols(X)
    if list(cols) != list(model['cols']):
        raise ValueError('모형 특징 목록이 다르다')
    mu = np.asarray(model['mu'], dtype=float)
    sd = np.asarray(model['sd'], dtype=float)
    X['score'] = predict(np.asarray(model['w'], dtype=float), (X[cols].to_numpy(dtype=float) - mu) / sd)
    X = X[M0[s, X['j'].to_numpy()]].copy()
    X['code'] = np.asarray(codes)[X['j'].to_numpy()]
    order = np.lexsort((X['code'].to_numpy(), -X['score'].to_numpy()))
    return X.iloc[order].reset_index(drop=True)
