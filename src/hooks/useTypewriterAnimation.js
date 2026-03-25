import { useCallback, useRef, useEffect } from 'react';
import gsap from 'gsap';
import { buildPartRegistry } from '../utils/partRegistry';
import { KEY_MAP, CHARACTER_CODES, SHIFT_CODES } from '../utils/keyMap';
import { charToKeySpec } from '../utils/charToKeySpec';
import {
  playRandomKeyClack,
  playCarriageReturn,
  playShiftKey,
  playSpaceOrBackspace,
  playSpaceOrBackspaceNonOverlapping,
  prefetchClackBuffers,
  resumeAudioContextSync,
} from '../utils/clackAudio';

// ── Timing (seconds) ───────────────────────────────────────────────────
const KEY_DOWN_DUR      = 0.14;
const KEY_UP_DUR        = 0.15;
const TYPEBAR_UP_DUR    = 0.10;
const TYPEBAR_DOWN_DUR  = 0.12;
const RIBBON_DUR        = 0.06;
const CARRIAGE_STEP_DUR = 0.08;
/** Held Backspace: no throttle + snappier mechanical timings for rapid repeats. */
const BACKSPACE_REPEAT_MS    = 0;
const BACKSPACE_KEY_DOWN_MULT = 0.85;
const BACKSPACE_KEY_UP_MULT   = 0.85;
const BACKSPACE_CARRIAGE_DUR  = 0.05;
const BACKSPACE_HOLD_TRAVEL_Y = 7.2;
const BACKSPACE_HOLD_DOWN_DUR = 0.035;
const BACKSPACE_HOLD_UP_DUR   = 0.06;
const SHIFT_DUR         = 0.12;
const RETURN_LEVER_DUR  = 0.15;
const RETURN_SLIDE_DUR  = 0.40;
const RETURN_PAUSE      = 0.22;  // pause between lever lean → carriage slide → lever back
const SMEAR_FADE_DUR    = 0.015;  // Strike frame fade out / smear frame fade in
const SMEAR_MASK_MOVE_DUR = 0.006; // hold smears visible before strike frame A
const SMEAR_FRAME_GAP = 0.05;     // delay between smear frame 1 and 2

// ── Geometry (viewBox units unless noted) ───────────────────────────────
const KEY_PIVOT_ANGLE      = 2;  // key travel (degrees); reduce to move less
const KEY_TRAVEL_Y         = 4.95; // key/linkage straight press distance (another +50%)
const TYPEBAR_STRIKE_ANGLE = 30;
const CARRIAGE_STEP        = 3;
const CARRIAGE_MAX_TRAVEL  = 75;
/** Start-of-line (right margin): full letter + ~30% letter left of raw max. */
const CARRIAGE_HOME_X      = CARRIAGE_MAX_TRAVEL - CARRIAGE_STEP * 1.3;
const RIBBON_HOP           = 4.394;
const SHIFT_LIFT           = 2.5;
const RETURN_LEVER_ANGLE   = 25;  // lean right (clockwise) around transform-center
const PAPER_ADVANCE_Y      = 11;  // move sheet upward on each carriage return
/** Same distance as a carriage-return line — paper visibly slides when Email step appears. */
const FORM_STEP_PAPER_SHIFT_Y = PAPER_ADVANCE_Y;
/** Extra space below intro line 2 once Email step is shown (FO is taller; avoids crowding the message). */
const FORM_EMAIL_EXTRA_GAP_Y = 5;
/** After intro, nudge sheet + name field slightly higher (same delta before Email slide — email alignment unchanged). */
const FORM_NAME_EXTRA_LIFT_Y = 2.8;

const RETURN_SEQUENCE_MS =
  (RETURN_LEVER_DUR + RETURN_PAUSE + RETURN_SLIDE_DUR + RETURN_PAUSE + RETURN_LEVER_DUR * 1.2) *
  1000;

const INTRO_LINE_1 = 'Notes from the Minka bench.';
const INTRO_LINE_2 = 'From our atelier to your inbox.';
const THANK_YOU_LINE = 'Thanks for subscribing ....';
const INTRO_CHAR_MS = 230;
const SHIFT_TAP_MS = 55;
/** New sheet starts this far down (viewBox Y); tween to 0 so it scrolls up from behind the platen. */
const POST_SUBMIT_SHEET_ENTRANCE_Y = 150;
const POST_SUBMIT_ENTRANCE_DUR = 1.05;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function useTypewriterAnimation() {
  const registryRef    = useRef(null);
  const carriagePosRef = useRef(CARRIAGE_HOME_X);
  const heldKeysRef    = useRef(new Set());
  const shiftTlRef     = useRef(null);
  const handlersRef    = useRef({ down: null, up: null });
  const introActiveRef = useRef(false);
  /** Single source of truth for vertical translation shared by sheet art + typing overlay */
  const paperSlideProxyRef = useRef({ y: 0 });
  const lastBackspaceTickRef = useRef(0);
  const leftSpoolDotIndexRef = useRef(0);
  const rightSpoolDotIndexRef = useRef(0);
  const postSubmitSequenceLockRef = useRef(false);

  /** Limits OS key-repeat rate for Backspace; prevents extra char delete in inputs when throttled. */
  function allowBackspaceTick(e, isFormField) {
    if (e.code !== 'Backspace') return true;
    const t = Date.now();
    if (e.repeat && t - lastBackspaceTickRef.current < BACKSPACE_REPEAT_MS) {
      if (isFormField) e.preventDefault();
      return false;
    }
    lastBackspaceTickRef.current = t;
    return true;
  }

  function applyPaperSlideTransform() {
    const y = paperSlideProxyRef.current.y;
    const reg = registryRef.current;
    if (reg?.headedPaper) gsap.set(reg.headedPaper, { y });
    if (reg?.paperTypingLayer) gsap.set(reg.paperTypingLayer, { y });

    const clip = reg?.paperSlideClip;
    if (clip?.rectEl && Number.isFinite(clip.top0) && Number.isFinite(clip.chromeBottom)) {
      let clipY = clip.top0 + y;
      let h = clip.chromeBottom - clipY;
      if (h < 0.25) {
        h = 0.25;
        clipY = clip.chromeBottom - h;
      }
      clip.rectEl.setAttribute('x', String(clip.clipX));
      clip.rectEl.setAttribute('width', String(clip.clipWidth));
      clip.rectEl.setAttribute('y', String(clipY));
      clip.rectEl.setAttribute('height', String(h));
    }
  }

  function dotIsVisible(el) {
    if (!el) return false;
    const styleAttr = (el.getAttribute('style') || '').toLowerCase();
    if (/\bdisplay\s*:\s*none\b/.test(styleAttr)) return false;
    const attrOpacity = parseFloat(el.getAttribute('opacity') || '');
    if (Number.isFinite(attrOpacity) && attrOpacity <= 0.001) return false;
    if (/\bopacity\s*:\s*0(?:[;\s]|$)/.test(styleAttr)) return false;
    return true;
  }

  function setDotVisible(el, on) {
    if (!el) return;
    gsap.set(el, {
      opacity: on ? 1 : 0,
      display: on ? 'inline' : 'none',
    });
  }

  function initRibbonSpoolDots(reg) {
    const left = reg?.leftRibbonSpoolDots || [];
    const right = reg?.rightRibbonSpoolDots || [];

    if (left.length) {
      let idx = left.findIndex(dotIsVisible);
      if (idx < 0) idx = 0;
      leftSpoolDotIndexRef.current = idx;
      left.forEach((el, i) => setDotVisible(el, i === idx));
    }

    if (right.length) {
      let idx = right.findIndex(dotIsVisible);
      if (idx < 0) idx = 0;
      rightSpoolDotIndexRef.current = idx;
      right.forEach((el, i) => setDotVisible(el, i === idx));
    }
  }

  function stepRibbonSpoolDots() {
    const reg = registryRef.current;
    if (!reg) return;
    const left = reg.leftRibbonSpoolDots || [];
    const right = reg.rightRibbonSpoolDots || [];

    if (left.length > 1) {
      const prev = leftSpoolDotIndexRef.current % left.length;
      const next = (prev + 1) % left.length;
      setDotVisible(left[prev], false);
      setDotVisible(left[next], true);
      leftSpoolDotIndexRef.current = next;
    }

    if (right.length > 1) {
      const prev = rightSpoolDotIndexRef.current % right.length;
      const next = (prev - 1 + right.length) % right.length;
      setDotVisible(right[prev], false);
      setDotVisible(right[next], true);
      rightSpoolDotIndexRef.current = next;
    }
  }

  /** rowIndex 0 = first line below intro line 2 (name); 1 = next line (email + send) */
  function layoutContactFormAtRow(reg, rowIndex) {
    if (!reg?.paperContactFormFO || !reg.paperLine2El) return;
    const y2 = parseFloat(reg.paperLine2El.getAttribute('y') || '0');
    if (!Number.isFinite(y2)) return;
    // Keep form baseline fixed to the first input strike row;
    // row transitions are achieved by moving the paper layer itself.
    const lineY = y2 + PAPER_ADVANCE_Y;
    // Lift form text slightly so descenders clear the stationary ribbon.
    const baselineNudge = 7.7;
    const emailExtraGap = rowIndex === 1 ? FORM_EMAIL_EXTRA_GAP_Y : 0;
    reg.paperContactFormFO.setAttribute('y', String(lineY - baselineNudge + emailExtraGap));
    reg.paperContactFormFO.setAttribute('height', rowIndex === 0 ? '13' : '24');
  }

  useEffect(() => {
    return () => {
      const { down, up } = handlersRef.current;
      if (down) window.removeEventListener('keydown', down, true);
      if (up) window.removeEventListener('keyup', up, true);
    };
  }, []);

  // ── Character / Spacebar animation ───────────────────────────────
  function animateKeyPress(code, options = {}) {
    const { isBackspaceRepeat = false } = options;
    const reg = registryRef.current;
    if (!reg) return;

    resumeAudioContextSync();

    const isSpace = code === 'Space';
    const isBackspace = code === 'Backspace';
    const entry = isSpace ? null : reg.keys[code];
    if (!isSpace && !entry) return;

    if (isSpace || isBackspace) {
      if (isBackspace && isBackspaceRepeat) {
        // Hold-repeat Backspace should sound like rapid full clicks, not overlapping noise.
        playSpaceOrBackspaceNonOverlapping();
      } else {
        playSpaceOrBackspace();
      }
    } else {
      playRandomKeyClack();
    }
    if (!isSpace && !isBackspace) {
      stepRibbonSpoolDots();
    }

    const keyDownDur = isBackspace
      ? (isBackspaceRepeat ? BACKSPACE_HOLD_DOWN_DUR : KEY_DOWN_DUR * BACKSPACE_KEY_DOWN_MULT)
      : KEY_DOWN_DUR;
    const keyUpDur = isBackspace
      ? (isBackspaceRepeat ? BACKSPACE_HOLD_UP_DUR : KEY_UP_DUR * BACKSPACE_KEY_UP_MULT)
      : KEY_UP_DUR;
    const carriageDur = isBackspace ? BACKSPACE_CARRIAGE_DUR : CARRIAGE_STEP_DUR;

    const tl = gsap.timeline({ defaults: { overwrite: 'auto' } });

    // 1 ── Key + linkage press straight down (no side-to-side rotation) ─
    if (!isSpace && entry.group) {
      const keyDownY = isBackspace && isBackspaceRepeat ? BACKSPACE_HOLD_TRAVEL_Y : KEY_TRAVEL_Y;
      const keyDownEase = isBackspace && isBackspaceRepeat ? 'power2.out' : 'power2.in';
      tl.to(entry.group, {
        y: keyDownY,
        duration: keyDownDur,
        ease: keyDownEase,
      }, 0);
    }

    if (isSpace && reg.spacebar) {
      tl.to(reg.spacebar, {
        y: 2,
        duration: KEY_DOWN_DUR,
        ease: 'power2.in',
      }, 0);
    }

    if (isBackspace && reg.rightShift?.spring) {
      tl.to(reg.rightShift.spring, {
        scaleY: 1.18,
        transformOrigin: '50% 100%',
        duration: keyDownDur,
        ease: 'power2.in',
      }, 0);
    }
    if (isBackspace && reg.leftShift?.spring) {
      tl.to(reg.leftShift.spring, {
        scaleY: 1.18,
        transformOrigin: '50% 0%',
        duration: keyDownDur,
        ease: 'power2.in',
      }, 0);
    }

    // 2 ── Typebar strike depiction (flash-only; no typebar rotation) ─
    if (!isSpace && entry.typebarNum != null) {
      const tbEntry = reg.typebars[entry.typebarNum];
      if (!tbEntry?.element) {
        // skip
      } else {
        const hasSmearStrike = tbEntry.smearC && tbEntry.smearB && tbEntry.strikeA;

        if (hasSmearStrike) {
          // No typebar rotation — only TB{n}C → B → A visibility gives the strike (per SVG intent).
          const tFadeStart = 0.02;
          const tAfterFade = tFadeStart + SMEAR_FADE_DUR;
          const tSmearB = tAfterFade + SMEAR_FRAME_GAP;
          const tStrikeStart = tSmearB + SMEAR_FRAME_GAP + SMEAR_MASK_MOVE_DUR;
          const tReturnSwap = tStrikeStart + TYPEBAR_UP_DUR;
          const smearShow = (el) => {
            if (!el) return;
            const s = (el.getAttribute('style') || '').replace(/\bdisplay:\s*[^;]+/gi, '').trim();
            el.setAttribute('style', (s ? s + ';' : '') + 'display:inline');
          };
          const smearHide = (el) => {
            if (!el) return;
            const s = (el.getAttribute('style') || '').replace(/\bdisplay:\s*[^;]+/gi, '').trim();
            el.setAttribute('style', (s ? s + ';' : '') + 'display:none');
          };

          tl.to(tbEntry.element, { opacity: 0, duration: SMEAR_FADE_DUR, ease: 'power2.in' }, tFadeStart);
          tl.add(() => {
            tbEntry.element.style.display = 'none';
            tbEntry.element.style.opacity = '1';
            smearShow(tbEntry.smearC);
          }, tAfterFade);
          tl.add(() => {
            smearShow(tbEntry.smearB);
          }, tSmearB);
          tl.add(() => {
            smearHide(tbEntry.smearC);
            smearHide(tbEntry.smearB);
            smearShow(tbEntry.strikeA);
          }, tStrikeStart);
          tl.add(() => {
            smearHide(tbEntry.strikeA);
            smearShow(tbEntry.smearB);
            smearShow(tbEntry.smearC);
          }, tReturnSwap);
          tl.add(() => {
            smearHide(tbEntry.smearC);
            smearHide(tbEntry.smearB);
            tbEntry.element.style.display = '';
            gsap.set(tbEntry.element, { opacity: 0 });
          }, tReturnSwap + SMEAR_MASK_MOVE_DUR);
          tl.to(tbEntry.element, { opacity: 1, duration: SMEAR_FADE_DUR, ease: 'power2.out' }, tReturnSwap + SMEAR_MASK_MOVE_DUR);
        } else {
          // Bars without smear frames: minimal blink only (still no movement).
          tl.to(tbEntry.element, { opacity: 0.25, duration: TYPEBAR_UP_DUR * 0.5, ease: 'power1.inOut' }, 0.02);
          tl.to(tbEntry.element, { opacity: 1, duration: TYPEBAR_DOWN_DUR * 0.5, ease: 'power1.out' }, 0.02 + TYPEBAR_UP_DUR * 0.5);
        }
      }
    }

    // 3 ── Ribbon hop ───────────────────────────────────────────────
    if (!isSpace && !isBackspace) {
      if (reg.ribbon) {
        tl.to(reg.ribbon, {
          y: -RIBBON_HOP,
          duration: RIBBON_DUR,
          ease: 'power1.in',
        }, 0.06);
        tl.to(reg.ribbon, {
          y: 0,
          duration: RIBBON_DUR,
          ease: 'power1.out',
        }, 0.06 + RIBBON_DUR);
      }
    }

    // 4 ── Carriage: left per character; backspace nudges right by the same step
    if (isBackspace) {
      carriagePosRef.current = Math.min(
        carriagePosRef.current + CARRIAGE_STEP,
        CARRIAGE_HOME_X,
      );
    } else {
      carriagePosRef.current = Math.max(
        carriagePosRef.current - CARRIAGE_STEP,
        -CARRIAGE_MAX_TRAVEL,
      );
    }
    if (reg.carriageWrapper) {
      gsap.to(reg.carriageWrapper, {
        x: carriagePosRef.current,
        duration: carriageDur,
        ease: 'power2.out',
        overwrite: 'auto',
      });
      if (!isBackspace && carriagePosRef.current <= -CARRIAGE_MAX_TRAVEL) {
        setTimeout(() => animateReturn(), carriageDur * 1000);
      }
    }

    // 5 ── Key + linkage returns up ─────────────────────────────────
    if (!isSpace && entry.group) {
      const keyUpStart = isBackspace && isBackspaceRepeat ? keyDownDur : keyDownDur + 0.02;
      const keyUpEase = isBackspace && isBackspaceRepeat ? 'power3.out' : 'elastic.out(1, 0.5)';
      tl.to(entry.group, {
        y: 0,
        duration: keyUpDur,
        ease: keyUpEase,
      }, keyUpStart);
    }

    if (isSpace && reg.spacebar) {
      tl.to(reg.spacebar, {
        y: 0,
        duration: KEY_UP_DUR,
        ease: 'elastic.out(1, 0.5)',
      }, KEY_DOWN_DUR + 0.02);
    }

    if (isBackspace && reg.rightShift?.spring) {
      tl.to(reg.rightShift.spring, {
        scaleY: 1,
        transformOrigin: '50% 100%',
        duration: keyUpDur,
        ease: 'elastic.out(1, 0.5)',
      }, keyDownDur + 0.02);
    }
    if (isBackspace && reg.leftShift?.spring) {
      tl.to(reg.leftShift.spring, {
        scaleY: 1,
        transformOrigin: '50% 0%',
        duration: keyUpDur,
        ease: 'elastic.out(1, 0.5)',
      }, keyDownDur + 0.02);
    }
  }

  // ── Shift (hold / release) ───────────────────────────────────────
  function animateShiftDown(code) {
    const reg = registryRef.current;
    if (!reg) return;

    const isLeft = code === 'ShiftLeft';
    const shift = isLeft ? reg.leftShift : reg.rightShift;

    shiftTlRef.current?.kill();

    const tl = gsap.timeline();
    shiftTlRef.current = tl;

    if (shift.keyCap) {
      tl.to(shift.keyCap, { y: 3, duration: SHIFT_DUR, ease: 'power2.out' }, 0);
    }
    if (shift.spring) {
      tl.to(shift.spring, {
        scaleY: 1.15,
        transformOrigin: isLeft ? '50% 0%' : '50% 100%',
        duration: SHIFT_DUR,
        ease: 'power2.out',
      }, 0);
    }
    if (reg.carriageWrapper) {
      tl.to(reg.carriageWrapper, { y: -SHIFT_LIFT, duration: SHIFT_DUR, ease: 'power2.out' }, 0);
    }
    if (reg.carriageLiftWrapper) {
      tl.to(reg.carriageLiftWrapper, { y: -SHIFT_LIFT, duration: SHIFT_DUR, ease: 'power2.out' }, 0);
    }
  }

  function animateShiftUp() {
    const reg = registryRef.current;
    if (!reg) return;

    shiftTlRef.current?.kill();

    const tl = gsap.timeline();
    shiftTlRef.current = tl;

    [reg.leftShift, reg.rightShift].forEach((shift, idx) => {
      const springOrigin = idx === 0 ? '50% 0%' : '50% 100%';
      if (shift.keyCap) {
        tl.to(shift.keyCap, { y: 0, duration: KEY_UP_DUR, ease: 'elastic.out(1, 0.5)' }, 0);
      }
      if (shift.spring) {
        tl.to(shift.spring, {
          scaleY: 1,
          transformOrigin: springOrigin,
          duration: KEY_UP_DUR,
          ease: 'elastic.out(1, 0.5)',
        }, 0);
      }
    });
    if (reg.carriageWrapper) {
      tl.to(reg.carriageWrapper, { y: 0, duration: KEY_UP_DUR, ease: 'elastic.out(1, 0.5)' }, 0);
    }
    if (reg.carriageLiftWrapper) {
      tl.to(reg.carriageLiftWrapper, { y: 0, duration: KEY_UP_DUR, ease: 'elastic.out(1, 0.5)' }, 0);
    }
  }

  // ── Enter / Carriage return (sequenced: lever lean → carriage slide → lever back) ─
  function animateReturn() {
    const reg = registryRef.current;
    if (!reg) return;

    resumeAudioContextSync();
    playCarriageReturn();
    stepRibbonSpoolDots();

    const tl = gsap.timeline({ defaults: { overwrite: 'auto' } });

    const tLeverDown = 0;
    const tCarriage = tLeverDown + RETURN_LEVER_DUR + RETURN_PAUSE;
    const tLeverUp = tCarriage + RETURN_SLIDE_DUR + RETURN_PAUSE;

    const leverOrigin = reg.returnLeverTransformOrigin
      ? { transformOrigin: reg.returnLeverTransformOrigin }
      : null;
    if (reg.returnLever && leverOrigin) {
      tl.to(reg.returnLever, {
        rotation: RETURN_LEVER_ANGLE,
        ...leverOrigin,
        duration: RETURN_LEVER_DUR,
        ease: 'power2.in',
      }, tLeverDown);
      tl.to(reg.returnLever, {
        rotation: 0,
        ...leverOrigin,
        duration: RETURN_LEVER_DUR * 1.2,
        ease: 'power2.out',
      }, tLeverUp);
    }

    const leverSprings = reg.returnLeverSpring ? [reg.returnLeverSpring] : [];
    leverSprings.forEach((spring) => {
      tl.to(spring, {
        scaleY: 1.2,
        transformOrigin: '50% 100%',
        duration: RETURN_LEVER_DUR,
        ease: 'power2.in',
      }, tLeverDown);
      tl.to(spring, {
        scaleY: 1,
        transformOrigin: '50% 100%',
        duration: RETURN_LEVER_DUR * 1.2,
        ease: 'power2.out',
      }, tLeverUp);
    });

    carriagePosRef.current = CARRIAGE_HOME_X;
    if (reg.carriageWrapper) {
      tl.to(reg.carriageWrapper, {
        x: CARRIAGE_HOME_X,
        duration: RETURN_SLIDE_DUR,
        ease: 'power3.out',
      }, tCarriage);
    }

    const proxy = paperSlideProxyRef.current;
    const nextY = proxy.y - PAPER_ADVANCE_Y;
    if (reg.headedPaper || reg.paperTypingLayer) {
      tl.to(
        proxy,
        {
          y: nextY,
          duration: RETURN_SLIDE_DUR,
          ease: 'power2.out',
          onUpdate: applyPaperSlideTransform,
        },
        tCarriage,
      );
    }
  }

  function liftPaperForForm() {
    const reg = registryRef.current;
    if (!reg?.headedPaper && !reg?.paperTypingLayer) return Promise.resolve();
    const proxy = paperSlideProxyRef.current;
    gsap.killTweensOf(proxy);
    return new Promise((resolve) => {
      gsap.to(proxy, {
        y: proxy.y - 380,
        duration: 1.15,
        ease: 'power2.inOut',
        onUpdate: applyPaperSlideTransform,
        onComplete: resolve,
      });
    });
  }

  async function playPostSubmitThankYouSequence() {
    const reg = registryRef.current;
    if (!reg?.paperLine1El || !reg?.paperLine2El || postSubmitSequenceLockRef.current) return;
    postSubmitSequenceLockRef.current = true;
    introActiveRef.current = true;
    try {
      await liftPaperForForm();

      reg.paperLine1El.textContent = '';
      reg.paperLine2El.textContent = '';

      const sx =
        reg.typedStrikeX ?? parseFloat(reg.paperLine1El.getAttribute('x') || '0');
      const sy =
        reg.typedStrikeLine1Y ?? parseFloat(reg.paperLine1El.getAttribute('y') || '0');
      reg.paperLine1El.setAttribute('x', String(sx));
      reg.paperLine1El.setAttribute('y', String(sy));
      reg.paperLine2El.setAttribute('x', String(sx));
      reg.paperLine2El.setAttribute('y', String(sy + PAPER_ADVANCE_Y));

      if (reg.paperContactFormFO) {
        reg.paperContactFormFO.setAttribute(
          'style',
          'display:none;pointer-events:none;visibility:hidden',
        );
      }

      paperSlideProxyRef.current.y = POST_SUBMIT_SHEET_ENTRANCE_Y;
      applyPaperSlideTransform();

      carriagePosRef.current = CARRIAGE_HOME_X;
      if (reg.carriageWrapper) {
        gsap.killTweensOf(reg.carriageWrapper);
        gsap.set(reg.carriageWrapper, { x: CARRIAGE_HOME_X });
      }

      const proxy = paperSlideProxyRef.current;
      gsap.killTweensOf(proxy);
      await new Promise((resolve) => {
        gsap.to(proxy, {
          y: 0,
          duration: POST_SUBMIT_ENTRANCE_DUR,
          ease: 'power2.out',
          onUpdate: applyPaperSlideTransform,
          onComplete: resolve,
        });
      });

      const stroke = async (ch, lineEl) => {
        const spec = charToKeySpec(ch);
        if (spec.lineBreak || !spec.code) return;
        await sleep(INTRO_CHAR_MS);
        if (spec.shift) {
          animateShiftDown('ShiftLeft');
          await sleep(SHIFT_TAP_MS);
        }
        animateKeyPress(spec.code);
        lineEl.textContent += ch;
        if (spec.shift) {
          await sleep(SHIFT_TAP_MS);
          animateShiftUp();
        }
      };

      for (const ch of THANK_YOU_LINE) {
        await stroke(ch, reg.paperLine1El);
      }
      await sleep(380);
      animateReturn();
      await sleep(RETURN_SEQUENCE_MS);
    } finally {
      introActiveRef.current = false;
      postSubmitSequenceLockRef.current = false;
    }
  }

  /**
   * After intro line 2 we already run animateReturn() (lever + sound + one line of paper).
   * Pass { advancePaper: false } so the sheet does not advance twice.
   */
  function revealFormPaper(options = {}) {
    const { advancePaper = true } = options;
    const reg = registryRef.current;
    if (!reg?.headedPaper && !reg?.paperTypingLayer) return Promise.resolve();
    const proxy = paperSlideProxyRef.current;
    if (advancePaper) {
      gsap.killTweensOf(proxy);
    }
    const dur = 0.92;
    const ease = 'power2.out';
    carriagePosRef.current = CARRIAGE_HOME_X;
    if (reg.carriageWrapper) {
      if (advancePaper) {
        gsap.to(reg.carriageWrapper, {
          x: CARRIAGE_HOME_X,
          duration: dur,
          ease,
          overwrite: 'auto',
        });
      } else {
        gsap.set(reg.carriageWrapper, { x: CARRIAGE_HOME_X });
      }
    }
    if (!advancePaper) return Promise.resolve();
    return gsap
      .to(proxy, {
        y: proxy.y - PAPER_ADVANCE_Y,
        duration: dur,
        ease,
        onUpdate: applyPaperSlideTransform,
      })
      .then();
  }

  function playIntro(onComplete) {
    const reg = registryRef.current;
    if (!reg?.paperLine1El || !reg?.paperLine2El) {
      onComplete?.({ paperFormHost: null, paperContactFormFO: null });
      return;
    }

    introActiveRef.current = true;
    reg.paperLine1El.textContent = '';
    reg.paperLine2El.textContent = '';

    (async () => {
      const stroke = async (ch, lineEl) => {
        const spec = charToKeySpec(ch);
        if (spec.lineBreak || !spec.code) return;
        await sleep(INTRO_CHAR_MS);
        if (spec.shift) {
          animateShiftDown('ShiftLeft');
          await sleep(SHIFT_TAP_MS);
        }
        animateKeyPress(spec.code);
        lineEl.textContent += ch;
        if (spec.shift) {
          await sleep(SHIFT_TAP_MS);
          animateShiftUp();
        }
      };

      for (const ch of INTRO_LINE_1) {
        await stroke(ch, reg.paperLine1El);
      }
      await sleep(280);
      animateReturn();
      await sleep(RETURN_SEQUENCE_MS);
      // Keep line 2 on the same strike row after paper advance:
      // paper moved up by PAPER_ADVANCE_Y, so line 2 baseline must be offset down by same amount.
      const y1 = parseFloat(reg.paperLine1El.getAttribute('y') || '0');
      if (Number.isFinite(y1)) {
        reg.paperLine2El.setAttribute('y', String(y1 + PAPER_ADVANCE_Y));
      }

      for (const ch of INTRO_LINE_2) {
        await stroke(ch, reg.paperLine2El);
      }
      await sleep(420);
      if (reg.paperContactFormFO && reg.formContactLayout) {
        const { x, width } = reg.formContactLayout;
        reg.paperContactFormFO.setAttribute('x', String(x));
        reg.paperContactFormFO.setAttribute('width', String(width));
      }
      layoutContactFormAtRow(reg, 0);
      animateReturn();
      await sleep(RETURN_SEQUENCE_MS);
      await revealFormPaper({ advancePaper: false });
      paperSlideProxyRef.current.y -= FORM_NAME_EXTRA_LIFT_Y;
      applyPaperSlideTransform();
      introActiveRef.current = false;
      onComplete?.({
        paperFormHost: reg.paperFormHost ?? null,
        paperContactFormFO: reg.paperContactFormFO ?? null,
      });
    })();
  }

  // ── Keyboard handlers ────────────────────────────────────────────
  function handleKeyDown(e) {
    if (introActiveRef.current) {
      e.preventDefault();
      return;
    }

    const code = e.code;
    // Resume as early as possible in the keydown stack (stronger user-activation tie-in than only inside playOneShot).
    if (!(e.repeat && code !== 'Backspace')) {
      resumeAudioContextSync();
    }
    const target = e.target;
    const tag = target?.tagName?.toLowerCase();
    const isFormField =
      target && (tag === 'input' || tag === 'textarea' || tag === 'select');

    if (isFormField) {
      if (e.repeat && code !== 'Backspace') return;
      if (SHIFT_CODES.has(code)) {
        if (!heldKeysRef.current.has(code)) {
          heldKeysRef.current.add(code);
          animateShiftDown(code);
          playShiftKey();
        }
        return;
      }
      // Match physical typing: letter/symbol/stroke keys (capture order so we still see portal inputs)
      if (CHARACTER_CODES.has(code)) {
        if (!allowBackspaceTick(e, true)) return;
        animateKeyPress(code, { isBackspaceRepeat: code === 'Backspace' && e.repeat });
      }
      return;
    }

    if (!KEY_MAP[code]) return;

    e.preventDefault();

    if (e.repeat && code !== 'Backspace') return;
    // Don’t use “already in heldKeys” to drop keydowns: a missed keyup would mute the same key until keyup.
    if (!e.repeat) heldKeysRef.current.add(code);

    if (SHIFT_CODES.has(code)) {
      animateShiftDown(code);
      playShiftKey();
    } else if (code === 'Enter') {
      animateReturn();
    } else if (CHARACTER_CODES.has(code)) {
      if (!allowBackspaceTick(e, false)) return;
      animateKeyPress(code, { isBackspaceRepeat: code === 'Backspace' && e.repeat });
    }
  }

  function handleKeyUp(e) {
    const code = e.code;
    heldKeysRef.current.delete(code);

    if (SHIFT_CODES.has(code)) {
      animateShiftUp();
      playShiftKey();
    }
  }

  const setContactFormRow = useCallback((rowIndex) => {
    const reg = registryRef.current;
    layoutContactFormAtRow(reg, rowIndex);
    if (rowIndex === 1) {
      const proxy = paperSlideProxyRef.current;
      const nextY = proxy.y - FORM_STEP_PAPER_SHIFT_Y;
      gsap.killTweensOf(proxy);
      gsap.to(proxy, {
        y: nextY,
        duration: 0.58,
        ease: 'power2.inOut',
        onUpdate: applyPaperSlideTransform,
      });
    }
    if (rowIndex === 1 && reg?.carriageWrapper) {
      carriagePosRef.current = CARRIAGE_HOME_X;
      gsap.to(reg.carriageWrapper, {
        x: CARRIAGE_HOME_X,
        duration: 0.55,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    }
  }, []);

  // ── Public init ──────────────────────────────────────────────────
  const init = useCallback((container) => {
    try {
      registryRef.current = buildPartRegistry(container);
    } catch (err) {
      console.error('Failed to build part registry:', err);
      return;
    }

    const reg = registryRef.current;
    carriagePosRef.current = CARRIAGE_HOME_X;
    if (reg?.carriageWrapper) {
      gsap.set(reg.carriageWrapper, { x: CARRIAGE_HOME_X });
    }

    paperSlideProxyRef.current.y = 0;
    gsap.killTweensOf(paperSlideProxyRef.current);
    if (reg?.headedPaper) gsap.killTweensOf(reg.headedPaper);
    if (reg?.paperTypingLayer) gsap.killTweensOf(reg.paperTypingLayer);
    applyPaperSlideTransform();
    initRibbonSpoolDots(reg);

    if (handlersRef.current.down) {
      window.removeEventListener('keydown', handlersRef.current.down, true);
      window.removeEventListener('keyup', handlersRef.current.up, true);
    }
    handlersRef.current = { down: handleKeyDown, up: handleKeyUp };
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    prefetchClackBuffers();
  }, []);

  return {
    init,
    playIntro,
    liftPaperForForm,
    playPostSubmitThankYouSequence,
    animateKeyPress,
    setContactFormRow,
  };
}
