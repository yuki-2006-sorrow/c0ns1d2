# -*- coding: utf-8 -*-
import glob, os, re

AUTO = r"C:\Users\zhy20\Desktop\c0ns1d2\src\content\events\auto"
ALIAS = {"王一开": "王弈铠", "杨予": "杨予哲", "飏": "宣扬", "u": "宗天佑"}
NAMES = "|".join(sorted(ALIAS, key=len, reverse=True))
# 单字母 u 用词边界，其他直接匹配
SPEAKER_RE = re.compile(r"((?:\*\*[\d\- :]+\*\*)|(?:[\d-]+ [\d:]+))[ \t]+(" + NAMES + r"|(?<![A-Za-z])u(?![A-Za-z]))：")

def fix_persons(line):
    m = re.match(r"persons:\s*\[(.*)\]\s*$", line)
    if not m:
        return line
    parts = [x.strip() for x in m.group(1).split(",")]
    parts = [ALIAS.get(x, x) for x in parts]
    return "persons: [" + ", ".join(parts) + "]"

count_files = 0
for p in glob.glob(os.path.join(AUTO, "*.md")):
    t = open(p, encoding="utf-8").read()
    orig = t
    lines = t.split("\n")
    lines = [fix_persons(ln) if ln.startswith("persons:") else ln for ln in lines]
    t = "\n".join(lines)
    # 正文发言人
    t = SPEAKER_RE.sub(lambda m: m.group(1) + " " + ALIAS.get(m.group(2), "宗天佑") + "：", t)
    if t != orig:
        open(p, "w", encoding="utf-8").write(t)
        count_files += 1

print("改动文件数:", count_files)
