"""
Set element ids from inkscape:label where present (author labels = ids).
Resolve duplicate labels (g beats path; second gets _2 / _path).
Rename generic path*/text* ids to short parent-based names: <ParentShort>_pN / _tN.
Preserved ids: never rename these (animation / app contract).

Does not change geometry, styles, or non-id attributes.
Usage: python scripts/align_svg_ids_to_inkscape_labels.py <in.svg> <out.svg>
"""
from __future__ import annotations

import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict

INK = "{http://www.inkscape.org/namespaces/inkscape}label"
SVG_NS = "http://www.w3.org/2000/svg"

# Do not reassign these ids (even if label differs); must stay stable for tooling.
PRESERVE_IDS = frozenset(
    {
        "svg1",
        "namedview1",
        "defs1",
        "Paper",
        "Carriage",
        "HeadedPaper",
    }
)

# Inkscape default layer id (shorter than Layer_1 from “Layer 1”).
LABEL_TO_ID_OVERRIDE = {
    "Layer 1": "layer1",
}

# Strip manual Inkscape-export garbage: old ID_ prefix becomes label-only when unique
STRIP_ID_PREFIX = "ID_"


def sanitize_label(lab: str) -> str:
    s = lab.strip()
    if not s or s == "None":
        return ""
    s = re.sub(r"\s+", "_", s)
    s = re.sub(r"[^A-Za-z0-9_.-]", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    if not s:
        return ""
    if s[0].isdigit() or s[0] in ".-":
        s = "_" + s
    return s


def local_tag(tag: str) -> str:
    if tag.startswith("{") and "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def parent_map(root: ET.Element) -> dict[ET.Element, ET.Element | None]:
    p: dict[ET.Element, ET.Element | None] = {root: None}
    for pa in root.iter():
        for ch in pa:
            p[ch] = pa
    return p


def apply_two_phase(root: ET.Element, old_to_new: dict[str, str]) -> None:
    """Avoid id clashes while swapping."""
    keys = sorted(old_to_new.keys())
    tmp = {o: f"__tid_{i}" for i, o in enumerate(keys)}
    for el in root.iter():
        i = el.get("id")
        if i in tmp:
            el.set("id", tmp[i])
    rev = {v: k for k, v in tmp.items()}
    for el in root.iter():
        i = el.get("id")
        if i in rev:
            el.set("id", old_to_new[rev[i]])


def short_prefix_ascii(parent_id: str, max_len: int = 12) -> str:
    if len(parent_id) <= max_len:
        return parent_id
    return parent_id[:max_len]


def build_label_renames(root: ET.Element) -> dict[str, str]:
    """Map old id -> new id from inkscape:label."""
    doc_order = {e: i for i, e in enumerate(root.iter())}

    labeled: list[tuple[ET.Element, str, str]] = []  # el, label, sanitized
    for el in root.iter():
        eid = el.get("id")
        if not eid or eid in PRESERVE_IDS:
            continue
        lab = el.get(INK)
        if not lab or lab.strip() in ("", "None"):
            continue
        s = LABEL_TO_ID_OVERRIDE.get(lab.strip(), sanitize_label(lab))
        if not s:
            continue
        labeled.append((el, lab, s))

    buckets: dict[str, list[ET.Element]] = defaultdict(list)
    for el, _lab, s in labeled:
        buckets[s].append(el)

    old_to_new: dict[str, str] = {}

    def pick_newid(elems: list[ET.Element], base: str) -> None:
        if len(elems) == 1:
            oid = elems[0].get("id")
            if oid and oid not in PRESERVE_IDS:
                old_to_new[oid] = base
            return

        def sort_key(e: ET.Element) -> tuple[int, int]:
            t = local_tag(e.tag)
            prio = 0 if t == "g" else 1
            return (prio, doc_order[e])

        ordered = sorted(elems, key=sort_key)
        for i, e in enumerate(ordered):
            oid = e.get("id")
            if not oid or oid in PRESERVE_IDS:
                continue
            t = local_tag(e.tag)
            first_tag = local_tag(ordered[0].tag)
            if i == 0:
                old_to_new[oid] = base
            elif t == "path" and first_tag == "g":
                old_to_new[oid] = f"{base}_path"
            else:
                old_to_new[oid] = f"{base}_{i + 1}"

    for base, elems in buckets.items():
        pick_newid(elems, base)

    return old_to_new


def build_strip_id_prefix_renames(root: ET.Element, used_future: set[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for el in root.iter():
        eid = el.get("id")
        if not eid or eid in PRESERVE_IDS:
            continue
        if not eid.startswith(STRIP_ID_PREFIX):
            continue
        bare = eid[len(STRIP_ID_PREFIX) :]
        if not bare or sanitize_label(bare) != bare:
            continue
        if bare in used_future:
            continue
        out[eid] = bare
    return out


def generic_path_text_renames(root: ET.Element, already: dict[str, str]) -> dict[str, str]:
    parent = parent_map(root)
    gen_re = re.compile(r"^(path|text)([\d]+([.-][\d]+)*)$")
    # Applied after label renames: 'already' maps old->new; we need current ids from tree

    # Collect current ids set after first apply - caller merges; here compute from planned final
    used = set()
    for el in root.iter():
        i = el.get("id")
        if i:
            used.add(i)

    old_to_new: dict[str, str] = {}

    # Document order index
    doc_index = {e: i for i, e in enumerate(root.iter())}

    # Group paths/texts to rename by nearest ancestor g with id
    by_parent: dict[str, list[ET.Element]] = defaultdict(list)
    for el in root.iter():
        eid = el.get("id")
        if not eid or eid in PRESERVE_IDS:
            continue
        if not gen_re.match(eid):
            continue
        g_anc = None
        walk = parent.get(el)
        while walk is not None:
            if local_tag(walk.tag) == "g" and walk.get("id"):
                g_anc = walk
                break
            walk = parent.get(walk)
        if g_anc is None:
            continue
        pid = g_anc.get("id")
        if not pid:
            continue
        by_parent[pid].append(el)

    for _pid, els in by_parent.items():
        els.sort(key=lambda e: doc_index[e])
        p_count = 0
        t_count = 0
        for e in els:
            oid = e.get("id")
            if not oid:
                continue
            pref = short_prefix_ascii(_pid, 12)
            tag = local_tag(e.tag)
            if tag == "path":
                name = f"{pref}_p{p_count}"
                p_count += 1
            else:
                name = f"{pref}_t{t_count}"
                t_count += 1
            cand = name
            n = 2
            while cand in used or cand in old_to_new.values():
                cand = f"{name}_{n}"
                n += 1
            used.add(cand)
            old_to_new[oid] = cand

    return old_to_new


def cleanup_group_suffix_bloat(root: ET.Element) -> dict[str, str]:
    """
    Remove accidental path-like suffixes from group ids, e.g. Foo_p0/Foo_p1/Foo#1.
    Keep ids unique by adding _Alt, _Alt2... when needed.
    """
    used = {e.get("id") for e in root.iter() if e.get("id")}
    out: dict[str, str] = {}
    suffix_re = re.compile(r"^(.*?)(?:_p\d+(?:_\d+)?|#\d+)$")

    for el in root.iter():
        if local_tag(el.tag) != "g":
            continue
        oid = el.get("id")
        if not oid or oid in PRESERVE_IDS:
            continue
        m = suffix_re.match(oid)
        if not m:
            continue
        base = sanitize_label(m.group(1))
        if not base:
            continue
        cand = base
        n = 1
        while cand in used or cand in out.values():
            n += 1
            cand = f"{base}_Alt" if n == 2 else f"{base}_Alt{n - 1}"
        out[oid] = cand
        used.add(cand)
    return out


def sync_labels_to_ids(root: ET.Element) -> int:
    """
    Set inkscape:label = id for groups/paths (when id exists).
    Keeps metadata unchanged on non g/path elements.
    """
    changed = 0
    for el in root.iter():
        if local_tag(el.tag) not in ("g", "path"):
            continue
        eid = el.get("id")
        if not eid:
            continue
        if el.get(INK) != eid:
            el.set(INK, eid)
            changed += 1
    return changed


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    ET.register_namespace("", SVG_NS)
    ET.register_namespace("inkscape", "http://www.inkscape.org/namespaces/inkscape")
    ET.register_namespace("sodipodi", "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd")
    ET.register_namespace("svg", SVG_NS)

    tree = ET.parse(src)
    root = tree.getroot()

    label_map = build_label_renames(root)
    # IDs that will exist after label rename (for strip-prefix collision check)
    used_future: set[str] = set(PRESERVE_IDS)
    for el in root.iter():
        i = el.get("id")
        if not i:
            continue
        if i in label_map:
            used_future.add(label_map[i])
        else:
            used_future.add(i)
    strip_map = build_strip_id_prefix_renames(root, used_future)

    # Merge: label wins over strip for same old id
    merged: dict[str, str] = dict(strip_map)
    merged.update(label_map)

    apply_two_phase(root, merged)

    # Second pass: generic paths on updated tree
    path_map = generic_path_text_renames(root, merged)
    if path_map:
        apply_two_phase(root, path_map)

    # Third pass: trim _pN/# suffix bloat from group ids if any slipped in.
    group_fix = cleanup_group_suffix_bloat(root)
    if group_fix:
        apply_two_phase(root, group_fix)

    # Final pass: keep id and label in sync for groups and paths.
    label_sync_count = sync_labels_to_ids(root)

    tree.write(dst, encoding="utf-8", xml_declaration=True)
    print(
        f"Wrote {dst} (label+strip: {len(merged)}, generic: {len(path_map)}, "
        f"group_cleanup: {len(group_fix)}, label_sync: {label_sync_count})"
    )


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: align_svg_ids_to_inkscape_labels.py <in.svg> <out.svg>", file=sys.stderr)
        sys.exit(1)
    main()
