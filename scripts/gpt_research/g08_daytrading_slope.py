"""G8 reuses G7 orchestration and the unchanged official engine."""
import argparse
from pathlib import Path
from g07_daytrading_min2 import run
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source-sha',required=True);p.add_argument('--out',required=True,type=Path)
    a=p.parse_args()
    run(a.source_sha,a.out,study='G8',candidate_name='vwap_slope_0.2',candidate_overrides={'min_vwap_slope':.20},prereg='ad857034')
