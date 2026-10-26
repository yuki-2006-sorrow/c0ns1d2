# -*- coding: utf-8 -*-
import csv, os, glob, re
from collections import Counter

BASE = r"C:\Users\zhy20\Desktop\csvv\Alpha导出-20261026-101506"
GROUPS = {
    "13班CS分部", "这个13班", "SOS团", "十五猪", "踢足球⚽️",
    "四口舍子", "2026强基培训", "五五一", "五一说法", "榨精病栋13号跑友群",
}
ALIAS = {
    "困眼闭": "朱浩宇", "wxid_1mrre1dw5u0q22": "朱浩宇",
    "馒头币": "朱浩宇",
}
def norm(name):
    name = (name or "").strip()
    return ALIAS.get(name, name)

counts = Counter()
per_source = {}

for d in sorted(os.listdir(BASE)):
    sd = os.path.join(BASE, d)
    if not os.path.isdir(sd): continue
    csvs = glob.glob(os.path.join(sd, "*.csv"))
    if not csvs: continue
    source = d.split("-", 1)[1] if "-" in d else d
    is_group = source in GROUPS
    local = Counter()
    with open(csvs[0], "r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            talker = (r.get("talker") or "").strip()
            typ = r.get("type_name", "")
            # 系统消息（chatroom id / 系统提示）跳过
            if talker.endswith("@chatroom"):
                continue
            if is_group:
                who = norm(talker)
                # 群里 talker 为空或仍是系统 id 的跳过
                if not who or who.endswith("@chatroom"):
                    continue
            else:
                if r.get("is_sender") == "1":
                    who = "朱浩宇"
                else:
                    who = norm(source)
            if not who:
                continue
            counts[who] += 1
            local[who] += 1
    per_source[source] = local

print("=== 全局消息数（按人，前 40）===")
for name, n in counts.most_common(40):
    print(f"{n:6d}  {name}")

print("\n=== 各私聊来源：对方消息数 ===")
for source, local in per_source.items():
    if source in GROUPS: continue
    other = {k: v for k, v in local.items() if k != "朱浩宇"}
    for name, n in sorted(other.items(), key=lambda x: -x[1]):
        print(f"{n:6d}  {name}  (来源:{source})")
