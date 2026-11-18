"""Find every math question (and its figures / shared stems) on the scanned pages.

Usage:  python pipeline/segment.py <pdf> [<pdf> ...]
Needs:  pipeline/work/<sha12>/ocr.json (or the per-page cache) from ocr_pdf.py
Writes: pipeline/work/<sha12>/geometry.json   regions per question, group stems, directions
        pipeline/work/<sha12>/overlay-pXX.png  pages with numbered boxes, for checking by eye

Method (per section, pages in order, left column then right column):
  * a full-width horizontal rule near the top of a page ends a directions box;
  * each column is cut into ink blocks separated by vertical white gaps;
  * a block that holds a question number starts that question;
  * after a five-choice question's "(E)" line, further blocks are lead-ins for the
    next question (figure "above", or a "Questions x-y refer to ..." stem);
  * numbers OCR missed are recovered by re-reading only the number gutter, and the
    whole section must come out numbered 1..N in order or the script says so.
"""
import json, os, re, sys

import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
DPI = 150
COLS = [(0.050, 0.492), (0.500, 0.950)]  # page-fraction x ranges of the two columns
GUTTER = [(0.050, 0.100), (0.500, 0.552)]  # where question numbers sit
INK = 165  # gray level below which a pixel counts as ink
NUM_RE = re.compile(r"^[\*\-'\":;,.]?(\d{1,2})[.,:]?$")
NUM_LEAD_RE = re.compile(r"^(\d{1,2})[.,]\s*\S")


def load_ocr(work):
    path = os.path.join(work, "ocr.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def gray(page):
    pix = page.get_pixmap(dpi=DPI, colorspace=pymupdf.csGRAY)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)


def long_rules(img, min_frac=0.55):
    """y (fraction) of horizontal rules spanning a large part of the page."""
    h, w = img.shape
    dark = img < INK
    ys = []
    for y in range(h):
        row = dark[y]
        if row.sum() < min_frac * w:
            continue
        # longest run
        d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
        starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
        if len(starts) and (ends - starts).max() >= min_frac * w:
            ys.append(y / h)
    merged = []
    for y in ys:
        if merged and y - merged[-1][-1] < 0.004:
            merged[-1].append(y)
        else:
            merged.append([y])
    return [(g[0], g[-1]) for g in merged]


def word_columns(words, top, bottom):
    """Columns from OCR word boxes: rules and figures are not words, so the white gap
    between the two text columns shows up cleanly."""
    ws = [w for w in words if w[1] >= top - 0.002 and w[3] <= bottom + 0.002 and (w[2] - w[0]) < 0.48]
    if len(ws) < 8:
        return None
    left = min(w[0] for w in ws)
    right = max(w[2] for w in ws)
    grid = np.zeros(1000, bool)
    for w in ws:
        grid[int(w[0] * 1000):int(np.ceil(w[2] * 1000))] = True
    best, start = (0, 0), None
    for x in range(380, 621):
        if not grid[x]:
            start = x if start is None else start
        else:
            if start is not None and x - start > best[1] - best[0]:
                best = (start, x)
            start = None
    if start is not None and 621 - start > best[1] - best[0]:
        best = (start, 621)
    if best[1] - best[0] < 12:
        return None
    return (max(0.0, left - 0.006), best[0] / 1000 + 0.004), (best[1] / 1000 - 0.006, min(1.0, right + 0.006))


def page_columns(img, top, bottom):
    """Find this page's two text columns from its ink profile (scans shift left/right
    between odd and even pages). Returns ((L0, L1), (R0, R1)) as page fractions."""
    h, w = img.shape
    body = img[int(top * h):int(bottom * h)] < INK
    prof = body.sum(axis=0).astype(float)
    # a printed vertical rule between the columns (comparison pages) is not text: drop it
    tall = prof > 0.45 * body.shape[0]
    for x in np.where(tall)[0]:
        prof[max(0, x - 3):x + 4] = 0
    k = max(3, w // 200)
    prof = np.convolve(prof, np.ones(k) / k, mode="same")
    on = prof > 1.0
    xs = np.where(on)[0]
    if len(xs) == 0:
        return COLS[0], COLS[1]
    left, right = xs[0] / w, xs[-1] / w
    # widest white run in the middle third = the gap between the columns
    lo, hi = int(0.38 * w), int(0.62 * w)
    best, run_start, best_span = None, None, (0, 0)
    for x in range(lo, hi):
        if not on[x]:
            if run_start is None:
                run_start = x
        else:
            if run_start is not None and x - run_start > best_span[1] - best_span[0]:
                best_span = (run_start, x)
            run_start = None
    if run_start is not None and hi - run_start > best_span[1] - best_span[0]:
        best_span = (run_start, hi)
    if best_span[1] - best_span[0] < 0.01 * w:
        mid0 = mid1 = 0.5
    else:
        mid0, mid1 = best_span[0] / w, best_span[1] / w
    return (max(0.0, left - 0.004), mid0 + 0.002), (mid1 - 0.004, min(1.0, right + 0.004))


def ink_blocks(img, x0, x1, y0, y1, gap=0.0085, min_rows=2):
    """Vertical blocks of ink inside a column window. Returns [(ya, yb, xa, xb)] fractions."""
    h, w = img.shape
    X0, X1, Y0, Y1 = int(x0 * w), int(x1 * w), int(y0 * h), int(y1 * h)
    sub = img[Y0:Y1, X0:X1] < INK
    rows = sub.sum(axis=1) >= 2
    # a thin rule spanning most of the column (between comparison items, under a question)
    # is a separator, not content
    width = max(1, X1 - X0)
    rule_rows = np.zeros(len(rows), bool)
    for i in np.where(rows)[0]:
        r = sub[i]
        if r.sum() > 0.5 * width:
            d = np.diff(np.concatenate([[0], r.astype(np.int8), [0]]))
            st, en = np.where(d == 1)[0], np.where(d == -1)[0]
            if len(st) and (en - st).max() > 0.5 * width and r.sum() < 1.15 * (en - st).max():
                rows[i] = False
                rule_rows[i] = True
    gap_px = int(gap * h)
    blocks, start, last = [], None, None
    for i, on in enumerate(rows):
        if rule_rows[i] and start is not None:  # a rule always ends the block above it
            blocks.append((start, last))
            start = None
            continue
        if on:
            if start is None:
                start = i
            elif i - last > gap_px:
                blocks.append((start, last))
                start = i
            last = i
    if start is not None:
        blocks.append((start, last))
    out = []
    for a, b in blocks:
        if b - a + 1 < min_rows:
            continue
        cols = np.where(sub[a:b + 1].any(axis=0))[0]
        out.append(((Y0 + a) / h, (Y0 + b + 1) / h, (X0 + cols.min()) / w, (X0 + cols.max() + 1) / w))
    return out


def is_rule_block(img, blk):
    """A thin horizontal line between questions (no text)."""
    ya, yb, xa, xb = blk
    return (yb - ya) < 0.0045 and (xb - xa) > 0.2


def words_in(words, x0, x1, y0, y1, pad=0.002):
    return [wd for wd in words if wd[0] >= x0 - 0.01 and wd[2] <= x1 + 0.03 and y0 - pad <= (wd[1] + wd[3]) / 2 <= y1 + pad]


def anchor_tokens(words, cols, col):
    c0 = cols[col][0]
    g0, g1 = c0, c0 + 0.052
    out = []
    for x0, y0, x1, y1, conf, t in words:
        t2 = t.strip().replace("l", "1").replace("I", "1").replace("O", "0")
        m = NUM_RE.match(t2) or NUM_LEAD_RE.match(t2)
        if m and g0 - 0.006 <= x0 <= g1 - 0.012 and (y1 - y0) < 0.03:
            out.append({"n": int(m.group(1)), "y0": y0, "y1": y1, "x0": x0})
    return out


def gutter_candidates(w):
    """Lines whose first ink is a short run flush with the column's left edge, followed by
    a space and more text: the shape of a question number such as '2.' or '17.'"""
    img = w["img"]
    h, W = img.shape
    c0, c1 = w["cols"][w["col"]]
    X0, X1 = int(c0 * W), int(c1 * W)
    Y0, Y1 = int(w["top"] * h), int(w["bottom"] * h)
    sub = img[Y0:Y1, X0:X1] < INK
    rows = sub.sum(axis=1) > 0
    lines, start = [], None
    for i, on in enumerate(list(rows) + [False]):
        if on and start is None:
            start = i
        elif not on and start is not None:
            if 0.005 * h <= i - start <= 0.03 * h:
                lines.append((start, i))
            start = None
    out = []
    for a, b in lines:
        colink = sub[a:b].any(axis=0)
        xs = np.where(colink)[0]
        if not len(xs):
            continue
        first = xs[0]
        if not (-0.002 * W <= first <= 0.022 * W):
            continue
        # end of the first run (stop at a gap of >= 0.006 W)
        gap_px = int(0.006 * W)
        x, last = first, first
        while x < len(colink) and x - last <= gap_px:
            if colink[x]:
                last = x
            x += 1
        run_w = last - first
        rest = xs[xs > last + gap_px]
        if run_w <= 0.03 * W and len(rest) and rest[0] - last < 0.05 * W:
            y = (Y0 + a) / h
            line_words = [wd for wd in w["words"] if abs(wd[1] - y) < 0.01 and c0 - 0.01 <= wd[0] <= c1]
            txt = " ".join(wd[5] for wd in sorted(line_words, key=lambda t: t[0]))
            if re.match(r"^\s*\(", txt) or re.match(r"^\s*Questions", txt, re.I) or re.match(r"^\s*Column", txt, re.I):
                continue
            out.append({"y0": y, "y1": (Y0 + b) / h, "x0": c0 + first / W, "geometric": True})
    return out


GUTTER_CACHE = {}


def recover_numbers(engine, page, cols, col, y0, y1):
    """Re-OCR just the number gutter of one column window (cached per crop)."""
    key = f"{page.number}:{round(cols[col][0], 3)}:{round(y0, 3)}:{round(y1, 3)}"
    if key not in GUTTER_CACHE:
        GUTTER_CACHE[key] = _recover_numbers(engine, page, cols, col, y0, y1)
    return [dict(a) for a in GUTTER_CACHE[key]]


def _recover_numbers(engine, page, cols, col, y0, y1):
    g0, g1 = cols[col][0], cols[col][0] + 0.046
    r = page.rect
    clip = pymupdf.Rect(r.x0 + (g0 - 0.012) * r.width, r.y0 + y0 * r.height, r.x0 + (g1 + 0.004) * r.width, r.y0 + y1 * r.height)
    if clip.height < 5:
        return []
    pix = page.get_pixmap(dpi=200, colorspace=pymupdf.csRGB, clip=clip)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    pad = np.full((pix.height + 40, pix.width + 40, 3), 255, np.uint8)
    pad[20:-20, 20:-20] = img
    res, _ = engine(pad, use_cls=False)
    out = []
    for box, text, conf in res or []:
        t2 = str(text).strip().replace("l", "1").replace("I", "1").replace("O", "0")
        m = NUM_RE.match(t2) or NUM_LEAD_RE.match(t2)
        if not m:
            continue
        ys = [p[1] - 20 for p in box]
        fy0 = y0 + min(ys) / pix.height * (y1 - y0)
        fy1 = y0 + max(ys) / pix.height * (y1 - y0)
        if (max(p[0] for p in box) - min(p[0] for p in box)) > 0.9 * pix.width:
            continue  # spans the whole strip: not a lone number
        out.append({"n": int(m.group(1)), "y0": fy0, "y1": fy1, "x0": g0, "recovered": True})
    return out


def segment_section(doc, ocr, sec, engine, log):
    """Returns questions {n: {...}}, groups, directions."""
    pages = sec["pages"]
    count = sec["count"]
    qc_range = range(8, 28) if count == 35 else range(0)
    windows = []  # (page, col, ytop, ybot, words, img)
    directions = []
    for pno in pages:
        page = doc[pno - 1]
        img = gray(page)
        words = ocr["pages"].get(str(pno), [])
        rules = [r for r in long_rules(img) if r[0] < 0.6]
        top = 0.055
        if rules:
            top = rules[-1][1] + 0.004
            directions.append({"page": pno, "box": [0.06, 0.055, 0.94, round(rules[-1][1] + 0.003, 4)]})
        # directions printed without a full-width rule (comparison summary, "solve each of the remaining")
        for wd in words:
            flat = re.sub(r"\s+", "", wd[5]).lower()
            if wd[1] < 0.45 and any(k in flat for k in ("summarydirections", "responsewillnot", "solveeachofthe", "bestofthechoices", "ovalontheanswer", "fillinthecorresponding", "realnumbers", "otherwiseindicated")):
                if wd[3] + 0.006 > top:
                    top = wd[3] + 0.006
                    if directions and directions[-1]["page"] == pno:
                        directions[-1]["box"][3] = round(max(directions[-1]["box"][3], wd[3] + 0.004), 4)
                    else:
                        directions.append({"page": pno, "box": [0.06, 0.055, 0.94, round(wd[3] + 0.004, 4)]})
        # bottom: GO ON / STOP / IF YOU FINISH, else page number zone
        bottoms = [0.955, 0.955]
        for wd in words:  # the page number sits in a bottom corner
            if wd[1] > 0.925 and re.fullmatch(r"\d{1,3}", wd[5].strip()):
                c = 0 if wd[0] < 0.5 else 1
                bottoms[c] = min(bottoms[c], wd[1] - 0.006)
        for wd in words:
            flat = re.sub(r"\s+", "", wd[5]).upper()
            if any(k in flat for k in ("GOONTO", "NEXTPAGE", "STOP", "IFYOUFINISH", "DONOTTURN", "CHECKYOURWORK")) and wd[1] > 0.4:
                full = (wd[2] - wd[0]) > 0.4 or "IFYOUFINISH" in flat or "CHECKYOUR" in flat
                for c in (0, 1):
                    if full or (c == 1 and wd[0] > 0.45) or (c == 0 and wd[2] < 0.55):
                        bottoms[c] = min(bottoms[c], wd[1] - 0.012)
        bottom = max(bottoms)
        cols = word_columns(words, top, bottom) or page_columns(img, top, bottom)
        for col in (0, 1):
            windows.append({"page": pno, "col": col, "cols": cols, "top": top, "bottom": bottoms[col], "words": words, "img": img})

    # anchors from OCR
    for w in windows:
        w["anchors"] = [a for a in anchor_tokens(w["words"], w["cols"], w["col"]) if w["top"] - 0.005 <= a["y0"] <= w["bottom"]]
    for w in windows:
        if w["col"] == 0:
            log(f"    p{w['page']}: columns {[(round(a, 3), round(b, 3)) for a, b in w['cols']]} body {w['top']:.3f}-{w['bottom']:.3f}")
    found = sorted({a["n"] for w in windows for a in w["anchors"]})
    missing = [n for n in range(1, count + 1) if n not in found]
    if missing:
        log(f"    section {sec['number']}: OCR missed numbers {missing}; re-reading gutters")
        for w in windows:
            extra = recover_numbers(engine, doc[w["page"] - 1], w["cols"], w["col"], w["top"], w["bottom"])
            for a in extra:
                if a["n"] in missing and not any(abs(a["y0"] - b["y0"]) < 0.01 for b in w["anchors"]):
                    w["anchors"].append(a)
    # keep only a consistent increasing sequence in reading order
    seq = []
    for w in windows:
        for a in sorted(w["anchors"], key=lambda a: a["y0"]):
            seq.append((w, a))
    # longest strictly increasing run of numbers in reading order: a stray "12" read from a
    # fraction cannot outvote six real numbers that follow it
    seq = [(w, a) for (w, a) in seq if 1 <= a["n"] <= count]
    best_len = [1] * len(seq)
    prev = [-1] * len(seq)
    for i in range(len(seq)):
        for j in range(i):
            if seq[j][1]["n"] < seq[i][1]["n"] and best_len[j] + 1 > best_len[i]:
                best_len[i], prev[i] = best_len[j] + 1, j
    cleaned = []
    if seq:
        i = max(range(len(seq)), key=lambda k: (best_len[k], -seq[k][1]["n"]))
        while i != -1:
            cleaned.append(seq[i])
            i = prev[i]
        cleaned.reverse()
    dropped = [(w["page"], a["n"]) for (w, a) in seq if not any(a is b for _, b in cleaned)]
    if dropped:
        log(f"    ignored out-of-sequence number tokens {dropped}")
    for w in windows:
        w["anchors"] = [a for (ww, a) in cleaned if ww is w]
    got = [a["n"] for _, a in cleaned]
    if got != list(range(1, count + 1)):
        # fill gaps with geometric candidates when the count matches exactly
        order = {id(w): i for i, w in enumerate(windows)}
        cands = []
        for w in windows:
            for c in gutter_candidates(w):
                if not any(abs(c["y0"] - a["y0"]) < 0.012 for a in w["anchors"]):
                    cands.append((order[id(w)], c["y0"], w, c))
        cands.sort(key=lambda t: (t[0], t[1]))
        pos = [(order[id(w)], a["y0"], a["n"]) for w, a in cleaned]
        bounds = [(-1, -1.0, 0)] + pos + [(len(windows), 9.0, count + 1)]
        for (wa, ya, na), (wb, yb, nb) in zip(bounds, bounds[1:]):
            need = nb - na - 1
            if need <= 0:
                continue
            between = [t for t in cands if (t[0], t[1]) > (wa, ya + 0.005) and (t[0], t[1]) < (wb, yb - 0.005)]
            if len(between) > need:
                # prefer candidates that begin a block of ink (a new question), not a figure label
                starts = []
                for t in between:
                    w = t[2]
                    blks = ink_blocks(w["img"], *w["cols"][w["col"]], w["top"], w["bottom"])
                    if any(abs(b[0] - t[1]) < 0.007 for b in blks):
                        starts.append(t)
                if len(starts) == need:
                    between = starts
            if len(between) == need:
                for k, (_, _, w, c) in enumerate(between):
                    c["n"] = na + 1 + k
                    w["anchors"].append(c)
                    log(f"    recovered #{c['n']} by shape on p{w['page']} at y={c['y0']:.3f}")
            else:
                log(f"    could not place {list(range(na + 1, nb))}: {len(between)} shape candidates between #{na} and #{nb}")
        got = sorted(a["n"] for w in windows for a in w["anchors"])
    if got != list(range(1, count + 1)):
        log(f"    !! section {sec['number']} numbering incomplete: missing {[n for n in range(1, count + 1) if n not in got]}")

    questions = {}
    groups = {}
    pending = []  # lead-in blocks waiting for the next question
    current = None
    for w in windows:
        x0, x1 = w["cols"][w["col"]]
        blocks = ink_blocks(w["img"], x0, x1, w["top"], w["bottom"])
        anchors = sorted(w["anchors"], key=lambda a: a["y0"])
        for blk in blocks:
            if is_rule_block(w["img"], blk):
                continue
            ya, yb = blk[0], blk[1]
            hit = [a for a in anchors if ya - 0.006 <= a["y0"] <= yb]
            if hit:
                # a block may contain more than one number (tight QC items): split at numbers
                cuts = [a["y0"] - 0.004 for a in hit] + [yb]
                if ya < cuts[0] - 0.003 and current is not None and not done(current, qc_range):
                    add_region(current, w, (ya, cuts[0]))
                elif ya < cuts[0] - 0.003:
                    pending.append((w, (ya, cuts[0])))
                for i, a in enumerate(hit):
                    current = questions.setdefault(a["n"], {"n": a["n"], "regions": [], "lead": [], "words": []})
                    for pw, (pa, pb) in pending:
                        current["lead"].append((pw, (pa, pb)))
                    pending = []
                    add_region(current, w, (max(ya, cuts[i]) if i else min(ya, a["y0"] - 0.004), cuts[i + 1]))
                continue
            # no number in this block
            if current is not None and not pending and not done(current, qc_range) and not starts_group(w["words"], blk):
                add_region(current, w, (ya, yb))
            else:
                pending.append((w, (ya, yb)))
    # lead-in blocks → group stems or figures above. A lead-in must sit on the same page as
    # its question and be more than a sliver (arrow tips, box borders).
    for n, q in sorted(questions.items()):
        if q["regions"]:
            qpage = q["regions"][0][0]["page"]
            def has_text(w, a, b):
                c0, c1 = w["cols"][w["col"]]
                return any(a - 0.002 <= (wd[1] + wd[3]) / 2 <= b + 0.002 and c0 - 0.01 <= wd[0] <= c1 for wd in w["words"])
            q["lead"] = [(w, (a, b)) for (w, (a, b)) in q["lead"]
                         if w["page"] == qpage and ((b - a) >= 0.012 or has_text(w, a, b))]
        if not q["lead"]:
            continue
        text = " ".join(t for (w, (a, b)) in q["lead"] for t in [" ".join(wd[5] for wd in words_in(w["words"], *w["cols"][w["col"]], a, b))])
        m = re.search(r"Questions?\s*(\d{1,2})\s*[-–—]\s*(\d{1,2})", text.replace(" ", " "), re.I) or \
            re.search(r"Questions(\d{1,2})[-–—](\d{1,2})", re.sub(r"\s+", "", text), re.I)
        if m and int(m.group(1)) == n:
            gid = f"S{sec['number']}-G{n}"
            groups[gid] = {"label": f"Questions {m.group(1)}–{m.group(2)}", "regions": [region(w, ab) for (w, ab) in q["lead"]]}
            for k in range(int(m.group(1)), int(m.group(2)) + 1):
                if k in questions:
                    questions[k]["group"] = gid
        else:
            q["regions"] = [(w, ab) for (w, ab) in q["lead"]] + q["regions"]
    out = {}
    for n, q in questions.items():
        regs = merge_regions([region(w, ab) for (w, ab) in q["regions"]])
        out[n] = {"n": n, "type": "qc4" if n in qc_range else "mc5", "regions": regs}
        if q.get("group"):
            out[n]["group"] = q["group"]
    return out, groups, directions


def starts_group(words, blk):
    ya, yb = blk[0], blk[1]
    text = re.sub(r"\s+", "", " ".join(wd[5] for wd in words if ya - 0.002 <= (wd[1] + wd[3]) / 2 <= yb + 0.002))
    return bool(re.search(r"Questions?\d{1,2}[-–—]\d{1,2}refer", text, re.I))


def add_region(q, w, ab):
    q["regions"].append((w, ab))
    a, b = ab
    q["words"] += [wd for wd in w["words"] if a - 0.002 <= (wd[1] + wd[3]) / 2 <= b + 0.002 and w["cols"][w["col"]][0] - 0.01 <= wd[0] <= w["cols"][w["col"]][1]]


def done(q, qc_range):
    """Has this question's content finished? Five-choice: its (E) line has been seen."""
    if q["n"] in qc_range:
        return True
    return any(re.search(r"\(\s*[Ee£]\s*\)", wd[5]) for wd in q["words"])


def region(w, ab):
    """Tight box around the ink of one column window between y=a..b."""
    a, b = ab
    x0, x1 = w["cols"][w["col"]]
    blks = ink_blocks(w["img"], x0, x1, a, b, gap=1.0)
    if blks:
        ya, yb, xa, xb = blks[0]
        a, b = max(a, ya), min(b, yb)
        x0, x1 = max(x0, xa), min(x1, xb)
    pad = 0.006
    return {"page": w["page"], "box": [round(max(0, x0 - pad), 4), round(max(0, a - pad), 4), round(min(1, x1 + pad), 4), round(min(1, b + pad), 4)]}


def merge_regions(regs):
    """Merge vertically adjacent regions on the same page and column."""
    out = []
    for r in regs:
        if out and out[-1]["page"] == r["page"] and abs(out[-1]["box"][0] - r["box"][0]) < 0.25 and r["box"][1] - out[-1]["box"][3] < 0.03:
            b = out[-1]["box"]
            out[-1]["box"] = [min(b[0], r["box"][0]), min(b[1], r["box"][1]), max(b[2], r["box"][2]), max(b[3], r["box"][3])]
        else:
            out.append(dict(r))
    return out


def overlay(doc, pno, questions, groups, directions, path):
    page = doc[pno - 1]
    pix = page.get_pixmap(dpi=90, colorspace=pymupdf.csRGB)
    im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    dr = ImageDraw.Draw(im, "RGBA")
    W, H = im.size
    try:
        font = ImageFont.truetype("arialbd.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
    colors = [(220, 40, 40), (30, 120, 220), (20, 150, 60), (200, 120, 0), (150, 40, 180)]
    for d in directions:
        if d["page"] == pno:
            x0, y0, x1, y1 = d["box"]
            dr.rectangle([x0 * W, y0 * H, x1 * W, y1 * H], outline=(120, 120, 120, 255), width=3, fill=(120, 120, 120, 30))
    for gid, g in groups.items():
        for r in g["regions"]:
            if r["page"] == pno:
                x0, y0, x1, y1 = r["box"]
                dr.rectangle([x0 * W, y0 * H, x1 * W, y1 * H], outline=(0, 150, 150, 255), width=3, fill=(0, 150, 150, 35))
                dr.text((x1 * W - 70, y0 * H + 2), gid.split("-")[-1], fill=(0, 120, 120, 255), font=font)
    for n, q in sorted(questions.items()):
        c = colors[n % len(colors)]
        for r in q["regions"]:
            if r["page"] == pno:
                x0, y0, x1, y1 = r["box"]
                dr.rectangle([x0 * W, y0 * H, x1 * W, y1 * H], outline=c + (255,), width=3, fill=c + (28,))
                dr.text((x1 * W - 34, y0 * H + 2), str(n), fill=c + (255,), font=font)
    im.save(path)


def main(paths):
    from rapidocr_onnxruntime import RapidOCR
    engine = RapidOCR()
    import hashlib
    for p in paths:
        digest = hashlib.sha256(open(p, "rb").read()).hexdigest()
        work = os.path.join(HERE, "work", digest[:12])
        ocr = load_ocr(work)
        doc = pymupdf.open(p)
        cache_path = os.path.join(work, "gutter-cache.json")
        GUTTER_CACHE.clear()
        if os.path.exists(cache_path):
            GUTTER_CACHE.update(json.load(open(cache_path, encoding="utf-8")))
        log = lambda m: print(m, flush=True)
        log(f"{os.path.basename(p)} ({digest[:12]})")
        result = {"sha256": digest, "pageCount": doc.page_count, "sections": []}
        for sec in ocr["mathSections"]:
            qs, groups, directions = segment_section(doc, ocr, sec, engine, log)
            log(f"  section {sec['number']}: {len(qs)}/{sec['count']} questions, {len(groups)} shared stems, pages {sec['pages']}")
            result["sections"].append({"number": sec["number"], "count": sec["count"], "pages": sec["pages"], "directions": directions,
                                       "questions": [qs[k] for k in sorted(qs)], "groups": groups})
            for pno in sec["pages"]:
                overlay(doc, pno, qs, groups, directions, os.path.join(work, f"overlay-p{pno:02d}.png"))
        with open(os.path.join(work, "geometry.json"), "w", encoding="utf-8") as f:
            json.dump(result, f, indent=1)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(GUTTER_CACHE, f)
        log(f"  wrote {work}/geometry.json")


if __name__ == "__main__":
    main(sys.argv[1:])
