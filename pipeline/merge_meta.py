"""Merge hand-written topic tags / explanations / flags into pipeline/meta/form-<code>.json.

Usage: python pipeline/merge_meta.py <code> <fragment.json>
fragment: { "S3-1": {"topics": [...], "explanation": "...", "flags": [...]}, ... }
"""
import json, sys

code, frag_path = sys.argv[1], sys.argv[2]
path = f"pipeline/meta/form-{code}.json"
meta = json.load(open(path, encoding="utf-8"))
frag = json.load(open(frag_path, encoding="utf-8"))
qs = meta.setdefault("questions", {})
for k, v in frag.items():
    qs.setdefault(k, {}).update(v)
json.dump(meta, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(f"{code}: {len(frag)} merged, {sum(1 for v in qs.values() if v.get('explanation'))} explanations total")
