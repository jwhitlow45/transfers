// iOS offers to undo typing whenever the phone is shaken, as on a bus or when the rider reopens the
// app, for as long as the page keeps any typing it could undo, and only loading the page again
// clears that. So on iOS a text field puts in what the keyboard sends itself, which leaves the
// system nothing to undo. Text an input method composes, as for Japanese, still goes in the
// system's way, and so does anything else this does not cover.
const ios = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// For a text field's `onBeforeInput`.
export function typeWithoutUndo(event: InputEvent) {
  if (!ios || event.isComposing) return;
  const input = event.currentTarget as HTMLInputElement;
  const { value, selectionStart, selectionEnd } = input;
  if (selectionStart === null || selectionEnd === null) return;
  let from = selectionStart;
  let to = selectionEnd;
  let text = '';
  const collapsed = from === to;
  switch (event.inputType) {
    case 'insertText':
      text = event.data ?? '';
      break;
    case 'insertFromPaste':
    case 'insertFromDrop': {
      const pasted = event.data ?? event.dataTransfer?.getData('text/plain');
      if (pasted === undefined) return;
      // A text field holds one line.
      text = pasted.replace(/\s*[\r\n]+\s*/g, ' ');
      break;
    }
    case 'deleteContentBackward':
      if (collapsed) from = boundaryBefore(value, from);
      break;
    case 'deleteContentForward':
      if (collapsed) to = boundaryAfter(value, to);
      break;
    case 'deleteWordBackward':
      if (collapsed) from = wordStart(value, from);
      break;
    case 'deleteWordForward':
      if (collapsed) to = wordEnd(value, to);
      break;
    case 'deleteSoftLineBackward':
    case 'deleteHardLineBackward':
      if (collapsed) from = 0;
      break;
    case 'deleteSoftLineForward':
    case 'deleteHardLineForward':
      if (collapsed) to = value.length;
      break;
    case 'historyUndo':
    case 'historyRedo':
      // Nothing was left to undo.
      event.preventDefault();
      return;
    default:
      return;
  }
  event.preventDefault();
  if (from === to && text === '') return;
  input.setRangeText(text, from, to, 'end');
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: event.inputType, data: text || null }));
}

// Where the character before or after `at` starts, so deleting takes a whole emoji or accented
// letter.
function boundaries(value: string) {
  if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(({ index }) => index).concat(value.length);
  const points: number[] = [];
  let index = 0;
  for (const point of value) {
    points.push(index);
    index += point.length;
  }
  return points.concat(value.length);
}

const boundaryBefore = (value: string, at: number) => boundaries(value).findLast((index) => index < at) ?? 0;
const boundaryAfter = (value: string, at: number) => boundaries(value).find((index) => index > at) ?? value.length;

// Back over spaces, then over the word before them, as holding delete does.
function wordStart(value: string, at: number) {
  let index = at;
  while (index > 0 && /\s/.test(value[index - 1]!)) index--;
  while (index > 0 && !/\s/.test(value[index - 1]!)) index--;
  return index;
}

function wordEnd(value: string, at: number) {
  let index = at;
  while (index < value.length && /\s/.test(value[index]!)) index++;
  while (index < value.length && !/\s/.test(value[index]!)) index++;
  return index;
}
