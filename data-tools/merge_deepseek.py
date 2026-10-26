# -*- coding: utf-8 -*-
import json, glob, os, re

ROOT = r"C:\Users\zhy20\Desktop\c0ns1d2"
D = os.path.join(ROOT, "data-tools", "deepseek-batches")
AUTO = os.path.join(ROOT, "src", "content", "events", "auto")

entries = {}
for rf in glob.glob(os.path.join(D, "batch-*.result.json")):
    for x in json.load(open(rf, encoding="utf-8")):
        entries[x["file"]] = x

def yq(s):
    return '"' + s.replace('"', "'") + '"'

updated, privacy_hits = 0, 0
for fn, e in entries.items():
    p = os.path.join(AUTO, fn)
    t = open(p, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", t, re.S)
    fm, body = m.group(1), m.group(2)

    # 标题建议
    if e.get("suggest_title"):
        fm = re.sub(r"^title:.*$", "title: %s" % yq(e["suggest_title"]), fm, count=1, flags=re.M)

    # 写 summary / quotes（插到 persons 行后）
    fm = re.sub(r"^persons:.*$", lambda mm: mm.group(0) + "\nsummary: " + yq(e["summary"]) +
               "\nquotes: [" + ", ".join(yq(q) for q in e.get("quotes", [])) + "]", fm, count=1, flags=re.M)

    # 隐私替换（在正文）
    for pv in e.get("privacy", []):
        orig, rep = pv.get("original", ""), pv.get("replacement", "[已隐藏]")
        if orig and orig in body:
            body = body.replace(orig, rep)
            privacy_hits += 1

    t = "---\n" + fm + "\n---\n" + body
    open(p, "w", encoding="utf-8").write(t)
    updated += 1

print("合并事件数:", updated)
print("隐私替换命中:", privacy_hits)
