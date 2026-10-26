# -*- coding: utf-8 -*-
import csv, os, sys, glob
from collections import defaultdict, Counter

BASE = r"C:\Users\zhy20\Desktop\csvv\Alpha导出-20261026-101506"

io_enc = sys.stdout.encoding
def p(s):
    try: print(s)
    except UnicodeEncodeError: print(s.encode(io_enc or "utf-8", "replace").decode())

type_counter = Counter()
talker_counter = Counter()
dates = set()
src_days = defaultdict(set)
min_t, max_t = None, None
total = 0

for d in sorted(os.listdir(BASE)):
    sd = os.path.join(BASE, d)
    if not os.path.isdir(sd): continue
    csvs = glob.glob(os.path.join(sd, "*.csv"))
    if not csvs: continue
    src = d.split("-", 1)[1] if "-" in d else d
    with open(csvs[0], "r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            total += 1
            t = r.get("type_name", "")
            type_counter[t] += 1
            who = (r.get("talker") or "").strip()
            if who: talker_counter[who] += 1
            ct = r.get("CreateTime", "")
            if ct:
                day = ct[:10]
                dates.add(day)
                src_days[src].add(day)
                if min_t is None or ct < min_t: min_t = ct
                if max_t is None or ct > max_t: max_t = ct

p("总消息数: %d" % total)
p("时间范围: %s ~ %s" % (min_t, max_t))
p("覆盖天数: %d" % len(dates))
p("\n消息类型分布:")
for k, v in type_counter.most_common():
    p("  %-12s %d" % (k, v))
p("\n发言人数(不同talker): %d" % len(talker_counter))
p("talker Top30:")
for k, v in talker_counter.most_common(30):
    p("  %-12s %d" % (k, v))
p("\n各来源活跃天数 Top20:")
for k in sorted(src_days, key=lambda x: -len(src_days[x]))[:20]:
    p("  %-16s %d 天" % (k, len(src_days[k])))
