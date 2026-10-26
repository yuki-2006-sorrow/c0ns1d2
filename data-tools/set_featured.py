# -*- coding: utf-8 -*-
import glob, os, re

PD = r"C:\Users\zhy20\Desktop\c0ns1d2\src\content\people"

FEATURED = {
    "zhu-haoyu": "",
    "wu-chenyang": "",
    "zeng-haoxin": "",
    "chen-erbi": "",
    "jin-shengkai": "",
    "wu-zekai": "",
    "shi-xiangtian": "",
    "jiang-jiachen": "",
    "wang-yikai": "",
}
SUB = {
    "wang-ziyi": "陈二逼线",
    "xia-laoshi": "师长线",
    "lou-jing": "师长线",
    "kyw": "夏令营线",
    "shao-zhipeng": "同学线",
    "u": "高中同学",
    "yang-yu": "高中同学",
    "yang": "高中同学",
}

def set_field(text, key, value):
    line = "%s: %s" % (key, value)
    if re.search(r"^%s:" % key, text, re.M):
        return re.sub(r"^%s:.*$" % key, line, text, count=1, flags=re.M)
    # 插入到 messages 行之后
    return re.sub(r"^(messages:.*)$", r"\1\n" + line, text, count=1, flags=re.M)

for p in glob.glob(os.path.join(PD, "*.md")):
    slug = os.path.basename(p)[:-3]
    t = open(p, encoding="utf-8").read()
    if slug in FEATURED:
        t = set_field(t, "featured", "true")
        t = set_field(t, "group", '""')
    elif slug in SUB:
        t = set_field(t, "featured", "false")
        t = set_field(t, "group", SUB[slug])
    open(p, "w", encoding="utf-8").write(t)
    print(slug, "->", "主" if slug in FEATURED else ("子:"+SUB.get(slug,"") if slug in SUB else "未处理"))
