# -*- coding: utf-8 -*-
import csv, os, glob, re
from datetime import datetime, timedelta, timezone

BASE = r"C:\Users\zhy20\Desktop\csvv\Alpha导出-20261026-101506"
OUT  = r"C:\Users\zhy20\Desktop\c0ns1d2\src\content\events\auto"
IDX  = r"C:\Users\zhy20\Desktop\c0ns1d2\data-tools\auto-index.md"
TZ8  = timezone(timedelta(hours=8))

GROUPS = {
    "13班CS分部", "这个13班", "SOS团", "十五猪", "踢足球⚽️",
    "四口舍子", "2026强基培训", "五五一", "五一说法", "榨精病栋13号跑友群",
}

ALIAS = {"困眼闭": "朱浩宇", "wxid_1mrre1dw5u0q22": "朱浩宇"}
def norm(name):
    name = (name or "").strip()
    return ALIAS.get(name, name)

GROUP_GAP_MIN = 300    # 群聊：当天内间隔超过 300 分钟切段
DM_GAP_MIN    = 1440   # 私聊：相邻消息间隔超过 24 小时切段（跨天但靠近的合并）
MIN_TEXT      = 6
MAX_BODY      = 30

def parse_time(s):
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
        try: return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc).astimezone(TZ8)
        except ValueError: continue
    raise ValueError(s)

def slugify(s):
    return re.sub(r"[\\/:*?\"<>|\s]+", "-", s.strip()).strip("-")[:20]

# 收集
by_source = {}
for d in sorted(os.listdir(BASE)):
    sd = os.path.join(BASE, d)
    if not os.path.isdir(sd): continue
    csvs = glob.glob(os.path.join(sd, "*.csv"))
    if not csvs: continue
    source = d.split("-", 1)[1] if "-" in d else d
    arr = []
    with open(csvs[0], "r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            ct = r.get("CreateTime", "")
            if not ct: continue
            try: dt = parse_time(ct)
            except ValueError: continue
            arr.append((dt, source, norm(r.get("talker")), r.get("type_name", ""), r.get("msg", "") or ""))
    arr.sort(key=lambda x: x[0])
    by_source[source] = arr

os.makedirs(OUT, exist_ok=True)
for old in glob.glob(os.path.join(OUT, "*.md")):
    os.remove(old)

def split_segments(arr, gap_min):
    segs, cur = [], [arr[0]]
    for m in arr[1:]:
        if (m[0] - cur[-1][0]).total_seconds() > gap_min * 60:
            segs.append(cur); cur = [m]
        else:
            cur.append(m)
    segs.append(cur)
    return segs

def body_lines(seg):
    lines, shown = [], 0
    for m in seg:
        dt, src, who, typ, msg = m
        hm = dt.strftime("%m-%d %H:%M")
        if typ == "text" and msg.strip():
            lines.append("- %s %s：%s" % (hm, who, msg.strip())); shown += 1
        elif typ == "image":   lines.append("- %s %s：[图片]" % (hm, who))
        elif typ == "voice":   lines.append("- %s %s：[语音]" % (hm, who))
        elif typ == "video":   lines.append("- %s %s：[视频]" % (hm, who))
        elif typ == "sticker": lines.append("- %s %s：[表情]" % (hm, who))
        if shown >= MAX_BODY: break
    return lines

index_rows = []
count = 0

def clean_text(t):
    t = re.sub(r"\[[^\]]{1,8}\]", "", t)          # 去掉 [表情]
    t = re.sub(r"[🐖🐟😄😭😂🙏👍😭]+", "", t)
    return t.strip()

STOP_PATTERNS = ["撤回","位置共享","已经结束","在吗","激活","你已添加","通过了","以上是","开始聊天","拍了拍","收到","名片","实时对讲","通话","我通过了","消息验证","系统"]
EVENT_WORDS = ["去","来","约","买","吃","考","玩","看","集合","出发","到","见","开始","回","带","跑","走","聚","庆","放假","开学"]

def make_title(seg, source):
    cands = []
    for m in seg:
        if m[3] != "text": continue
        t = clean_text(m[4])
        if not (4 <= len(t) <= 24): continue
        if any(p in t for p in STOP_PATTERNS): continue
        cands.append(t)
    if not cands:
        return "%s·日常" % source
    scored = sorted(cands, key=lambda s: (-sum(1 for w in EVENT_WORDS if w in s), abs(len(s) - 10)))
    return scored[0][:16]

def classify(seg):
    text = " ".join(m[4] for m in seg if m[3] == "text")
    food_strong = ["火锅","烧烤","奶茶","聚餐","日料","蛋糕","生日","约饭","餐厅","外卖","吃饭","吃","餐"]
    exam_strong = ["考试","复习","高考","首考","卷子","期中","期末","试卷","出分","一模","二模","成绩","考"]
    fc = sum(1 for w in food_strong if w in text)
    ec = sum(1 for w in exam_strong if w in text)
    if fc >= ec and fc >= 1: return "food"
    if ec > fc and ec >= 1: return "exam"
    return "other"

def write_draft(fn, date, persons, source, seg, note):
    global count
    lines = body_lines(seg)
    count += 1
    title = make_title(seg, source)
    category = classify(seg)
    fm = (
        "---\n"
        "title: \"%s\"\n"
        "date: %s\n"
        "persons: [%s]\n"
        "category: %s\n"
        "source: \"%s\"\n"
        "color: \"#888888\"\n"
        "size: %d\n"
        "draft: true\n"
        "---\n\n"
        "> %s\n\n"
        "%s\n"
    ) % (title, date, ", ".join(persons), category, source, len(seg), note, "\n".join(lines))
    with open(os.path.join(OUT, fn), "w", encoding="utf-8") as f:
        f.write(fm)
    index_rows.append((date, source, "、".join(persons), len(seg), fn))

# 群聊：按 (群, 天) 分组
for source, arr in by_source.items():
    if source not in GROUPS: continue
    days = {}
    for m in arr:
        days.setdefault(m[0].strftime("%Y-%m-%d"), []).append(m)
    for date, darr in sorted(days.items()):
        for si, seg in enumerate(split_segments(darr, GROUP_GAP_MIN)):
            if sum(1 for m in seg if m[3] == "text" and m[4].strip()) < MIN_TEXT: continue
            persons = []
            for m in seg:
                if m[2] and m[2] not in persons: persons.append(m[2])
            fn = "group-%s-%02d-%s.md" % (date.replace("-", ""), si + 1, slugify(source))
            write_draft(fn, date, persons, source, seg,
                        "群聊事件草稿（按群·按天），待人工整理，定稿把 draft 改为 false")

# 私聊：按人物，时间靠近的合并
for source, arr in by_source.items():
    if source in GROUPS: continue
    for si, seg in enumerate(split_segments(arr, DM_GAP_MIN)):
        if sum(1 for m in seg if m[3] == "text" and m[4].strip()) < MIN_TEXT: continue
        persons = []
        for m in seg:
            if m[2] and m[2] not in persons: persons.append(m[2])
        date = seg[0][0].strftime("%Y-%m-%d")
        fn = "dm-%s-%02d-%s.md" % (date.replace("-", ""), si + 1, slugify(source))
        write_draft(fn, date, persons, source, seg,
                    "私聊事件草稿（按人物，时间靠近的已合并），待人工整理，定稿把 draft 改为 false")

index_rows.sort(key=lambda x: (x[0], x[1]))
with open(IDX, "w", encoding="utf-8") as f:
    f.write("# 自动事件草稿索引（共 %d 个）\n\n" % count)
    f.write("- 群聊：按群·按天建立整体事件（group- 开头）\n- 私聊：按人物，时间靠近的合并（dm- 开头）\n\n")
    f.write("| 日期 | 来源 | 人物 | 消息数 | 文件 |\n|---|---|---|---|---|\n")
    for date, source, persons, n, fn in index_rows:
        f.write("| %s | %s | %s | %d | %s |\n" % (date, source, persons, n, fn))

print("生成事件草稿数:", count)
print("索引:", IDX)
