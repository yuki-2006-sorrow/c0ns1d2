# -*- coding: utf-8 -*-
import glob, os, re

AUTO = r"C:\Users\zhy20\Desktop\c0ns1d2\src\content\events\auto"
KEY_RE = re.compile(r"^[a-zA-Z_]+:")

fixed = []
for p in glob.glob(os.path.join(AUTO, "*.md")):
    t = open(p, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n", t, re.S)
    if not m:
        continue
    fm = m.group(1)
    lines = fm.split("\n")
    out, dropped = [], []
    for ln in lines:
        # frontmatter 内合法行必须是 key: value；纯文本残留（如 xxx"）删除
        if KEY_RE.match(ln) or ln.strip() == "":
            out.append(ln)
        else:
            dropped.append(ln)
    if dropped:
        new_fm = "\n".join(out)
        new_t = t[:m.start(1)] + new_fm + t[m.end(1):]
        open(p, "w", encoding="utf-8").write(new_t)
        fixed.append((os.path.basename(p), dropped))

print("修复文件数:", len(fixed))
for fn, d in fixed:
    print(" ", fn, "删除:", d)
