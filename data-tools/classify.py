# -*- coding: utf-8 -*-
import csv, os, glob

BASE = r"C:\Users\zhy20\Desktop\csvv\Alpha导出-20261026-101506"

for d in sorted(os.listdir(BASE)):
    sd = os.path.join(BASE, d)
    if not os.path.isdir(sd): continue
    csvs = glob.glob(os.path.join(sd, "*.csv"))
    if not csvs: continue
    source = d.split("-", 1)[1] if "-" in d else d
    talkers = set()
    n = 0
    with open(csvs[0], "r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            n += 1
            t = (r.get("talker") or "").strip()
            if t: talkers.add(t)
    kind = "GROUP" if len(talkers) >= 3 else "DM"
    print("%-5s talkers=%-2d msgs=%-5d %s" % (kind, len(talkers), n, source))
