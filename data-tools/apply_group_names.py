# -*- coding: utf-8 -*-
import json, glob, os, re

DIR = r"C:\Users\zhy20\Desktop\c0ns1d2\data-tools\group-naming"
AUTO = r"C:\Users\zhy20\Desktop\c0ns1d2\src\content\events\auto"

# 汇总所有结果
entries = {}
for rf in glob.glob(os.path.join(DIR, "batch-*.result.json")):
    with open(rf, "r", encoding="utf-8") as f:
        for e in json.load(f):
            entries[e["file"]] = (e["title"], e.get("category", "other"))

print("结果条目数:", len(entries))

existing = {os.path.basename(p) for p in glob.glob(os.path.join(AUTO, "group-*.md"))}
missing_file = [fn for fn in entries if fn not in existing]
unprocessed = [fn for fn in existing if fn not in entries]

updated, failed = 0, []
for fn, (title, category) in entries.items():
    p = os.path.join(AUTO, fn)
    if not os.path.exists(p):
        failed.append(fn); continue
    with open(p, "r", encoding="utf-8") as f:
        text = f.read()
    # 替换 frontmatter 中的 title / category
    new = re.sub(r'^title:.*$', 'title: "%s"' % title.replace('"', "'"), text, count=1, flags=re.M)
    new = re.sub(r'^category:.*$', 'category: %s' % category, new, count=1, flags=re.M)
    if new == text:
        failed.append(fn); continue
    with open(p, "w", encoding="utf-8") as f:
        f.write(new)
    updated += 1

print("成功更新:", updated)
print("结果里但文件不存在:", missing_file)
print("文件存在但结果未覆盖:", unprocessed)
print("替换失败:", failed)

# 统计分类
from collections import Counter
print("分类分布:", Counter(c for _, c in entries.values()))
