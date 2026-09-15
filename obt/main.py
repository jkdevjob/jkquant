"""시초가 단타 백테스트 — CLI 진입점.

사용:
    python main.py sampledata           # 합성 샘플 분봉 생성(기능 검증용, 가짜 데이터)
    python main.py backtest             # 단일 백테스트
    python main.py optimize             # 파라미터 그리드 최적화
    python main.py report               # 품질검사+백테스트+그래프+기간별 요약
    python main.py validate             # Train/Validation/Test (과최적화 점검)

옵션:
    --config PATH   설정 파일 (기본: config/strategy.yaml)
    --days N        sampledata 생성 거래일 수
"""
from __future__ import annotations
import argparse
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)   # obt/ 를 import 경로에 추가 → 절대 import 동작

from config_loader import load_config          # noqa: E402


def _cfg(args):
    return load_config(os.path.join(BASE_DIR, args.config))


def cmd_sampledata(args):
    from data_io import sample_data
    cfg = _cfg(args)
    out = os.path.join(BASE_DIR, cfg["data"]["minute_dir"])
    paths = sample_data.generate(out, days=args.days)
    print(f"합성 샘플 데이터 생성(⚠️ 가짜 데이터, 기능검증용) → {len(paths)}개 종목")
    for p in paths:
        print("  " + p)


def cmd_backtest(args):
    from data_io import loader, quality
    from backtest.engine import BacktestEngine
    from backtest import metrics as M
    from reporting.report import save_outputs
    cfg = _cfg(args)
    market = loader.load_from_csv(cfg["data"]["minute_dir"], cfg["data"]["minute_glob"],
                                  cfg["data"]["daily_file"], base_dir=BASE_DIR)
    quality.print_report(market)
    res = BacktestEngine(cfg, market).run()
    print("\n" + M.format_report(res.metrics))
    paths = save_outputs(res, cfg, base_dir=BASE_DIR)
    print(f"\nCSV: {paths['trades']}\n     {paths['daily']}\n     {paths['metrics']}")


def cmd_optimize(args):
    from data_io import loader
    from optimization.optimizer import optimize
    cfg = _cfg(args)
    market = loader.load_from_csv(cfg["data"]["minute_dir"], cfg["data"]["minute_glob"],
                                  cfg["data"]["daily_file"], base_dir=BASE_DIR)
    df = optimize(cfg, market, base_dir=BASE_DIR)
    print("\n상위 10개 조합:")
    with_cols = [c for c in df.columns if c != "_obj"]
    print(df[with_cols].head(10).to_string(index=False))


def cmd_report(args):
    from reporting.report import run_report
    cfg = _cfg(args)
    run_report(cfg, base_dir=BASE_DIR, make_plots=True)


def cmd_validate(args):
    from data_io import loader
    from optimization import walkforward
    cfg = _cfg(args)
    market = loader.load_from_csv(cfg["data"]["minute_dir"], cfg["data"]["minute_glob"],
                                  cfg["data"]["daily_file"], base_dir=BASE_DIR)
    r = walkforward.run(cfg, market, base_dir=BASE_DIR)
    walkforward.print_result(r)


def build_parser():
    p = argparse.ArgumentParser(description="시초가 단타 백테스트")
    p.add_argument("--config", default="config/strategy.yaml")
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("sampledata").add_argument("--days", type=int, default=260 * 3)
    sub.add_parser("backtest")
    sub.add_parser("optimize")
    sub.add_parser("report")
    sub.add_parser("validate")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    {
        "sampledata": cmd_sampledata,
        "backtest": cmd_backtest,
        "optimize": cmd_optimize,
        "report": cmd_report,
        "validate": cmd_validate,
    }[args.command](args)


if __name__ == "__main__":
    main()
