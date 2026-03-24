import { KEY_MAP } from './keyMap.js';

/**
 * Map a typed character to a KeyboardEvent.code + shift (US-style layout for @).
 */
export function charToKeySpec(ch) {
  if (ch === ' ') return { code: 'Space', shift: false };
  if (ch === '\n') return { code: null, shift: false, lineBreak: true };

  const punct = {
    '.': ['Period', false],
    ',': ['Comma', false],
    '!': ['Digit1', true],
    '?': ['Slash', true],
    '@': ['Digit2', true],
    '-': ['Minus', false],
    _: ['Minus', true],
    ':': ['Semicolon', true],
    ';': ['Semicolon', false],
    "'": ['Quote', false],
    '"': ['Quote', true],
    '/': ['Slash', false],
  };
  if (punct[ch]) {
    const [code, shift] = punct[ch];
    return KEY_MAP[code] ? { code, shift } : { code: null, shift: false };
  }

  if (/^[a-z]$/.test(ch)) {
    const code = `Key${ch.toUpperCase()}`;
    return KEY_MAP[code] ? { code, shift: false } : { code: null, shift: false };
  }
  if (/^[A-Z]$/.test(ch)) {
    const code = `Key${ch}`;
    return KEY_MAP[code] ? { code, shift: true } : { code: null, shift: false };
  }
  if (/^[0-9]$/.test(ch)) {
    const code = ch === '0' ? 'Digit0' : `Digit${ch}`;
    return KEY_MAP[code] ? { code, shift: false } : { code: null, shift: false };
  }

  return { code: null, shift: false };
}
