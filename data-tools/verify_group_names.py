# -*- coding: utf-8 -*-
import json, glob, os, re

DIR = r"C:\Users\zhy20\Desktop\c0ns1d2\data-tools\group-naming"
AUTO = r"C:\Users\zhy20\Desktop\c0ns1d2\src\content\events\auto"

entries = {}
for rf in glob.glob(os.path.join(DIR, "batch-*.result.json")):
    with open(rf, "r", encoding="utf-8") as f:
        for e in json.load(f):
            entries[e["file"]] = (e["title"], e.get("category", "other"))

ok, bad = 0, []
for fn, (title, category) in entries.items():
    p = os.path.join(AUTO, fn)
    if not os.path.exists(p):
        bad.append((fn, "文件不存在")); continue
    t = open(p, encoding="utf-8").read()
    mt = re.search(r'^title:\s*"?(.*?)"?\s*$', t, re.M)
    mc = re.search(r'^category:\s*(\S+)\s*$', t, re.M)
    cur_title = mt.group(1) if mt else ""
    cur_cat = mc.group(1) if mc else ""
    if cur_title == title and cur_cat == category:
        ok += 1
    else:
        bad.append((fn, f"标题[{cur_title}] 分类[{cur_cat}] != 目标[{title}][{category}]"))

print("一致:", ok, "/", len(entries))
print("不一致:", len(bad))
for x in bad:
    print(" ", x[0], x[1])
