import { KEY_MAP } from './keyMap.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Insert a plain <g> wrapper around `el` so we can animate the wrapper
 * without fighting the element's existing transform attribute.
 */
function wrapElement(el) {
  const g = document.createElementNS(SVG_NS, 'g');
  el.parentNode.insertBefore(g, el);
  g.appendChild(el);
  return g;
}

/**
 * Convert a point in `el`'s local coordinate space to the SVG viewBox
 * coordinate space (what GSAP's svgOrigin expects).
 */
function localToViewBox(el, lx, ly) {
  const svg = el.ownerSVGElement;
  if (!svg) return { x: lx, y: ly };
  const pt = svg.createSVGPoint();
  pt.x = lx;
  pt.y = ly;
  const ctm = el.getCTM();
  if (!ctm) return { x: lx, y: ly };
  return pt.matrixTransform(ctm);
}

function getPivot(el) {
  if (!el) return null;
  const ax = el.getAttribute('inkscape:transform-center-x');
  const ay = el.getAttribute('inkscape:transform-center-y');
  if (ax == null && ay == null) return null;
  return {
    tcx: parseFloat(ax) || 0,
    tcy: parseFloat(ay) || 0,
  };
}

/**
 * Queries the live SVG DOM and returns a registry of cached element
 * references, wrapper groups, and pre-computed pivot points.
 * Called once after the SVG is injected into the page.
 */
function groupByInkscapeLabel(svg, label) {
  return Array.from(svg.querySelectorAll('g')).find(
    (g) => g.getAttribute('inkscape:label') === label,
  );
}

/**
 * Inkscape stores transform-center on the stroked path inside TB{n}A, not always on the row `<g>`.
 * Depth-first: first descendant with inkscape transform-center (same rule as getPivot).
 */
function findFirstDescendantPivotHost(root) {
  if (!root?.children?.length) return null;
  const stack = [];
  for (let i = root.children.length - 1; i >= 0; i--) stack.push(root.children[i]);
  while (stack.length) {
    const el = stack.pop();
    const p = getPivot(el);
    if (p) return { host: el, pivot: p };
    if (el.children?.length) {
      for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]);
    }
  }
  return null;
}

/** TB{n} row id in SVG; row B uses typo Tb16B for bar 16. */
function typebarSmearRowId(n, row) {
  if (row === 'B' && n === 16) return 'Tb16B';
  return `TB${n}${row}`;
}

function findPressGroup(el, typebarNum) {
  if (!el) return null;
  let n = el;
  const tbToken = typebarNum != null ? `TB${typebarNum}` : null;
  while (n && n.tagName) {
    const id = n.getAttribute?.('id') || '';
    const label = n.getAttribute?.('inkscape:label') || '';
    if (id.includes('KeyTB') || label.includes('KeyTB')) return n;
    if (tbToken && (id.includes(tbToken) || label.includes(tbToken))) return n;
    n = n.parentElement;
  }
  return null;
}

export function buildPartRegistry(container) {
  const svg = container.querySelector('svg, svg\\:svg');
  if (!svg) throw new Error('No <svg> found in container');

  const escapeId = (id) => String(id).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  const byId = (id) => svg.querySelector(`#${escapeId(id)}`);
  const LEGACY_ID_FALLBACK = {
    KeyboardGKey: 'GKeyTB20',
    KeyboardIKey: 'IKeyTB31',
    KeyboardOKey: 'OKeyTB35',
    KeyboardPKey: 'PKeyTB39',
    KeyboardRKey: 'RKeyTB15',
    KeyboardUKey: 'UKeyTB27',
    KeyboardSemicolonKey: 'SemiColonAndColonKeyTB40',
    KeyboardQuoteKey: 'ApostropheAndAtSymbolKeyTB44',
  };
  const byIdOrLabel = (token) => {
    const byExactId = byId(token);
    if (byExactId) return byExactId;
    const byLabel = svg.querySelector(`[inkscape\\:label="${token}"]`);
    if (byLabel) return byLabel;
    const legacy = LEGACY_ID_FALLBACK[token];
    if (!legacy) return null;
    return byId(legacy) || svg.querySelector(`[inkscape\\:label="${legacy}"]`);
  };

  // ── Per-key entries ──────────────────────────────────────────────
  const keys = {};

  for (const [code, { groupId, typebarNum }] of Object.entries(KEY_MAP)) {
    if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'Enter') continue;
    if (code === 'Space') continue;

    const keyEl = byIdOrLabel(groupId);
    if (!keyEl) {
      console.warn(`partRegistry: key group "${groupId}" not found`);
      continue;
    }
    const group = findPressGroup(keyEl, typebarNum) || keyEl;

    const pivot = getPivot(group);
    let svgOrigin = null;
    try {
      const bbox = group.getBBox();
      const localX = pivot
        ? bbox.x + bbox.width / 2 + pivot.tcx
        : bbox.x + bbox.width * 0.5;
      const localY = pivot
        ? bbox.y + bbox.height / 2 - pivot.tcy
        : bbox.y + bbox.height;
      const vb = localToViewBox(group, localX, localY);
      svgOrigin = `${vb.x} ${vb.y}`;
    } catch { /* element not rendered yet */ }

    keys[code] = { group, svgOrigin, typebarNum };
  }

  // ── Typebar wrappers + pivot origins ─────────────────────────────
  // Inkscape stores rotation centre as offset from bbox centre (transform-center-x/y).
  // We animate the inserted wrapper <g>; pivot must be in the same coordinate system as
  // wrapper.getBBox() (sibling space under Typebars — i.e. parent of wrapper).
  // GSAP: prefer svgOrigin in root SVG space — more reliable than % transformOrigin on SVG.
  const typebars = {};
  const typebarNums = Array.from(svg.querySelectorAll('[id^="Typebar"]'))
    .map((el) => {
      const m = /^Typebar(\d+)$/.exec(el.id || '');
      return m ? Number(m[1]) : null;
    })
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  for (const i of typebarNums) {
    const tb = byId(`Typebar${i}`);
    if (!tb) continue;

    const wrapper = wrapElement(tb);

    let svgOrigin = null;
    let transformOriginPct = null;
    try {
      const bbox = wrapper.getBBox();
      const heelFallback = () => {
        const lx = bbox.x + bbox.width * 0.5;
        const ly = bbox.y + bbox.height;
        const vb = localToViewBox(wrapper, lx, ly);
        svgOrigin = `${vb.x} ${vb.y}`;
      };

      if (bbox.width === 0 || bbox.height === 0) {
        heelFallback();
      } else {
        const pivot = getPivot(tb);
        if (pivot) {
          const cx = bbox.x + bbox.width / 2;
          const cy = bbox.y + bbox.height / 2;
          // Offsets from bbox centre (Inkscape); Y uses minus to match SVG y-down vs Inkscape storage
          const lx = cx + pivot.tcx;
          const ly = cy - pivot.tcy;
          const vb = localToViewBox(wrapper, lx, ly);
          svgOrigin = `${vb.x} ${vb.y}`;
        } else {
          heelFallback();
        }
      }
    } catch { /* */ }

    typebars[i] = { element: tb, wrapper, svgOrigin, transformOriginPct };
  }

  // ── TypebarSmearFrames: TB{n}C → B → A (strike) for bars 1–46; parent is hidden in Inkscape ─
  const smearRoot = groupByInkscapeLabel(svg, 'TypebarSmearFrames');
  if (smearRoot) {
    smearRoot.style.display = 'inline';
  }

  const setDisplay = (el, display) => {
    if (!el) return;
    const s = (el.getAttribute('style') || '').replace(/\bdisplay:\s*[^;]+;?/gi, '').trim();
    el.setAttribute('style', (s ? s + ';' : '') + `display:${display}`);
  };

  for (const n of typebarNums) {
    const row = typebars[n];
    if (!row) continue;

    const smearC = byId(typebarSmearRowId(n, 'C'));
    const smearB = byId(typebarSmearRowId(n, 'B'));
    const strikeA = byId(typebarSmearRowId(n, 'A'));
    if (!smearC || !smearB || !strikeA) continue;

    let strikeASvgOrigin = null;
    let strikeATransformOrigin = null;
    try {
      setDisplay(strikeA, 'inline');
      let pivotHost = strikeA;
      let pivotA = getPivot(strikeA);
      if (!pivotA) {
        const found = findFirstDescendantPivotHost(strikeA);
        if (found) {
          pivotHost = found.host;
          pivotA = found.pivot;
        }
      }
      const bboxA = pivotHost.getBBox();
      const centerX = bboxA.x + bboxA.width / 2;
      const centerY = bboxA.y + bboxA.height / 2;
      // Same Y convention as typebars / return lever: offset from bbox centre (Inkscape −ty)
      const lx = pivotA ? centerX + pivotA.tcx : centerX;
      const ly = pivotA ? centerY - pivotA.tcy : centerY;

      const vb = localToViewBox(pivotHost, lx, ly);
      strikeASvgOrigin = `${vb.x} ${vb.y}`;

      if (pivotHost === strikeA && bboxA.width > 0 && bboxA.height > 0 && pivotA) {
        const pctX = ((lx - bboxA.x) / bboxA.width) * 100;
        const pctY = ((ly - bboxA.y) / bboxA.height) * 100;
        if (Number.isFinite(pctX) && Number.isFinite(pctY) && pctX >= -20 && pctX <= 120 && pctY >= -20 && pctY <= 120) {
          strikeATransformOrigin = `${pctX}% ${pctY}%`;
        }
      }
    } catch { /* */ }

    if (!strikeASvgOrigin) continue;

    setDisplay(smearC, 'none');
    setDisplay(smearB, 'none');
    setDisplay(strikeA, 'none');

    row.smearC = smearC;
    row.smearB = smearB;
    row.strikeA = strikeA;
    row.strikeASvgOrigin = strikeASvgOrigin;
    row.strikeATransformOrigin = strikeATransformOrigin;
  }

  // Carriage (resolve before HeadedPaper — needed for platen geometry)
  const carriageEl = byId('Carriage');

  // ── HeadedPaper: live-typed lines (intro + optional echo) ───────
  // Text baseline is aligned directly to the platen / ribbon bite in the flattened SVG.
  const headedPaper = byId('HeadedPaper');
  let formContactLayout = null;
  let paperLine1El = null;
  let paperLine2El = null;
  let paperTypingLayer = null;
  let paperContactFormFO = null;
  let paperFormHost = null;
  let typedBaselineY = -300;
  if (headedPaper) {
    const paperPath = headedPaper.querySelector('#Paper') || byId('Paper');
    const platenFront = carriageEl?.querySelector('#PlatenFront');
    let tx = 1390;
    let ty = -300;
    if (platenFront) {
      try {
        const pb = platenFront.getBBox();
        // Left margin inside the typing opening; vertical just above ribbon band
        const strikeXCar = pb.x + Math.min(pb.width * 0.055, 28) + 4 * 5.5;
        const strikeYCar = pb.y - 8;
        tx = strikeXCar;
        ty = strikeYCar;
      } catch { /* */ }
    }
    if (!platenFront && paperPath) {
      try {
        const bb = paperPath.getBBox();
        tx = bb.x + bb.width * 0.08;
        ty = bb.y + bb.height * 0.38;
      } catch { /* */ }
    }
    typedBaselineY = ty;

    const typed = document.createElementNS(SVG_NS, 'text');
    typed.setAttribute('id', 'PaperTypedText');
    typed.setAttribute('fill', '#09090b');
    // Printed type styling per art direction
    typed.setAttribute('font-size', '5.5px');
    typed.setAttribute('font-family', "'Courier Prime', 'Courier New', monospace");
    typed.setAttribute('opacity', '0.9');
    typed.setAttribute('style', 'pointer-events:none');

    paperLine1El = document.createElementNS(SVG_NS, 'tspan');
    paperLine1El.setAttribute('id', 'PaperLine1');
    paperLine1El.setAttribute('x', String(tx));
    paperLine1El.setAttribute('y', String(ty));

    paperLine2El = document.createElementNS(SVG_NS, 'tspan');
    paperLine2El.setAttribute('id', 'PaperLine2');
    paperLine2El.setAttribute('x', String(tx));
    paperLine2El.setAttribute('y', String(ty));

    typed.appendChild(paperLine1El);
    typed.appendChild(paperLine2El);

    // HTML contact form: one row at a time, aligned to intro strike X; Y/height set in hook after intro
    let fo = null;
    if (paperPath) {
      try {
        const bb = paperPath.getBBox();
        const padX = bb.width * 0.04;
        const foW = Math.max(bb.x + bb.width - padX - tx, 40);
        formContactLayout = { x: tx, width: foW, padX };
        fo = document.createElementNS(SVG_NS, 'foreignObject');
        fo.setAttribute('id', 'PaperContactFormFO');
        fo.setAttribute('x', String(tx));
        fo.setAttribute('y', String(ty));
        fo.setAttribute('width', String(foW));
        fo.setAttribute('height', '14');
        fo.setAttribute('overflow', 'visible');
        fo.setAttribute('style', 'display:none;pointer-events:none');
        const host = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
        host.setAttribute('id', 'PaperFormHost');
        host.setAttribute(
          'style',
          'box-sizing:border-box;width:100%;height:100%;margin:0;padding:0;font-size:5.5px;line-height:1.2;font-family:\'Courier Prime\',\'Courier New\',monospace;color:#09090b;opacity:0.9;',
        );
        fo.appendChild(host);
        paperContactFormFO = fo;
        paperFormHost = host;
      } catch { /* */ }
    }

    // Typed text + form must paint above Ribbon/Typebars (Carriage siblings drawn after HeadedPaper).
    // Keep the sheet/letterpress art under the mechanism; sync vertical motion with headedPaper in the hook.
    paperTypingLayer = document.createElementNS(SVG_NS, 'g');
    paperTypingLayer.setAttribute('id', 'PaperTypingLayer');
    paperTypingLayer.appendChild(typed);
    if (fo) paperTypingLayer.appendChild(fo);
  }

  // ── Carriage wrapper ─────────────────────────────────────────────
  const carriageWrapper = carriageEl ? wrapElement(carriageEl) : null;

  // After wrap so the layer is a direct child of the final <g id="Carriage"> subtree (above ribbon/typebars).
  if (paperTypingLayer && carriageEl) {
    carriageEl.appendChild(paperTypingLayer);
  } else if (paperTypingLayer && headedPaper) {
    headedPaper.appendChild(paperTypingLayer);
  }

  // ── Carriage lifting mechanism wrapper ───────────────────────────
  const carriageLiftEl =
    Array.from(svg.querySelectorAll('g')).find(
      (g) => g.getAttribute('inkscape:label') === 'CarriageLiftingMechanism',
    );
  const carriageLiftWrapper = carriageLiftEl ? wrapElement(carriageLiftEl) : null;

  // ── Ribbon hop: wrap so GSAP `y` does not overwrite Inkscape transform on the group ─
  const ribbonGroup = byId('RibbonAndRibbonGuides') || byId('Ribbon');
  const ribbon = ribbonGroup ? wrapElement(ribbonGroup) : null;

  // ── Ribbon carrier wrapper ───────────────────────────────────────
  const ribbonCarrierEl = byId('RibbonCarrier');
  const ribbonCarrierWrapper = ribbonCarrierEl ? wrapElement(ribbonCarrierEl) : null;

  // ── Shift keys ───────────────────────────────────────────────────
  const leftShiftGroup  = byId('LeftShiftKeyAndSpring');
  const leftShiftSpring = byId('LeftShiftSpring');
  const leftShiftKey    = byId('KeyboardLeftShiftKey');

  const rightShiftGroup  = byId('BackspaceKeyAndSpring');
  const rightShiftSpring = byId('RightShiftSpring');
  const rightShiftKey    = byId('KeyboardBackSpaceKey');

  // ── Return lever (inside carriage; use % transformOrigin so it pivots in place) ─
  const returnLever       = byId('CarriageReturnLever');
  const returnLeverSpring = byId('CarriageReturnLeverSpring');
  const returnLeverSpring2 = byId('CarriageReturnLeverSpring_2');

  let returnLeverSvgOrigin = null;
  let returnLeverTransformOrigin = null;
  if (returnLever) {
    const pivot = getPivot(returnLever);
    if (pivot) {
      try {
        const bbox = returnLever.getBBox();
        const localX = bbox.x + bbox.width / 2 + pivot.tcx;
        const localY = bbox.y + bbox.height / 2 - pivot.tcy;
        const vb = localToViewBox(returnLever, localX, localY);
        returnLeverSvgOrigin = `${vb.x} ${vb.y}`;
        const pctX = ((localX - bbox.x) / bbox.width) * 100;
        const pctY = ((localY - bbox.y) / bbox.height) * 100;
        returnLeverTransformOrigin = `${pctX}% ${pctY}%`;
      } catch { /* */ }
    }
  }

  // ── Spacebar ─────────────────────────────────────────────────────
  const spacebar = byId('KeyboardSpacebarKey');

  return {
    svg,
    keys,
    typebars,
    headedPaper,
    paperTypingLayer,
    paperLine1El,
    paperLine2El,
    paperContactFormFO,
    paperFormHost,
    formContactLayout,
    carriageWrapper,
    carriageLiftWrapper,
    ribbon,
    ribbonCarrierWrapper,
    leftShift:  { group: leftShiftGroup,  spring: leftShiftSpring,  keyCap: leftShiftKey },
    rightShift: { group: rightShiftGroup, spring: rightShiftSpring, keyCap: rightShiftKey },
    returnLever,
    returnLeverSpring,
    returnLeverSprings: [returnLeverSpring, returnLeverSpring2].filter(Boolean),
    returnLeverSvgOrigin,
    returnLeverTransformOrigin,
    spacebar,
  };
}
