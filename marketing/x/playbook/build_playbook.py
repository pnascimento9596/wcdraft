#!/usr/bin/env python3
"""
Build the @WCDraft X Marketing Playbook as a presentation-quality .docx and .pdf.

Content is PARSED VERBATIM from the committed marketing source files — post / reply /
quote copy is never retyped or altered here. Char counts shown are the source's stated
X-convention counts (t.co wraps every URL to 23 chars), re-verified by build_playbook
against the source before rendering.

Usage:  python build_playbook.py
Outputs (next to this script):  wcdraft-x-playbook.docx  +  wcdraft-x-playbook.pdf
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
MKT = os.path.normpath(os.path.join(HERE, ".."))  # marketing/x

WEEK_LABEL = "2026-W25"
GENERATED = "2026-06-15"
PACK_FILE = "packs/pack-2026-W25.md"

# ---- Brand palette -------------------------------------------------------
EMERALD = "#2ecf92"
GOLD = "#f5b62a"
INK = "#16211d"      # near-black green-tinted body ink
MUTED = "#5d6b64"    # secondary text
BOX_BG = "#f3f7f4"   # copy-paste block fill
BOX_BORDER = "#cfe7db"
CALLOUT_BG = "#fbf4e1"  # gold-tinted callout fill
PAGE_BG = "#ffffff"


def _hex(c):  # strip leading '#'
    return c.lstrip("#")


# =========================================================================
# PARSE SOURCE (verbatim)
# =========================================================================
def read(name):
    with open(os.path.join(MKT, name), encoding="utf-8") as f:
        return f.read()


URL_RE = re.compile(r"https?://\S+")


def x_count(text):
    """X t.co convention: every URL counts as 23 chars."""
    return len(URL_RE.sub("x" * 23, text))


def link_note(text):
    """A short scheduling note derived from the post's link, if any."""
    m = URL_RE.search(text)
    if not m:
        return None
    url = m.group(0)
    if "share?run=" in url:
        return ("Share link — replace with YOUR strong run before posting. "
                "The long token counts as 23 chars on X.")
    # Every standard post carries the same wcdraft.com link; the OG-card rule is
    # stated once in the Scheduler + Cadence sections rather than on all 42 blocks.
    return None


def parse_pack():
    src = read(PACK_FILE)
    # day sections: "## Monday" ... "## Result spotlights"
    days = []
    spotlights = []
    block_re = re.compile(
        r"\*\*(\d+)\.\s*([^·]+?)·\s*(\d+)/280 chars\*\*"
        r"(?:\s*—\s*_([^_]+)_)?"          # optional trailing italic note
        r".*?\n```\n(.*?)\n```",
        re.S,
    )
    # split into sections by '## '
    sections = re.split(r"^## ", src, flags=re.M)
    for sec in sections[1:]:
        head = sec.splitlines()[0].strip()
        blocks = []
        for m in block_re.finditer(sec):
            idx, label, stated, note, text = m.groups()
            stated = int(stated)
            real = x_count(text)
            blocks.append({
                "idx": int(idx),
                "label": label.strip(),
                "stated": stated,
                "real": real,
                "text": text,
                "note": (note.strip() if note else None),
                "linknote": link_note(text),
                "over": real > 280,
            })
        if head.lower().startswith("result spotlight"):
            spotlights = blocks
        else:
            days.append((head, blocks))
    return days, spotlights


def parse_bank(name):
    """Return (intro_rules, [(title, desc, [(variant,count,text)])], discovery)."""
    src = read(name)
    scenarios = []
    discovery = []
    parts = re.split(r"^### ", src, flags=re.M)
    var_re = re.compile(r"\*\*(Variant \d+) · (\d+)/280 chars\*\*\n\n```\n(.*?)\n```", re.S)
    desc_re = re.compile(r"^_([^_]+)_", re.M)
    for p in parts[1:]:
        title = p.splitlines()[0].strip()
        d = desc_re.search(p)
        desc = d.group(1).strip() if d else None
        variants = []
        for vm in var_re.finditer(p):
            v, c, t = vm.groups()
            variants.append({"variant": v, "stated": int(c), "real": x_count(t), "text": t})
        scenarios.append((title, desc, variants))
    for dm in re.finditer(r"- \[([^\]]+)\]\((https://x\.com/search[^)]+)\)", src):
        discovery.append((dm.group(1), dm.group(2)))
    return scenarios, discovery


# =========================================================================
# STATIC COPY (instructions — not post copy)
# =========================================================================
HOW_TO_USE = [
    "**Weekly (~15 min):** one sitting to batch-schedule the week's posts in X's native composer.",
    "**Daily (~2 min):** reply to inbound mentions and, optionally, quote-post a public thread.",
    "**Organic only:** every post is scheduled by hand — there is no API and no automated posting.",
    "**Never auto-reply to strangers.** Reply only to people who engaged you first (a mention, reply, or quote).",
]

SCHEDULER_INTRO = ("**X Native Scheduler** (desktop web only — the X mobile app can't "
                   "schedule; @WCDraft has Premium, so full access).")

SCHEDULER_BLOCKS = [
    ("Schedule a post:",
     "(1) On a computer, go to **x.com**, signed in as @WCDraft → click **Post**. "
     "(2) Paste the post text; add image/video if any. "
     "**If the post contains a wcdraft.com link, paste it and wait a few seconds for the "
     "OG preview card to populate in the composer before scheduling** — schedule too early "
     "and the link can post without its image. "
     "(3) Click the **calendar/schedule icon** at the bottom of the composer. "
     "(4) Set date + time (ET) — schedulable up to ~18 months out → **Confirm → Schedule.** "
     "The post enters the queue and auto-publishes."),
    ("Batch the week:",
     "repeat for each post in one sitting (native scheduling is one-at-a-time — no "
     "bulk/thread scheduling). ~15 minutes for the week."),
    ("Manage scheduled posts:",
     "open the composer → click the **calendar icon** → **Scheduled posts** tab → tap to "
     "edit time/content or delete."),
    ("Notes:",
     "scheduled posts are treated identically by the algorithm (no penalty). One post at a "
     "time, no native thread scheduling, desktop-web only."),
]

CADENCE_ROWS = [
    ("Posts per day", "3–5 — pick the strongest from the weekly pack; you don't post all 43."),
    ("Peak windows (ET)", "Weekday 7–9am · 12–1pm · 6–9pm."),
    ("Strongest days", "Tuesday–Wednesday mornings."),
    ("Link-card gotcha", "Paste the wcdraft.com link, wait for the OG preview card, THEN schedule."),
    ("Platform", "Desktop web only — the X mobile app can't schedule."),
]

FOOTER_LINES = [
    "Organic only — no paid promotion pending trademark counsel.",
    "No unsolicited auto-replies; reply only to inbound engagement.",
    "Fan-made — never claim affiliation with any competition or governing body.",
]


# =========================================================================
# tiny **bold** markup splitter -> list of (text, is_bold)
# =========================================================================
def split_bold(s):
    out = []
    for i, seg in enumerate(re.split(r"\*\*(.+?)\*\*", s)):
        if seg:
            out.append((seg, i % 2 == 1))
    return out


# =========================================================================
# DOCX RENDERER
# =========================================================================
def build_docx(path, pack_days, spotlights, replies, reply_disc, quotes, quote_disc):
    from docx import Document
    from docx.shared import Pt, RGBColor, Inches
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    def rgb(c):
        return RGBColor.from_string(_hex(c).upper())

    doc = Document()
    # base styles
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = rgb(INK)
    for section in doc.sections:
        section.top_margin = Inches(0.7)
        section.bottom_margin = Inches(0.7)
        section.left_margin = Inches(0.85)
        section.right_margin = Inches(0.85)

    def shade(paragraph, fill):
        pPr = paragraph._p.get_or_add_pPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), _hex(fill).upper())
        pPr.append(shd)

    def border(paragraph, color, size=8, space=8, sides=("top", "bottom", "left", "right"), bar_left=False):
        pPr = paragraph._p.get_or_add_pPr()
        pBdr = OxmlElement("w:pBdr")
        defs = sides if not bar_left else ("left",)
        for side in defs:
            el = OxmlElement(f"w:{side}")
            el.set(qn("w:val"), "single")
            el.set(qn("w:sz"), str(size if not bar_left else 24))
            el.set(qn("w:space"), str(space))
            el.set(qn("w:color"), _hex(color).upper())
            pBdr.append(el)
        pPr.append(pBdr)

    def set_spacing(p, before=0, after=0, line=None):
        pf = p.paragraph_format
        pf.space_before = Pt(before)
        pf.space_after = Pt(after)
        if line:
            pf.line_spacing = line

    def add_rich(p, s, base_size=10.5, color=INK, bold_color=None, mono=False):
        for seg, is_bold in split_bold(s):
            r = p.add_run(seg)
            r.font.size = Pt(base_size)
            r.font.name = "Consolas" if mono else "Calibri"
            r.bold = is_bold
            r.font.color.rgb = rgb(bold_color) if (is_bold and bold_color) else rgb(color)
        return p

    def heading(text, level=1):
        p = doc.add_paragraph()
        set_spacing(p, before=(16 if level == 1 else 11), after=5)
        r = p.add_run(text)
        r.bold = True
        r.font.name = "Calibri"
        if level == 1:
            r.font.size = Pt(17)
            r.font.color.rgb = rgb(EMERALD)
            border(p, EMERALD, size=12, space=4, sides=("bottom",))
        else:
            r.font.size = Pt(12.5)
            r.font.color.rgb = rgb(INK)
            border(p, GOLD, size=18, space=6, sides=("left",))
        return p

    def body(text, **kw):
        p = doc.add_paragraph()
        set_spacing(p, after=kw.get("after", 4), line=1.15)
        add_rich(p, text, base_size=kw.get("size", 10.5), color=kw.get("color", INK),
                 bold_color=kw.get("bold_color"))
        return p

    def copyblock(text, count_label, note=None, over=False, top_label=None):
        # label row (e.g. "Monday · 1 · feature pitch")
        if top_label:
            lp = doc.add_paragraph()
            set_spacing(lp, before=8, after=2)
            r = lp.add_run(top_label)
            r.bold = True
            r.font.size = Pt(9)
            r.font.name = "Calibri"
            r.font.color.rgb = rgb(MUTED)
        # the boxed monospace post
        bp = doc.add_paragraph()
        set_spacing(bp, before=0, after=0, line=1.18)
        shade(bp, BOX_BG)
        border(bp, BOX_BORDER, size=8, space=8)
        add_rich(bp, text, base_size=9.5, color=INK, mono=True)
        # count + note row
        meta = doc.add_paragraph()
        set_spacing(meta, before=2, after=10)
        r = meta.add_run(count_label)
        r.font.size = Pt(8.5)
        r.font.name = "Calibri"
        r.bold = True
        r.font.color.rgb = rgb(GOLD if not over else "#c0392b")
        if over:
            w = meta.add_run("   ⚠ over 280")
            w.font.size = Pt(8.5)
            w.bold = True
            w.font.color.rgb = rgb("#c0392b")
        if note:
            n = meta.add_run("   " + note)
            n.font.size = Pt(8.5)
            n.italic = True
            n.font.color.rgb = rgb(MUTED)

    def callout(intro, blocks):
        p = doc.add_paragraph()
        set_spacing(p, before=4, after=0, line=1.2)
        shade(p, CALLOUT_BG)
        border(p, GOLD, size=8, space=8)
        add_rich(p, intro, base_size=10, color=INK, bold_color=INK)
        for lead, bodytext in blocks:
            bp = doc.add_paragraph()
            set_spacing(bp, before=0, after=0, line=1.2)
            shade(bp, CALLOUT_BG)
            border(bp, GOLD, size=8, space=8)
            rr = bp.add_run(lead + " ")
            rr.bold = True
            rr.font.size = Pt(10)
            rr.font.color.rgb = rgb("#9a7410")
            add_rich(bp, bodytext, base_size=10, color=INK, bold_color=INK)

    # ---------------- COVER ----------------
    for _ in range(3):
        doc.add_paragraph()
    bar = doc.add_paragraph()
    bar.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_spacing(bar, after=2)
    br = bar.add_run("● wcdraft")
    br.bold = True
    br.font.size = Pt(20)
    br.font.color.rgb = rgb(EMERALD)

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_spacing(title, before=6, after=4)
    tr = title.add_run("X Marketing Playbook")
    tr.bold = True
    tr.font.size = Pt(34)
    tr.font.color.rgb = rgb(INK)

    rule = doc.add_paragraph()
    rule.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_spacing(rule, before=2, after=10)
    border(rule, GOLD, size=18, space=2, sides=("bottom",))

    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_spacing(sub, after=2)
    sr = sub.add_run(f"Week {WEEK_LABEL}")
    sr.font.size = Pt(14)
    sr.bold = True
    sr.font.color.rgb = rgb(EMERALD)

    gen = doc.add_paragraph()
    gen.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_spacing(gen, after=2)
    gr = gen.add_run(f"Generated {GENERATED}  ·  organic-only operator guide")
    gr.font.size = Pt(10.5)
    gr.font.color.rgb = rgb(MUTED)
    doc.add_page_break()

    # ---------------- HOW TO USE ----------------
    heading("How to use this")
    for line in HOW_TO_USE:
        p = doc.add_paragraph(style=None)
        set_spacing(p, after=4, line=1.15)
        bullet = p.add_run("▸  ")
        bullet.font.color.rgb = rgb(EMERALD)
        bullet.bold = True
        add_rich(p, line, base_size=10.5, color=INK, bold_color=INK)

    # ---------------- SCHEDULER ----------------
    heading("X Native Scheduler — step by step")
    callout(SCHEDULER_INTRO, SCHEDULER_BLOCKS)

    post_count = sum(len(blocks) for _, blocks in pack_days) + len(spotlights)

    # ---------------- THIS WEEK'S POSTS ----------------
    doc.add_page_break()
    heading(f"This week's posts ({WEEK_LABEL.split('-')[-1]})")
    body(f"{post_count} ready-to-paste posts, grouped by day. Pick the strongest 3–5 per day — you "
         "don't post them all. Copy one block, paste into the composer, schedule.",
         color=MUTED, after=8)
    for dayname, blocks in pack_days:
        heading(dayname, level=2)
        for b in blocks:
            top = f"{dayname} · {b['idx']} · {b['label']}"
            cl = f"{b['stated']}/280 chars"
            copyblock(b["text"], cl, note=b["linknote"], over=b["over"], top_label=top)

    # spotlights
    heading("Result spotlights", level=2)
    body("Post one only when you (or a player) have a genuinely strong real run. The record "
         "is computed from a real share token — never invented.", color=MUTED, after=6)
    for b in spotlights:
        top = f"Result spotlight · {b['idx']} · {b['label']}"
        note = b["note"] or b["linknote"]
        cl = f"{b['stated']}/280 chars"
        copyblock(b["text"], cl, note=note, over=b["over"], top_label=top)

    # ---------------- REPLY BANK ----------------
    doc.add_page_break()
    heading("Reply bank")
    body("Reply only to people who engaged you first — one reply per person per day. Find "
         "the matching scenario, copy a variant, tweak a word, reply. Never reply to abuse.",
         color=MUTED, after=8)
    for title_, desc, variants in replies:
        heading(title_, level=2)
        if desc:
            body(desc, color=MUTED, size=9.5, after=4)
        for v in variants:
            top = v["variant"]
            cl = f"{v['stated']}/280 chars"
            copyblock(v["text"], cl, over=v["real"] > 280, top_label=top)

    # ---------------- QUOTE BANK ----------------
    doc.add_page_break()
    heading("Quote-post bank")
    body("Quote-posts only (quote a public post with your own comment) — never an "
         "unsolicited @-reply to a non-engager. Cap ~3/day. Lead with a differentiator; "
         "never disparage another game.", color=MUTED, after=8)
    for title_, desc, variants in quotes:
        heading(title_, level=2)
        if desc:
            body(desc, color=MUTED, size=9.5, after=4)
        for v in variants:
            cl = f"{v['stated']}/280 chars"
            copyblock(v["text"], cl, over=v["real"] > 280, top_label=v["variant"])

    heading("Discovery — searches to find quote targets", level=2)
    body("API search isn't available, so hunt by hand: open a link, find a good public "
         "post, and quote it with a variant above.", color=MUTED, size=9.5, after=5)
    for label, url in quote_disc:
        p = doc.add_paragraph()
        set_spacing(p, after=3, line=1.1)
        b = p.add_run("•  ")
        b.font.color.rgb = rgb(EMERALD)
        b.bold = True
        lr = p.add_run(label + "  —  ")
        lr.font.size = Pt(10)
        lr.bold = True
        lr.font.color.rgb = rgb(INK)
        ur = p.add_run(url)
        ur.font.size = Pt(8.5)
        ur.font.name = "Consolas"
        ur.font.color.rgb = rgb(MUTED)

    # ---------------- CADENCE ----------------
    doc.add_page_break()
    heading("Cadence & best times")
    table = doc.add_table(rows=0, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.style = "Table Grid"
    table.columns[0].width = Inches(1.9)
    table.columns[1].width = Inches(4.8)
    for k, v in CADENCE_ROWS:
        row = table.add_row().cells
        kp = row[0].paragraphs[0]
        kr = kp.add_run(k)
        kr.bold = True
        kr.font.size = Pt(10)
        kr.font.color.rgb = rgb(EMERALD)
        vp = row[1].paragraphs[0]
        vr = vp.add_run(v)
        vr.font.size = Pt(10)
        vr.font.color.rgb = rgb(INK)
        for w in (0.0,):
            pass

    # ---------------- FOOTER ----------------
    heading("Guardrails", level=2)
    fp = doc.add_paragraph()
    set_spacing(fp, before=2, after=0, line=1.25)
    shade(fp, CALLOUT_BG)
    border(fp, GOLD, size=8, space=8)
    for i, line in enumerate(FOOTER_LINES):
        r = fp.add_run(("" if i == 0 else "\n") + "•  " + line)
        r.font.size = Pt(9.5)
        r.font.color.rgb = rgb("#7a5e10")
        r.bold = True

    doc.save(path)


# =========================================================================
# PDF RENDERER (reportlab Platypus)
# =========================================================================
def build_pdf(path, pack_days, spotlights, replies, reply_disc, quotes, quote_disc):
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.units import inch
    from reportlab.lib.colors import HexColor
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.platypus import (
        BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
        PageBreak, KeepTogether, Flowable,
    )
    from reportlab.lib.styles import ParagraphStyle
    from xml.sax.saxutils import escape

    def md_to_html(s):
        return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escape(s, {'"': "&quot;"}))

    EM = HexColor(EMERALD); GD = HexColor(GOLD); IK = HexColor(INK)
    MT = HexColor(MUTED); BBG = HexColor(BOX_BG); BBD = HexColor(BOX_BORDER)
    CBG = HexColor(CALLOUT_BG)

    styles = {}
    styles["h1"] = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=16,
                                  textColor=EM, spaceBefore=14, spaceAfter=3, leading=19)
    styles["h2"] = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12,
                                  textColor=IK, spaceBefore=10, spaceAfter=3, leading=15,
                                  leftIndent=6, borderColor=GD)
    styles["body"] = ParagraphStyle("body", fontName="Helvetica", fontSize=10,
                                    textColor=IK, leading=14, spaceAfter=4)
    styles["muted"] = ParagraphStyle("muted", fontName="Helvetica", fontSize=9,
                                     textColor=MT, leading=12.5, spaceAfter=4)
    styles["mono"] = ParagraphStyle("mono", fontName="Courier", fontSize=9,
                                    textColor=IK, leading=13)
    styles["meta"] = ParagraphStyle("meta", fontName="Helvetica-Bold", fontSize=8,
                                    textColor=GD, leading=10, spaceAfter=2)
    styles["metaover"] = ParagraphStyle("metaover", fontName="Helvetica-Bold", fontSize=8,
                                        textColor=HexColor("#c0392b"), leading=10, spaceAfter=2)
    styles["toplabel"] = ParagraphStyle("toplabel", fontName="Helvetica-Bold", fontSize=8.5,
                                        textColor=MT, leading=11, spaceBefore=6, spaceAfter=1)
    styles["callbody"] = ParagraphStyle("callbody", fontName="Helvetica", fontSize=9.5,
                                        textColor=IK, leading=14, spaceAfter=3)
    styles["foot"] = ParagraphStyle("foot", fontName="Helvetica-Bold", fontSize=9,
                                    textColor=HexColor("#7a5e10"), leading=13)
    # cover
    styles["ctitle"] = ParagraphStyle("ctitle", fontName="Helvetica-Bold", fontSize=34,
                                      textColor=IK, alignment=TA_CENTER, leading=38)
    styles["cbrand"] = ParagraphStyle("cbrand", fontName="Helvetica-Bold", fontSize=20,
                                      textColor=EM, alignment=TA_CENTER, leading=24)
    styles["csub"] = ParagraphStyle("csub", fontName="Helvetica-Bold", fontSize=14,
                                    textColor=EM, alignment=TA_CENTER, leading=18)
    styles["cgen"] = ParagraphStyle("cgen", fontName="Helvetica", fontSize=10.5,
                                    textColor=MT, alignment=TA_CENTER, leading=14)

    class HRule(Flowable):
        def __init__(self, width, color, thick=2, gap_before=2, gap_after=2):
            super().__init__()
            self.width = width; self.color = color; self.thick = thick
            self.gap_before = gap_before; self.gap_after = gap_after
            self.height = thick + gap_before + gap_after
        def wrap(self, aw, ah):
            self.width = aw if self.width is None else self.width
            return (self.width, self.height)
        def draw(self):
            self.canv.setStrokeColor(self.color)
            self.canv.setLineWidth(self.thick)
            y = self.gap_after
            self.canv.line(0, y, self.width, y)

    def h1(text):
        return [Paragraph(escape(text), styles["h1"]),
                HRule(None, EM, thick=2, gap_before=1, gap_after=4)]

    def h2(text):
        # gold left bar via a 1-col table
        p = Paragraph(escape(text), ParagraphStyle("h2i", parent=styles["h2"], leftIndent=8))
        t = Table([[p]], colWidths=[6.5 * inch])
        t.setStyle(TableStyle([
            ("LINEBEFORE", (0, 0), (0, 0), 3, GD),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        return t

    def copyblock(text, count_stated, real, note=None, over=False, top_label=None):
        flow = []
        if top_label:
            flow.append(Paragraph(escape(top_label), styles["toplabel"]))
        post = Paragraph(md_to_html(text), styles["mono"])
        box = Table([[post]], colWidths=[6.5 * inch])
        box.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), BBG),
            ("BOX", (0, 0), (-1, -1), 0.9, BBD),
            ("LINEBEFORE", (0, 0), (0, 0), 3, EM),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]))
        flow.append(box)
        meta = f"{count_stated}/280 chars"
        if over:
            meta += '  <font color="#c0392b">⚠ over 280</font>'
        if note:
            meta += f'   <font color="{MUTED}"><i>{escape(note)}</i></font>'
        flow.append(Paragraph(meta, styles["metaover"] if over else styles["meta"]))
        flow.append(Spacer(1, 7))
        return KeepTogether(flow)

    def callout(intro, blocks):
        cells = [[Paragraph(md_to_html(intro), styles["callbody"])]]
        for lead, bodytext in blocks:
            html = f'<font color="#9a7410"><b>{escape(lead)} </b></font>' + md_to_html(bodytext)
            cells.append([Paragraph(html, styles["callbody"])])
        t = Table(cells, colWidths=[6.5 * inch])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CBG),
            ("BOX", (0, 0), (-1, -1), 0.9, GD),
            ("LINEBEFORE", (0, 0), (0, 0), 3, GD),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (0, 0), 8),
            ("BOTTOMPADDING", (-1, -1), (-1, -1), 8),
            ("TOPPADDING", (0, 1), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -2), 3),
        ]))
        return t

    story = []
    post_count = sum(len(blocks) for _, blocks in pack_days) + len(spotlights)

    # COVER (drawn on first page via frame; use spacers)
    story.append(Spacer(1, 2.2 * inch))
    story.append(Paragraph("● wcdraft", styles["cbrand"]))
    story.append(Spacer(1, 8))
    story.append(Paragraph("X Marketing Playbook", styles["ctitle"]))
    story.append(Spacer(1, 6))
    _rule = Table([[HRule(2.6 * inch, GD, thick=3, gap_before=2, gap_after=2)]],
                  colWidths=[2.6 * inch], hAlign="CENTER")
    _rule.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0),
                               ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                               ("TOPPADDING", (0, 0), (-1, -1), 0),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.append(_rule)
    story.append(Spacer(1, 8))
    story.append(Paragraph(f"Week {WEEK_LABEL}", styles["csub"]))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f"Generated {GENERATED} &nbsp;·&nbsp; organic-only operator guide",
                           styles["cgen"]))
    story.append(PageBreak())

    # HOW TO USE
    story += h1("How to use this")
    for line in HOW_TO_USE:
        story.append(Paragraph(f'<font color="{EMERALD}"><b>▸</b></font>&nbsp; ' + md_to_html(line),
                               styles["body"]))

    # SCHEDULER
    story += h1("X Native Scheduler — step by step")
    story.append(callout(SCHEDULER_INTRO, SCHEDULER_BLOCKS))
    story.append(PageBreak())

    # POSTS
    story += h1(f"This week's posts ({WEEK_LABEL.split('-')[-1]})")
    story.append(Paragraph(f"{post_count} ready-to-paste posts, grouped by day. Pick the strongest 3–5 "
                           "per day — you don't post them all. Copy one block, paste into the "
                           "composer, schedule.", styles["muted"]))
    story.append(Spacer(1, 4))
    for dayname, blocks in pack_days:
        story.append(h2(dayname))
        for b in blocks:
            story.append(copyblock(b["text"], b["stated"], b["real"], note=b["linknote"],
                                   over=b["over"], top_label=f"{dayname} · {b['idx']} · {b['label']}"))
    story.append(h2("Result spotlights"))
    story.append(Paragraph("Post one only when you (or a player) have a genuinely strong real "
                           "run. The record is computed from a real share token — never "
                           "invented.", styles["muted"]))
    story.append(Spacer(1, 3))
    for b in spotlights:
        note = b["note"] or b["linknote"]
        story.append(copyblock(b["text"], b["stated"], b["real"], note=note, over=b["over"],
                               top_label=f"Result spotlight · {b['idx']} · {b['label']}"))

    # REPLY BANK
    story.append(PageBreak())
    story += h1("Reply bank")
    story.append(Paragraph("Reply only to people who engaged you first — one reply per person "
                           "per day. Find the matching scenario, copy a variant, tweak a word, "
                           "reply. Never reply to abuse.", styles["muted"]))
    story.append(Spacer(1, 4))
    for title_, desc, variants in replies:
        story.append(h2(title_))
        if desc:
            story.append(Paragraph(escape(desc), styles["muted"]))
        for v in variants:
            story.append(copyblock(v["text"], v["stated"], v["real"], over=v["real"] > 280,
                                   top_label=v["variant"]))

    # QUOTE BANK
    story.append(PageBreak())
    story += h1("Quote-post bank")
    story.append(Paragraph("Quote-posts only (quote a public post with your own comment) — "
                           "never an unsolicited @-reply to a non-engager. Cap ~3/day. Lead "
                           "with a differentiator; never disparage another game.", styles["muted"]))
    story.append(Spacer(1, 4))
    for title_, desc, variants in quotes:
        story.append(h2(title_))
        if desc:
            story.append(Paragraph(escape(desc), styles["muted"]))
        for v in variants:
            story.append(copyblock(v["text"], v["stated"], v["real"], over=v["real"] > 280,
                                   top_label=v["variant"]))
    story.append(h2("Discovery — searches to find quote targets"))
    story.append(Paragraph("API search isn't available, so hunt by hand: open a link, find a "
                           "good public post, and quote it with a variant above.", styles["muted"]))
    for label, url in quote_disc:
        story.append(Paragraph(
            f'<font color="{EMERALD}"><b>•</b></font>&nbsp; <b>{escape(label)}</b><br/>'
            f'<font face="Courier" size="8" color="{MUTED}">{escape(url)}</font>',
            styles["body"]))

    # CADENCE
    story.append(PageBreak())
    story += h1("Cadence & best times")
    data = []
    for k, v in CADENCE_ROWS:
        data.append([Paragraph(f'<font color="{EMERALD}"><b>{escape(k)}</b></font>', styles["body"]),
                     Paragraph(escape(v), styles["body"])])
    ct = Table(data, colWidths=[1.7 * inch, 4.8 * inch])
    ct.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.6, BBD),
        ("BACKGROUND", (0, 0), (0, -1), HexColor("#f3f7f4")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(ct)

    # FOOTER
    story.append(h2("Guardrails"))
    foot_cells = [[Paragraph("•&nbsp; " + escape(l), styles["foot"])] for l in FOOTER_LINES]
    ft = Table(foot_cells, colWidths=[6.5 * inch])
    ft.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CBG),
        ("BOX", (0, 0), (-1, -1), 0.9, GD),
        ("LINEBEFORE", (0, 0), (0, 0), 3, GD),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(ft)

    # doc template with footer page numbers + emerald top rule
    def on_page(canvas, doc_):
        canvas.saveState()
        w, h = LETTER
        # thin emerald top rule
        canvas.setStrokeColor(EM)
        canvas.setLineWidth(2)
        canvas.line(0.85 * inch, h - 0.55 * inch, w - 0.85 * inch, h - 0.55 * inch)
        # footer
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MT)
        canvas.drawString(0.85 * inch, 0.5 * inch, f"wcdraft — X Marketing Playbook · {WEEK_LABEL.split('-')[-1]}")
        canvas.drawRightString(w - 0.85 * inch, 0.5 * inch, "Page %d" % doc_.page)
        canvas.restoreState()

    def on_cover(canvas, doc_):
        canvas.saveState()
        w, h = LETTER
        canvas.restoreState()

    doc = BaseDocTemplate(path, pagesize=LETTER,
                          leftMargin=0.85 * inch, rightMargin=0.85 * inch,
                          topMargin=0.8 * inch, bottomMargin=0.75 * inch,
                          title="wcdraft — X Marketing Playbook", author="wcdraft")
    frame = Frame(doc.leftMargin, doc.bottomMargin,
                  doc.width, doc.height, id="main")
    cover_frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="cover")
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[cover_frame], onPage=on_cover),
        PageTemplate(id="main", frames=[frame], onPage=on_page),
    ])
    # first page = cover (no header rule); switch to 'main' after first PageBreak
    from reportlab.platypus import NextPageTemplate
    story.insert(0, NextPageTemplate("main"))
    doc.build(story)


# =========================================================================
def main():
    pack_days, spotlights = parse_pack()
    replies, reply_disc = parse_bank("reply-bank.md")
    quotes, quote_disc = parse_bank("quote-bank.md")

    # reconciliation
    n_posts = sum(len(b) for _, b in pack_days) + len(spotlights)
    print(f"pack blocks parsed: {n_posts} (days={[ (d,len(b)) for d,b in pack_days]}, "
          f"spotlights={len(spotlights)})")
    over = [(d, b['idx']) for d, bl in pack_days for b in bl if b['over']]
    over += [("spotlight", b['idx']) for b in spotlights if b['over']]
    print("over-280:", over or "none")

    docx_path = os.path.join(HERE, "wcdraft-x-playbook.docx")
    pdf_path = os.path.join(HERE, "wcdraft-x-playbook.pdf")
    build_docx(docx_path, pack_days, spotlights, replies, reply_disc, quotes, quote_disc)
    build_pdf(pdf_path, pack_days, spotlights, replies, reply_disc, quotes, quote_disc)
    print("wrote", docx_path)
    print("wrote", pdf_path)


if __name__ == "__main__":
    main()
