"""
Multiply stroke-width by scale (default 0.26458333) on every element that sets it
(paths and groups with inherited stroke, etc.). Updates inline style and attribute.
"""
from __future__ import annotations

import re
import sys
import xml.etree.ElementTree as ET

DEFAULT_SCALE = 0.26458333
SVG_NS = "http://www.w3.org/2000/svg"


def local_tag(tag: str) -> str:
    if tag.startswith("{") and "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def scale_num(s: str, scale: float) -> str:
    v = float(s) * scale
    t = f"{v:.6f}".rstrip("0").rstrip(".")
    return t if t else "0"


def scale_style_stroke_width(style: str, scale: float) -> str:
    def repl(m: re.Match) -> str:
        return f"stroke-width:{scale_num(m.group(1), scale)}"

    return re.sub(
        r"stroke-width:\s*([0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)",
        repl,
        style,
        flags=re.IGNORECASE,
    )


def process_element(elem: ET.Element, scale: float) -> None:
    sw = elem.get("stroke-width")
    if sw is not None and sw.strip():
        m = re.match(r"^\s*([0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)", sw.strip())
        if m:
            rest = sw.strip()[m.end() :]
            elem.set("stroke-width", scale_num(m.group(1), scale) + (rest if rest else ""))
    st = elem.get("style")
    if st and "stroke-width" in st.lower():
        elem.set("style", scale_style_stroke_width(st, scale))
    for child in elem:
        process_element(child, scale)


def main() -> None:
    scale = float(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_SCALE
    src = sys.argv[1]
    dst = sys.argv[2]
    ET.register_namespace("", SVG_NS)
    ET.register_namespace("inkscape", "http://www.inkscape.org/namespaces/inkscape")
    ET.register_namespace("sodipodi", "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd")
    ET.register_namespace("svg", SVG_NS)
    tree = ET.parse(src)
    process_element(tree.getroot(), scale)
    tree.write(dst, encoding="utf-8", xml_declaration=True)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: scale_path_stroke_widths.py <in.svg> <out.svg> [scale]", file=sys.stderr)
        sys.exit(1)
    main()
