"""설정 로더 + 점(.) 경로로 중첩 키를 읽고 쓰는 유틸.

최적화기가 'filters.gap.min_pct' 같은 경로로 파라미터를 바꿔 끼우므로
설정을 평범한 dict 로 다루되 경로 접근 헬퍼를 제공한다.
"""
from __future__ import annotations
import copy
import yaml
from pathlib import Path


def load_config(path: str | Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def deep_copy(cfg: dict) -> dict:
    return copy.deepcopy(cfg)


def get_path(cfg: dict, dotted: str):
    node = cfg
    for key in dotted.split("."):
        node = node[key]
    return node


def set_path(cfg: dict, dotted: str, value) -> None:
    keys = dotted.split(".")
    node = cfg
    for key in keys[:-1]:
        node = node[key]
    node[keys[-1]] = value


def with_overrides(cfg: dict, overrides: dict) -> dict:
    """overrides = {'filters.gap.min_pct': 3.0, ...} 를 적용한 복사본을 돌려준다."""
    out = deep_copy(cfg)
    for dotted, value in overrides.items():
        set_path(out, dotted, value)
    return out
