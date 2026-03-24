"""
Bake ancestor <g> transforms into child <path> d attributes (svgelements),
compose each path's own transform into d, remove transforms from all <g> and <path>.
Preserves ids and other attributes. Run: python scripts/bake_svg_group_transforms_into_paths.py
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

from svgelements import Matrix, Path

SVG_NS = "http://www.w3.org/2000/svg"


def local_tag(tag: str) -> str:
    if tag.startswith("{") and "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def parse_matrix(transform: str | None) -> Matrix:
    if not transform or not str(transform).strip():
        return Matrix.identity()
    return Matrix(str(transform))


def bake_tree(elem: ET.Element, acc: Matrix) -> None:
    tag = local_tag(elem.tag)
    if tag == "g":
        t = parse_matrix(elem.get("transform"))
        acc = t * acc
        for child in list(elem):
            bake_tree(child, acc)
        return
    if tag == "path":
        d = elem.get("d")
        if d and d.strip():
            tp = parse_matrix(elem.get("transform"))
            full = tp * acc
            try:
                p = Path(d)
                p *= full
                elem.set("d", p.d(relative=False))
            except Exception as e:
                pid = elem.get("id", "?")
                print(f"WARN path id={pid}: {e}", file=sys.stderr)
        if "transform" in elem.attrib:
            del elem.attrib["transform"]
        return
    for child in list(elem):
        bake_tree(child, acc)


def strip_group_transforms(elem: ET.Element) -> None:
    if local_tag(elem.tag) == "g" and "transform" in elem.attrib:
        del elem.attrib["transform"]
    for child in elem:
        strip_group_transforms(child)


def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else None
    dst = sys.argv[2] if len(sys.argv) > 2 else None
    if not src or not dst:
        print("Usage: bake_svg_group_transforms_into_paths.py <in.svg> <out.svg>", file=sys.stderr)
        sys.exit(1)

    ET.register_namespace("", SVG_NS)
    ET.register_namespace("inkscape", "http://www.inkscape.org/namespaces/inkscape")
    ET.register_namespace("sodipodi", "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd")
    ET.register_namespace("svg", SVG_NS)

    tree = ET.parse(src)
    root = tree.getroot()
    bake_tree(root, Matrix.identity())
    strip_group_transforms(root)
    tree.write(dst, encoding="utf-8", xml_declaration=True)


if __name__ == "__main__":
    main()
