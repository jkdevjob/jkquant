"""텐배거(클로드) 예측 모형 — numpy 로지스틱 회귀(L2). 외부 학습 라이브러리 없이 재현된다.

입력 특징은 '그 달 투자 가능 종목 안의 백분위'(시대가 달라도 같은 눈금)와 시장 낙폭이다.
학습은 앞 시기, 평가는 뒤 시기에만 한다(시간 분할) — 뒤 시기 성적만 실제 예측력으로 본다.
"""
import numpy as np


def fit_logit(X, y, l2=1.0, iters=50, tol=1e-8):
    n, k = X.shape
    Xb = np.hstack([np.ones((n, 1)), X])
    w = np.zeros(k + 1)
    pen = np.full(k + 1, l2)
    pen[0] = 0.0
    for _ in range(iters):
        z = Xb @ w
        p = 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))
        g = Xb.T @ (p - y) + pen * w
        Wd = p * (1 - p)
        H = (Xb * Wd[:, None]).T @ Xb + np.diag(pen)
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < tol:
            break
    return w


def predict(w, X):
    z = w[0] + X @ w[1:]
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))


def auc(y, s):
    """순위 기반 AUC(동점은 평균 순위)."""
    y = np.asarray(y).astype(bool)
    order = np.argsort(s, kind='mergesort')
    ranks = np.empty(len(s))
    ss = np.asarray(s)[order]
    i = 0
    r = np.arange(1, len(s) + 1, dtype=float)
    while i < len(ss):
        j = i
        while j + 1 < len(ss) and ss[j + 1] == ss[i]:
            j += 1
        r[i:j + 1] = (i + j + 2) / 2.0
        i = j + 1
    ranks[order] = r
    n1 = y.sum()
    n0 = len(y) - n1
    if n1 == 0 or n0 == 0:
        return float('nan')
    return float((ranks[y].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))
