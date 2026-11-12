"""Closing research metrics over original signal ledgers, with three fixed cash slots.

No signal discovery, price reconstruction or order path. Missing observations stay missing.
"""
import statistics
import datetime as dt
from nightly_scalping_research import (CLOSING_SHADOW_NAMES,evolve_lifecycle,shadow_score,ranking_rule)

KINDS={'closing30':'day','closing_bet':'overnight'}

def condition_analysis(rows):
    def bucket(value,cuts):
        if not isinstance(value,(int,float)):return 'missing'
        return next((label for upper,label in cuts if value<upper),'high')
    groups={}
    for x in rows:
        signal=x.get('signal') or {}
        tags={'version':x.get('strategyVersion') or 'missing',
            'gap':bucket(signal.get('gapPct'),[(0,'negative'),(3,'0_to_3')]),
            'move':bucket(signal.get('intradayPct'),[(-3,'below_minus3'),(-1,'minus3_to_minus1'),(0,'minus1_to_0')]),
            'volume':bucket(signal.get('volumeRatio'),[(1,'below1'),(1.5,'1_to_1_5')])}
        for axis,label in tags.items():groups.setdefault(axis+':'+label,[]).append(x)
    result=[]
    for name,xs in sorted(groups.items()):
        closed=[x for x in xs if x['state']=='closed'];pn=[x['pnl'] for x in closed]
        wins=[p for p in pn if p>0];losses=[p for p in pn if p<0]
        result.append({'condition':name,'signals':len(xs),'closed':len(closed),'unsettled':len(xs)-len(closed),
            'winRate':100*len(wins)/len(pn) if pn else None,'expectancyPct':statistics.mean(pn) if pn else None,
            'avgWin':statistics.mean(wins) if wins else None,'avgLoss':statistics.mean(losses) if losses else None})
    outcomes=[(x.get('outcomes') or {}).get('signal') for x in rows]
    horizons={str(m):{'observed':sum(isinstance((o.get('horizons') or {}).get(str(m),{}).get('returnPct'),(int,float)) for o in outcomes if o),
        'missing':sum(not o or (o.get('horizons') or {}).get(str(m),{}).get('returnPct') is None for o in outcomes)} for m in (5,10,20,30)}
    return {'groups':result,'horizonCoverage':horizons,'rule':'original signal/version/conditions; trade statistics, not account returns; missing stays missing'}

def coverage(ledger,kind):
    scans=ledger.get('scans') or []
    def good(hm):
        return any(x.get('targetHm')==hm and not x.get('partial') and not x.get('failed')
                   and not x.get('quoteErrors') for x in scans)
    return good(1506 if kind=='day' else 1522) and good(1540)

def daily_rows(rows,ledgers,kind,name=None):
    out=[]
    for ledger in sorted(ledgers,key=lambda x:x['date']):
        date=ledger['date']
        variant=name or (ledger.get('paperMainVariants') or {}).get(kind,'baseline')
        xs=[x for x in rows if x['date']==date and x['kind']==kind and x['variant']==variant]
        if not coverage(ledger,kind) or any(x['state']!='closed' for x in xs):continue
        # Unobserved future candidates cannot receive synthetic no-trade days.
        observed=variant=='baseline' or any(x.get('kind')==kind and any(v.get('id')==variant for v in x.get('variants') or [])
            for x in ledger.get('scans') or []) or bool(xs)
        if not observed:continue
        out.append({'date':date,'returnPct':sum(x['pnl'] for x in xs)/3,'trades':len(xs),
                    'mainVariant':variant,'source':'closing30-paper-live','finalized':True})
    return out

def summarize(rows,daily,stress=0):
    closed=[x for x in rows if x.get('state')=='closed' and isinstance(x.get('pnl'),(int,float))]
    values=[x['pnl']-stress for x in closed]
    equity=peak=1.;mdd=0.
    returns=[x['returnPct']-stress*x['trades']/3 for x in daily]
    for ret in returns:
        equity*=max(0,1+ret/100);peak=max(peak,equity);mdd=min(mdd,(equity/peak-1)*100)
    gains=sum(x for x in values if x>0);loss=-sum(x for x in values if x<0)
    streak=0
    for day,ret in zip(daily,returns):
        if day['trades']:streak=streak+1 if ret<0 else 0
    last=dt.date.fromisoformat(daily[-1]['date']) if daily else None
    week_start=(last-dt.timedelta(days=last.weekday())).isoformat() if last else None
    week_equity=1.
    for day,ret in zip(daily,returns):
        if day['date']>=week_start:week_equity*=1+ret/100
    weekly=(week_equity-1)*100 if daily else None
    return {'trades':len(values),'observedDays':len(daily),'tradingDays':sum(x['trades']>0 for x in daily),
        'winRate':100*sum(x>0 for x in values)/len(values) if values else None,
        'avgPnl':statistics.mean(values) if values else None,'expectancyPct':statistics.mean(values) if values else None,
        'avgWin':statistics.mean([x for x in values if x>0]) if gains else None,
        'avgLoss':statistics.mean([x for x in values if x<0]) if loss else None,
        'profitFactor':gains/loss if loss else 999 if gains else None,
        'mddPct':mdd if returns else None,'worst':min(returns) if returns else None,
        'dailyAvgPct':statistics.mean(returns) if returns else None,'totalReturnPct':(equity-1)*100 if returns else None,
        'goalDays':sum(x>=1 for x in returns),'unsettled':len(rows)-len(closed),
        'currentDrawdownPct':(equity/peak-1)*100 if daily else None,'lossStreakTradeDays':streak,
        'weekStart':week_start,'weeklyReturnPct':weekly,'weeklyTargetGapPct':max(0,5-weekly) if weekly is not None else None,
        'daily':daily,'returnRule':'sum of net trade PnL / 3 fixed slots; unused slots are cash'}

def walk_forward(rows,baseline_rows,daily,baseline_daily,name):
    """Expanding 20-session training, next five unseen sessions; choose using train only."""
    candidate={x['date']:x for x in daily};base={x['date']:x for x in baseline_daily}
    dates=sorted(set(candidate)&set(base));folds=[];policy=[];reference=[]
    for start in range(20,len(dates),5):
        train_dates=set(dates[:start]);test=dates[start:start+5]
        if len(test)<5:continue
        train=summarize([x for x in rows if x['date'] in train_dates],[candidate[d] for d in dates[:start]])
        train_base=summarize([x for x in baseline_rows if x['date'] in train_dates],[base[d] for d in dates[:start]])
        use=bool(train['trades']>=20 and (train['profitFactor'] or 0)>=1.1 and (train['dailyAvgPct'] or 0)>0
                 and train['dailyAvgPct']>(train_base['dailyAvgPct'] or 0) and train['mddPct']>=-15 and train['worst']>=-8)
        selected=name if use else 'baseline'
        picked=[candidate[d] if use else base[d] for d in test]
        policy.extend(picked);reference.extend(base[d] for d in test)
        folds.append({'trainFrom':dates[0],'trainTo':dates[start-1],'testFrom':test[0],'testTo':test[-1],
            'selected':selected,'trainTrades':train['trades'],'trainDailyAvgPct':train['dailyAvgPct'],
            'testAccountSumPct':sum(x['returnPct'] for x in picked),'baselineTestSumPct':sum(base[d]['returnPct'] for d in test)})
    avg=statistics.mean(x['returnPct'] for x in policy) if policy else None
    base_avg=statistics.mean(x['returnPct'] for x in reference) if reference else None
    return {'folds':folds,'evaluationDays':len(policy),'dailyAvgPct':avg,'baselineDailyAvgPct':base_avg,
        'candidateSelections':sum(x['selected']==name for x in folds),
        'passed':bool(len(folds)>=2 and folds[-1]['selected']==name and avg is not None and avg>0 and avg>=base_avg),
        'rule':'expanding first20 complete common sessions -> next5; train-only choice; no partial last fold'}

def section(strategy,rows,ledgers,previous,errors):
    kind=KINDS[strategy]
    generated=previous.get('generatedPool') or []
    names=['baseline']+CLOSING_SHADOW_NAMES+[x['name'] for x in generated]
    all_dates=sorted(x['date'] for x in ledgers if coverage(x,kind))
    variants=[]
    for name in dict.fromkeys(names):
        meta=next((x for x in generated if x['name']==name),{})
        subset=[x for x in rows if x['kind']==kind and x['variant']==name
                and (not meta or x['date']>meta.get('createdAfter','9999'))]
        daily=daily_rows(subset,ledgers,kind,name)
        valid_dates={x['date'] for x in daily}
        complete=[x for x in subset if x['date'] in valid_dates]
        sm=summarize(complete,daily)
        sm['unsettled']=sum(x['state']!='closed' for x in subset)
        sm['recordedSignals']=len(subset)
        sm['closedRecorded']=sum(x['state']=='closed' for x in subset)
        sm['excludedClosedTrades']=sm['closedRecorded']-sm['trades']
        stress=summarize(complete,daily,.10)
        # Chronological fixed-rule forward blocks; no best-in-full-sample selection.
        cut=max(1,len(all_dates)//2);holdout=set(all_dates[cut:])
        wf=[x for x in complete if x['date'] in holdout]
        wf_daily=[x for x in daily if x['date'] in holdout]
        ws=summarize(wf,wf_daily)
        base_rows=[x for x in rows if x['kind']==kind and x['variant']=='baseline' and x['date'] in valid_dates]
        bd=daily_rows(base_rows,[l for l in ledgers if l['date'] in valid_dates],kind,'baseline')
        base_dates={x['date'] for x in bd}
        base_rows=[x for x in base_rows if x['date'] in base_dates]
        bs=summarize(base_rows,bd)
        bw=summarize([x for x in base_rows if x['date'] in holdout],[x for x in bd if x['date'] in holdout])
        wf_policy=walk_forward(complete,base_rows,daily,bd,name)
        edge=(sm['avgPnl'] or 0)-(bs['avgPnl'] or 0)
        val_edge=(ws['avgPnl'] or 0)-(bw['avgPnl'] or 0)
        recent_dates=set(all_dates[-20:])
        recent=[x['pnl'] for x in complete if x['date'] in recent_dates]
        recent_base=[x['pnl'] for x in base_rows if x['date'] in recent_dates]
        recent_edge=(statistics.mean(recent) if recent else 0)-(statistics.mean(recent_base) if recent_base else 0)
        blocks=[daily[i*len(daily)//3:(i+1)*len(daily)//3] for i in range(3)]
        positive=sum(bool(b) and sum(x['returnPct'] for x in b)>0 for b in blocks)/3
        sample=sm['trades']>=30 and ws['tradingDays']>=20 and ws['trades']>=20
        risk=bool(sm['mddPct'] is not None and sm['mddPct']>=-15 and sm['worst']>=-8
                  and (sm['profitFactor'] or 0)>=1.1 and (sm['avgPnl'] or 0)>0)
        daily_edge=(sm['dailyAvgPct'] or 0)-(bs['dailyAvgPct'] or 0)
        validation_daily_edge=(ws['dailyAvgPct'] or 0)-(bw['dailyAvgPct'] or 0)
        checks={'sample':sample,'risk':risk,'forward':bool(ws['trades']>=20 and (ws['avgPnl'] or 0)>0 and val_edge>=0 and validation_daily_edge>=0 and wf_policy['passed']),
            'mainEdge':bool(base_dates==valid_dates and bs['trades'] and edge>0 and daily_edge>0),
            'positiveBlocks':positive>=.6,'costStress':bool((stress['avgPnl'] or 0)>0 and (stress['profitFactor'] or 0)>=1.1),
            'sourceComplete':not errors and sm['unsettled']==0}
        incomplete_dates=[l['date'] for l in ledgers if any(x['date']==l['date'] for x in subset)
                          and (not coverage(l,kind) or any(x['date']==l['date'] and x['state']!='closed' for x in subset))]
        checks['sourceComplete']=checks['sourceComplete'] and not incomplete_dates
        eligible=all(checks.values())
        score=shadow_score(edge,val_edge,recent_edge,risk,sm['trades'],30)
        variants.append({'name':name,'kind':kind,'summary':sm,'stress':stress,'validation':ws,
            'params':meta.get('params'),'status':'review' if eligible else 'collecting',
            'eligibleToPromote':eligible,'sampleReady':sample,'mddOk':risk,'profitFactorOk':risk,
            'allTrades':sm['trades'],'holdoutTrades':ws['trades'],'allAvgEdgePct':edge,
            'validationAvgEdgePct':val_edge,'recentEdgePct':recent_edge,'researchScore':score['score'],
            'allDailyEdgePct':daily_edge,'validationDailyEdgePct':validation_daily_edge,
            'sampleFactor':score['sampleFactor'],'scoreParts':score['parts'],'checks':checks,
            'blockedReasons':[k for k,v in checks.items() if not v],
            'incompleteDates':incomplete_dates,
            'positiveTimeBlockFraction':positive,'walkForward':wf_policy,
            'walkForwardRule':wf_policy['rule']+'; fixed-rule forward-half diagnostic is separate'})
    evidence=max((x['date'] for x in daily_rows(rows,ledgers,kind,'baseline')),default='')
    main_daily=daily_rows(rows,ledgers,kind)
    main_dates={x['date']:x['mainVariant'] for x in main_daily}
    main_rows=[x for x in rows if x['kind']==kind and main_dates.get(x['date'])==x['variant']]
    baseline_rows=[x for x in rows if x['kind']==kind and x['variant']=='baseline']
    report={'status':'degraded' if errors else 'research' if evidence else 'collecting',
        'from':min(all_dates,default=None),'to':evidence or None,'candidates':[v for v in variants if v['name']!='baseline'],
        'variants':variants,'rankingRule':ranking_rule(),'daily':main_daily,'risk':summarize(main_rows,main_daily),
        'conditionAnalysis':condition_analysis(baseline_rows),
        'inputCoverage':{'observedCandidates':sum(len(s.get('observations') or []) for l in ledgers for s in l.get('scans') or [] if s.get('kind')==kind),
                         'retentionRule':'all cutoff observations + versioned variant parameters; selected and unselected inputs retained'},
        'mainPolicy':'research paper main only; existing KIS switches and broker baseline are unchanged',
        'feesPct':.23,'slots':3}
    if errors:report['to']=previous.get('lastEvidenceDate')
    evolve_lifecycle(strategy,report,previous)
    return report
