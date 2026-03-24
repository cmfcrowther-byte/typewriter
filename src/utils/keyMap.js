/**
 * Maps KeyboardEvent.code values to SVG element IDs in the typewriter drawing.
 * Each entry: { groupId, typebarNum } where groupId is the parent <g> that
 * contains both the key-cap sub-group and the TypebarLinkage sub-group,
 * and typebarNum is the corresponding Typebar element number (null for
 * keys that have no typebar, like Space / Shift / Enter).
 * IDs match inkscape:label / author naming in Typewriter2.svg.
 */

export const KEY_MAP = {
  // ── Letters ──────────────────────────────────────────────
  KeyA:        { groupId: 'KeyboardAKey',                        typebarNum: 4  },
  KeyB:        { groupId: 'KeyboardBKey',                        typebarNum: 22 },
  KeyC:        { groupId: 'KeyboardCKey',                        typebarNum: 14 },
  KeyD:        { groupId: 'KeyboardDKey',                        typebarNum: 12 },
  KeyE:        { groupId: 'KeyboardEKey',                        typebarNum: 11 },
  KeyF:        { groupId: 'KeyboardFKey',                        typebarNum: 16 },
  KeyG:        { groupId: 'KeyboardGKey',                        typebarNum: 20 },
  KeyH:        { groupId: 'KeyboardHKey',                        typebarNum: 24 },
  KeyI:        { groupId: 'KeyboardIKey',                        typebarNum: 31 },
  KeyJ:        { groupId: 'KeyboardJKey',                        typebarNum: 28 },
  KeyK:        { groupId: 'KeyboardKKey',                        typebarNum: 32 },
  KeyL:        { groupId: 'KeyboardLKey',                        typebarNum: 36 },
  KeyM:        { groupId: 'KeyboardMKey',                        typebarNum: 30 },
  KeyN:        { groupId: 'KeyboardNKey',                        typebarNum: 26 },
  KeyO:        { groupId: 'KeyboardOKey',                        typebarNum: 35 },
  KeyP:        { groupId: 'KeyboardPKey',                        typebarNum: 39 },
  KeyQ:        { groupId: 'KeyboardQKey',                        typebarNum: 3  },
  KeyR:        { groupId: 'KeyboardRKey',                        typebarNum: 15 },
  KeyS:        { groupId: 'KeyboardSKey',                        typebarNum: 8  },
  KeyT:        { groupId: 'KeyboardTKey',                        typebarNum: 19 },
  KeyU:        { groupId: 'KeyboardUKey',                        typebarNum: 27 },
  KeyV:        { groupId: 'KeyboardVKey',                        typebarNum: 18 },
  KeyW:        { groupId: 'KeyboardWKey',                        typebarNum: 7  },
  KeyX:        { groupId: 'KeyboardXKey',                        typebarNum: 10 },
  KeyY:        { groupId: 'KeyboardYKey',                        typebarNum: 23 },
  KeyZ:        { groupId: 'KeyboardZKey',                        typebarNum: 6  },

  // ── Digits ───────────────────────────────────────────────
  Digit1:      { groupId: 'Keyboard1Key',                        typebarNum: 2  },
  Digit2:      { groupId: 'Keyboard2Key',                        typebarNum: 5  },
  Digit3:      { groupId: 'Keyboard3Key',                        typebarNum: 9  },
  Digit4:      { groupId: 'Keyboard4Key',                        typebarNum: 13 },
  Digit5:      { groupId: 'Keyboard5Key',                        typebarNum: 17 },
  Digit6:      { groupId: 'Keyboard6Key',                        typebarNum: 21 },
  Digit7:      { groupId: 'Keyboard7Key',                        typebarNum: 25 },
  Digit8:      { groupId: 'Keyboard8Key',                        typebarNum: 29 },
  Digit9:      { groupId: 'Keyboard9Key',                        typebarNum: 33 },
  Digit0:      { groupId: 'Keyboard0Key',                        typebarNum: 37 },

  // ── Punctuation / Symbols ────────────────────────────────
  Semicolon:   { groupId: 'KeyboardSemicolonKey',                 typebarNum: 40 },
  Quote:       { groupId: 'KeyboardQuoteKey',                     typebarNum: 44 },
  // In latest SVG this key still exists, but Typebar47/TB47* were removed.
  Backquote:   { groupId: 'KeyboardTildaKey',                     typebarNum: null },
  BracketRight:{ groupId: 'KeyboardRightSquareBracketKey',        typebarNum: 46 },
  Backslash:   { groupId: 'KeyboardBackSlashKey',                 typebarNum: 1  },
  IntlBackslash: { groupId: 'KeyboardBackSlashKey',               typebarNum: 1  },
  Comma:       { groupId: 'KeyboardCommaKey',                     typebarNum: 34 },
  Period:      { groupId: 'KeyboardFullStopKey',                  typebarNum: 38 },
  Slash:       { groupId: 'KeyboardForwardSlashKey',              typebarNum: 42 },
  BracketLeft: { groupId: 'KeyboardLeftSquareBracketKey',         typebarNum: 43 },
  Minus:       { groupId: 'KeyboardHyphenKey',                    typebarNum: 41 },
  Equal:       { groupId: 'KeyboardEqualsKey',                    typebarNum: 45 },

  // ── Special Keys ─────────────────────────────────────────
  Backspace:   { groupId: 'KeyboardBackSpaceKey',                  typebarNum: null },
  Space:       { groupId: 'KeyboardSpacebarKey',                  typebarNum: null },
  ShiftLeft:   { groupId: 'KeyboardLeftShiftKey',                 typebarNum: null },
  ShiftRight:  { groupId: 'KeyboardBackSpaceKey',                 typebarNum: null },
  Enter:       { groupId: 'CarriageReturnLever',                  typebarNum: null },
};

export const CHARACTER_CODES = new Set(
  Object.keys(KEY_MAP).filter(
    (c) => c !== 'ShiftLeft' && c !== 'ShiftRight' && c !== 'Enter',
  ),
);

export const SHIFT_CODES = new Set(['ShiftLeft', 'ShiftRight']);
