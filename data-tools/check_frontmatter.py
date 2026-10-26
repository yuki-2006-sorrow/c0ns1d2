# -*- coding: utf-8 -*-
import glob, os, re, sys
try:
    import yaml
except ImportError:
    print("NO_YAML"); sys.exit(0)

AUTO = r"C:\Users\zhy20\Desktop\c0ns1d2\src\content\events\auto"
bad = []
for p in glob.glob(os.path.join(AUTO, "*.md")):
    t = open(p, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n", t, re.S)
    if not m:
        bad.append((os.path.basename(p), "无 frontmatter")); continue
    try:
        yaml.safe_load(m.group(1))
    except Exception as e:
        bad.append((os.path.basename(p), str(e)))

print("检查文件数:", len(glob.glob(os.path.join(AUTO, '*.md'))))
print("frontmatter 错误数:", len(bad))
for fn, e in bad:
    print("---", fn)
    print("   ", e)
