# -*- coding: utf-8 -*-
import glob, os, re

ROOT = r"C:\Users\zhy20\Desktop\c0ns1d2"
AUTO = os.path.join(ROOT, "src", "content", "events", "auto")
OUT = os.path.join(ROOT, "data-tools", "deepseek-batches")
os.makedirs(OUT, exist_ok=True)

files = sorted(glob.glob(os.path.join(AUTO, "*.md")))
PER = 40

def split_file(p):
    t = open(p, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", t, re.S)
    fm, body = (m.group(1), m.group(2)) if m else ("", t)
    def grab(k):
        mm = re.search(r"^%s:\s*(.*)$" % k, fm, re.M)
        return mm.group(1).strip().strip('"') if mm else ""
    return grab("title"), grab("date"), grab("source"), body.strip()

batches = [files[i:i+PER] for i in range(0, len(files), PER)]
manifest = []
for bi, batch in enumerate(batches, 1):
    lines = []
    for p in batch:
        title, date, source, body = split_file(p)
        fn = os.path.basename(p)
        lines.append("### EVENT: %s\nTITLE: %s\nDATE: %s\nSOURCE: %s\nBODY:\n%s" % (fn, title, date, source, body))
    name = "batch-%02d.txt" % bi
    open(os.path.join(OUT, name), "w", encoding="utf-8").write("\n\n".join(lines))
    manifest.append((name, len(batch)))

for n, c in manifest:
    print(n, c, "个事件")
print("总批次:", len(batches))
