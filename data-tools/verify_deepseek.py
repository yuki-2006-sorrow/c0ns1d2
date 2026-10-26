# -*- coding: utf-8 -*-
import json, glob, os, re

D = r"C:\Users\zhy20\Desktop\c0ns1d2\data-tools\deepseek-batches"
all_entries = {}
errors = []
for i in range(1, 14):
    rf = os.path.join(D, "batch-%02d.result.json" % i)
    bf = os.path.join(D, "batch-%02d.txt" % i)
    try:
        data = json.load(open(rf, encoding="utf-8"))
    except Exception as e:
        errors.append("batch-%02d JSON解析失败: %s" % (i, e)); continue
    expected = re.findall(r"^### EVENT: (.+)$", open(bf, encoding="utf-8").read(), re.M)
    got = [x.get("file") for x in data]
    if len(got) != len(expected):
        errors.append("batch-%02d 数量不符: 期望%d 得到%d" % (i, len(expected), len(got)))
    miss = set(expected) - set(got)
    extra = set(got) - set(expected)
    if miss: errors.append("batch-%02d 缺失: %s" % (i, miss))
    if extra: errors.append("batch-%02d 多余: %s" % (i, extra))
    for x in data:
        if not x.get("summary"): errors.append("batch-%02d %s 无summary" % (i, x.get("file")))
        all_entries[x["file"]] = x

print("总条目:", len(all_entries))
print("错误数:", len(errors))
for e in errors:
    print(" ", e)
