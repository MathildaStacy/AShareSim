# 重新抓取腾讯行情快照：python3 fetch_snapshot.py snapshot-YYYY-MM-DD.json （之后要同步改 build.py 和 core.js 里的日期）
import json, urllib.request, sys, time
codes = "sh600519,sz000001,sz300750,sh688981,sh510300,sh601318,sh600036,sz000858,sz002594,sh601899,sz159915,sh512100,sh588000,sh600900,sz000333,sh601012,sz300059,sz300033,sh688111,sz002415,sh601127,sh600030,sz000002,sz000725,sh601988,sz002230,sh603259,sz300308,sz002024,sh600180".split(",")
idx = "sh000001,sz399001,sz399006,sh000300,sh000905,sh000906,sh000852,sh000688".split(",")
def get(u, enc="utf-8"):
    for i in range(3):
        try:
            return urllib.request.urlopen(u, timeout=15).read().decode(enc, "replace")
        except Exception as e:
            time.sleep(1)
    raise SystemExit("fail "+u)
def num(x):
    try: return float(x)
    except: return None
quotes = {}
for chunk in [codes, idx]:
    t = get("https://qt.gtimg.cn/q="+",".join(chunk), "gbk")
    for line in t.strip().split(";"):
        line=line.strip()
        if not line: continue
        k, v = line.split("=",1); k=k[2:]; f=v.strip('"').split("~")
        q = dict(name=f[1].replace(" ",""), code=f[2], price=num(f[3]), prev=num(f[4]), open=num(f[5]), vol=num(f[6]),
                 outer=num(f[7]), inner=num(f[8]),
                 bids=[[num(f[9+2*i]), num(f[10+2*i])] for i in range(5)],
                 asks=[[num(f[19+2*i]), num(f[20+2*i])] for i in range(5)],
                 time=f[30], chg=num(f[31]), pct=num(f[32]), high=num(f[33]), low=num(f[34]), amount=num(f[37]),
                 turnover=num(f[38]), pe=num(f[39]), amp=num(f[43]), floatCap=num(f[44]), totalCap=num(f[45]), pb=num(f[46]),
                 up=num(f[47]), down=num(f[48]), volRatio=num(f[49]), avg=num(f[51]), type=f[61] if len(f)>61 else "",
                 w52h=num(f[67]) if len(f)>67 else None, w52l=num(f[68]) if len(f)>68 else None)
        quotes[k]=q
kl = {}; mins = {}
for c in codes + ["sh000300","sh000906","sh000001"]:
    n = 500 if c in ("sh000300","sh000906","sh510300") else 250
    fq = "" if c.startswith("sh000") else "qfq"
    j = json.loads(get(f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={c},day,,,{n},{fq}"))
    d = j["data"][c]; arr = d.get("qfqday") or d.get("day")
    kl[c] = [[r[0], float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])] for r in arr]
    if c in codes or c=="sh000001":
        m = json.loads(get(f"https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={c}"))
        rows = m["data"][c]["data"]["data"]
        mins[c] = [[r.split()[0], float(r.split()[1]), float(r.split()[2])] for r in rows]
json.dump(dict(quotes=quotes, kline=kl, minute=mins, fetchedAt=time.strftime("%Y-%m-%d %H:%M:%S")), open(sys.argv[1],"w"), ensure_ascii=False, separators=(",",":"))
print("ok", len(quotes), len(kl), len(mins))
