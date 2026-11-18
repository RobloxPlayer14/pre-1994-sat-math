"""Merge auto-detected geometry with hand-verified metadata into the files the site ships.

Usage:  python pipeline/build_tests.py
Reads:  pipeline/meta/form-*.json            answer key, conversion table, topics, explanations,
                                              and any manual region overrides (committed)
        pipeline/work/<sha12>/geometry.json  question regions found by segment.py (not committed)
Writes: data/tests/form-<code>.json and data/catalog.json

Published files contain no question text: only page regions, answers, tags,
original explanations and the conversion table.
"""
import glob, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# Each group of questions on the old SAT ran roughly from easiest to hardest.
def blocks_for(count):
    return [(1, 25, "mc5")] if count == 25 else [(1, 7, "mc5"), (8, 27, "qc4"), (28, 35, "mc5")]


def difficulty(n, count):
    for a, b, _ in blocks_for(count):
        if a <= n <= b:
            k = b - a + 1
            return 1 + min(4, (n - a) * 5 // k)
    return 3


KEYWORDS = [  # first-pass topic guess, always reviewed by hand (meta "topics" overrides)
    ("circles", r"circle|radius|diameter|circumference|arc\b|\bπ|\bpi\b"),
    ("triangles", r"triangle|hypotenuse|isosceles|equilateral|right angle"),
    ("solids", r"cube|volume|rectangular solid|cylinder|box"),
    ("coordinates", r"coordinate|xy-plane|\(\s*-?\d+\s*,\s*-?\d+\s*\)|slope|origin"),
    ("polygons-area", r"rectangle|square|area|perimeter|parallelogram|polygon|hexagon|trapezoid"),
    ("angles-lines", r"angle|parallel|perpendicular|line segment|midpoint|degree"),
    ("averages", r"average|arithmetic mean|\bmean\b"),
    ("percents", r"percent|%"),
    ("ratios-rates", r"ratio|rate|per hour|miles|speed|proportion|each hour|cost"),
    ("counting-probability", r"how many different|probability|arrangements|combinations|ways"),
    ("exponents-roots", r"\^|squared|square root|√|power"),
    ("inequalities", r"<|>|≤|≥|inequalit|greatest possible|least possible"),
    ("number-properties", r"integer|odd|even|prime|divisible|remainder|digit|factor|multiple"),
    ("fractions-decimals", r"fraction|decimal|\d+\.\d+"),
    ("word-problems", r"\bif\b.*\b(bought|sold|years old|works|paid|earn)"),
    ("equations", r"=|equation|solve"),
]


def guess_topics(text):
    t = (text or "").lower()
    for topic, pat in KEYWORDS:
        if re.search(pat, t):
            return [topic]
    return ["logic-patterns"]


def main():
    tests = []
    for meta_path in sorted(glob.glob(os.path.join(HERE, "meta", "form-*.json"))):
        meta = json.load(open(meta_path, encoding="utf-8"))
        code = meta["formCode"]
        sha = meta["sha256"]
        geo_path = os.path.join(HERE, "work", sha[:12], "geometry.json")
        if not os.path.exists(geo_path):
            print(f"skip {code}: no geometry (run ocr_pdf.py and segment.py on its PDF)")
            continue
        geo = json.load(open(geo_path, encoding="utf-8"))
        ocr = json.load(open(os.path.join(HERE, "work", sha[:12], "ocr.json"), encoding="utf-8"))
        overrides = meta.get("questions", {})
        sections, questions, groups = [], [], {}
        for msec in meta["sections"]:
            num, count = msec["number"], msec["count"]
            gsec = next((s for s in geo["sections"] if s["count"] == count), None)
            if gsec is None:
                raise SystemExit(f"{code}: geometry has no {count}-question section")
            sid = f"S{num}"
            # section header box, plus (35-question sections) the comparison-question directions box
            dirs = gsec["directions"][: 2 if count == 35 else 1]
            sections.append({"id": sid, "number": num, "count": count, "minutes": msec["minutes"], "pages": gsec["pages"],
                             "directions": [{"page": d["page"], "box": d["box"]} for d in dirs]})
            for gid, g in gsec["groups"].items():
                groups[f"{code}-{gid}"] = {**g, "regions": merge_regions(g["regions"])}
            byn = {q["n"]: q for q in gsec["questions"]}
            for n in range(1, count + 1):
                key = f"{sid}-{n}"
                ov = overrides.get(key, {})
                gq = byn.get(n, {})
                qtype = "qc4" if msec["types"][n - 1] == "Q" else "mc5"
                regions = ov.get("regions") or merge_regions(gq.get("regions") or [])
                text = ocr_text(ocr, regions)
                q = {
                    "id": f"{code}-{sid}-{n:02d}",
                    "section": sid,
                    "n": n,
                    "type": qtype,
                    "answer": msec["answers"][n - 1],
                    "topics": ov.get("topics") or guess_topics(text),
                    "difficulty": ov.get("difficulty") or difficulty(n, count),
                    "regions": regions,
                }
                group = ov.get("group", gq.get("group"))
                if group:
                    q["group"] = f"{code}-{group}" if not group.startswith(code) else group
                if ov.get("explanation"):
                    q["explanation"] = ov["explanation"]
                flags = list(ov.get("flags", []))
                if not ov.get("topics"):
                    flags.append("topic-auto")
                if flags:
                    q["flags"] = flags
                questions.append(q)
        m = re.search(r"TEST\s*(\d+)", ocr["pageInfo"][0]["header"], re.I)
        test = {
            "id": code,
            "formCode": code,
            "title": f"Scholastic Aptitude Test, Form Code {code}",
            "bookLabel": meta.get("bookLabel") or (f"Test {m.group(1)}" if m else None),
            "copyrightYears": meta.get("copyrightYears"),
            "source": meta.get("source", "Released SAT booklet (scanned PDF supplied by the site owner)"),
            "pdf": {"sha256": sha, "pageCount": geo["pageCount"], "pageSize": ocr["pageSize"]},
            "sections": sections,
            "groups": groups,
            "questions": questions,
            "scoring": {"method": "formula", "rawToScaled": meta["rawToScaled"], "source": meta.get("tableSource")},
            "answerKeySource": meta.get("answerKeySource"),
        }
        out = os.path.join(ROOT, "data", "tests", f"form-{code}.json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump(test, f, ensure_ascii=False, separators=(",", ":"))
        tests.append(test)
        missing = [q["id"] for q in questions if not q["regions"]]
        auto = sum(1 for q in questions if "topic-auto" in q.get("flags", []))
        expl = sum(1 for q in questions if q.get("explanation"))
        print(f"{code}: {len(questions)} questions, {len(groups)} groups, {expl} explanations, {auto} auto topics, missing regions: {missing or 'none'}")
    catalog = {
        "version": 1,
        "tests": [{"id": t["id"], "file": f"tests/form-{t['id']}.json", "formCode": t["formCode"], "sha256": t["pdf"]["sha256"],
                   "questions": len(t["questions"]), "title": t["title"]} for t in tests],
    }
    with open(os.path.join(ROOT, "data", "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=1)
    print(f"catalog: {len(tests)} forms, {sum(len(t['questions']) for t in tests)} questions")


def merge_regions(regs):
    """Join regions that sit directly above one another on the same page/column into one crop."""
    out = []
    for r in sorted(regs, key=lambda r: (r["page"], r["box"][0] > 0.45, r["box"][1])):
        if out and out[-1]["page"] == r["page"] and abs(out[-1]["box"][0] - r["box"][0]) < 0.2 \
                and 0 <= r["box"][1] - out[-1]["box"][3] < 0.035:
            b = out[-1]["box"]
            out[-1] = {"page": r["page"], "box": [min(b[0], r["box"][0]), min(b[1], r["box"][1]), max(b[2], r["box"][2]), max(b[3], r["box"][3])]}
        else:
            out.append({"page": r["page"], "box": list(r["box"])})
    return out


def ocr_text(ocr, regions):
    out = []
    for r in regions:
        x0, y0, x1, y1 = r["box"]
        for w in ocr["pages"].get(str(r["page"]), []):
            if w[0] >= x0 - 0.01 and w[2] <= x1 + 0.01 and w[1] >= y0 - 0.005 and w[3] <= y1 + 0.005:
                out.append(w[5])
    return " ".join(out)


if __name__ == "__main__":
    main()
