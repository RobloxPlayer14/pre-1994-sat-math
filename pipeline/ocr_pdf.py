"""OCR the mathematics pages of a scanned pre-1994 SAT booklet and cache word boxes.

Usage:  python pipeline/ocr_pdf.py <pdf> [<pdf> ...]
Output: pipeline/work/<sha256[:12]>/ocr.json   (git-ignored: contains test text)

Two passes, fully offline (RapidOCR + ONNX):
  1. OCR only the top strip of every page to find section starts, the big section
     number printed in each page corner, the answer-key page and the conversion table.
  2. OCR the whole page for every mathematics page plus the key and table pages.
Each page result is cached on its own, so an interrupted run resumes where it stopped.
Coordinates are page fractions (0..1).
"""
import hashlib, json, os, re, sys, time

import numpy as np
import pymupdf
from rapidocr_onnxruntime import RapidOCR

HERE = os.path.dirname(os.path.abspath(__file__))
DPI = 150
BAND = 0.20  # top fraction of the page read in pass 1


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def page_image(page, clip_frac=None, dpi=DPI):
    rect = page.rect
    clip = None
    if clip_frac:
        clip = pymupdf.Rect(rect.x0, rect.y0, rect.x1, rect.y0 + rect.height * clip_frac)
    pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB, clip=clip)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    return img, pix.width, pix.height


def ocr_image(engine, img, w, h, page_w, page_h, y_offset=0.0):
    """Return words as [x0,y0,x1,y1,conf,text] in page fractions."""
    res, _ = engine(img, use_cls=False)
    out = []
    for box, text, conf in res or []:
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        out.append([
            round(min(xs) / page_w, 5), round(y_offset + min(ys) / page_h, 5),
            round(max(xs) / page_w, 5), round(y_offset + max(ys) / page_h, 5),
            round(float(conf), 3), text,
        ])
    return out


def cached(path, compute):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    data = compute()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return data


def read_section_number(engine, page, section_box):
    """The big bold numeral after the word SECTION is often missed by detection;
    recognise a tight crop of it instead."""
    x0, y0, x1, y1 = section_box
    r = page.rect
    clip = pymupdf.Rect(r.x0 + x1 * r.width, r.y0 + (y0 - 0.025) * r.height,
                        r.x0 + (x1 + 0.065) * r.width, r.y0 + (y1 + 0.012) * r.height)
    pix = page.get_pixmap(dpi=300, colorspace=pymupdf.csRGB, clip=clip)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    for kwargs in ({"use_det": False, "use_cls": False}, {}):
        res, _ = engine(img, **kwargs)
        for item in res or []:
            text = item[1] if len(item) == 3 else item[0]
            m = re.search(r"[1-7]", str(text))
            if m:
                return int(m.group(0))
    return None


def classify(bands, doc, engine):
    """Use the header strips to find math sections, key and table pages."""
    info = []
    for i, words in enumerate(bands):
        text = " ".join(w[5] for w in words)
        flat = re.sub(r"\s+", "", text).lower()
        q = re.search(r"(\d{2})\s*Questions", text, re.I)
        sec_box = next((w[:4] for w in words if re.fullmatch(r"SECTION\d?", w[5].strip(), re.I)), None)
        info.append({
            "page": i + 1,
            "questions": int(q.group(1)) if q else None,
            "isMathStart": bool(q) and int(q.group(1)) in (25, 35) and "solveeachproblem" in flat,
            "sectionBox": sec_box,
            "key": "correctanswers" in flat,
            "table": "conversiontable" in flat,
            "worksheet": "scoringworksheet" in flat,
            "header": text[:160],
        })
    starts = [p for p in info if p["questions"]]
    end_page = next((p["page"] for p in info if p["key"] or p["table"] or p["worksheet"]), len(info) + 1)
    math_sections = []
    for idx, s in enumerate(starts):
        nxt = starts[idx + 1]["page"] if idx + 1 < len(starts) else end_page
        number = None  # filled in from the answer-key page after full OCR
        s["sectionNumber"] = number
        for p in info:
            if s["page"] <= p["page"] < min(nxt, end_page):
                p["section"] = number
                p["sectionStartPage"] = s["page"]
                p["math"] = s["isMathStart"]
        if s["isMathStart"]:
            math_sections.append({"number": number, "count": s["questions"], "startPage": s["page"],
                                  "pages": list(range(s["page"], min(nxt, end_page)))})
    for p in info:
        p.setdefault("math", False)
    return info, math_sections


def ocr_pdf(path, engine):
    digest = sha256(path)
    out_dir = os.path.join(HERE, "work", digest[:12])
    pages_dir = os.path.join(out_dir, "pages")
    os.makedirs(pages_dir, exist_ok=True)
    doc = pymupdf.open(path)
    pw, ph = doc[0].rect.width, doc[0].rect.height
    t0 = time.time()

    bands = []
    for i, page in enumerate(doc):
        def band(page=page):
            img, w, h = page_image(page, BAND, dpi=110)
            full_h = h / BAND
            return ocr_image(engine, img, w, h, w, full_h)
        bands.append(cached(os.path.join(pages_dir, f"band{i + 1:02d}.json"), band))
    info, math_sections = classify(bands, doc, engine)
    targets = [p["page"] for p in info if p["math"] or p["key"] or p["table"] or p["worksheet"]]
    summary = [(s["number"], s["count"], s["pages"]) for s in math_sections]
    print(f"{os.path.basename(path)}: math sections {summary}, full-OCR pages {targets} ({time.time() - t0:.0f}s)", flush=True)

    full = {}
    for pno in targets:
        def run(pno=pno):
            img, w, h = page_image(doc[pno - 1])
            return ocr_image(engine, img, w, h, w, h)
        t = time.time()
        full[pno] = cached(os.path.join(pages_dir, f"full{pno:02d}.json"), run)
        print(f"  p{pno}: {len(full[pno])} boxes {time.time() - t:.0f}s", flush=True)

    key_pages = [p["page"] for p in info if p["key"]]
    for kp in key_pages:
        words = full.get(kp, [])
        mx = next((w[0] for w in words if "MATHEMATICAL" in w[5].upper()), None)
        if mx is None:
            continue
        cols = sorted((w[0], int(m.group(1))) for w in words
                      for m in [re.fullmatch(r"Section\s*([1-9])", w[5].strip(), re.I)] if m and w[0] > mx - 0.04)
        for sec, (_, num) in zip(math_sections, cols):
            sec["number"] = num
        break
    print("  section numbers:", [s_["number"] for s_ in math_sections], flush=True)

    data = {
        "sha256": digest, "file": os.path.basename(path), "pageCount": doc.page_count,
        "pageSize": [pw, ph], "dpi": DPI, "mathSections": math_sections, "pageInfo": info,
        "pages": {str(k): v for k, v in full.items()},
    }
    with open(os.path.join(out_dir, "ocr.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"wrote {out_dir}/ocr.json in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    eng = RapidOCR()
    for p in sys.argv[1:]:
        ocr_pdf(p, eng)
