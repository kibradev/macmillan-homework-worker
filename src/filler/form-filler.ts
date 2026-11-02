import { Question } from '../types/question';
import { validateElementSafety } from './safety-validator';
import { queryAllDeep } from '../extractor/dom-scanner';

export function findDeepElement(root: Document | Element | ShadowRoot, selector: string): HTMLElement | null {
  if (!selector) return null;

  try {
    const el = root.querySelector(selector) as HTMLElement | null;
    if (el) return el;
  } catch {}

  // Pierce shadow roots and same-origin iframes recursively
  const all = Array.from(root.querySelectorAll('*'));
  for (const child of all) {
    if (child.shadowRoot) {
      const found = findDeepElement(child.shadowRoot, selector);
      if (found) return found;
    }
    if (child instanceof HTMLIFrameElement) {
      try {
        if (child.contentDocument && child.contentDocument.body) {
          const found = findDeepElement(child.contentDocument, selector);
          if (found) return found;
        }
      } catch {}
    }
  }

  return null;
}

/** Lowercase, drop punctuation/typographic differences so "Mark's happy – …" matches "Marks happy ...". */
function normalizeOptionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’‘`]/g, '') // "Mark's" and "Marks" must compare equal
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Ticks one checkbox chip and verifies it. A checkbox *toggles*, so unlike radios it must not be clicked
 * repeatedly: try one gentle strategy at a time and stop as soon as aria-checked turns true.
 */
async function tickCheckbox(el: HTMLElement): Promise<boolean> {
  const isTicked = () => el.getAttribute('aria-checked') === 'true';
  if (isTicked()) return true;

  const view = (el.ownerDocument.defaultView || window) as any;
  const strategies: Array<() => void> = [
    () => el.click(),
    () => {
      const init = { bubbles: true, cancelable: true, view };
      el.dispatchEvent(new PointerEvent('pointerdown', init));
      el.dispatchEvent(new MouseEvent('mousedown', init));
      el.dispatchEvent(new PointerEvent('pointerup', init));
      el.dispatchEvent(new MouseEvent('mouseup', init));
      el.dispatchEvent(new MouseEvent('click', init));
    },
    () => {
      el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true, view }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, cancelable: true, view }));
    },
  ];

  for (const strategy of strategies) {
    strategy();
    await new Promise((r) => setTimeout(r, 300));
    if (isTicked()) return true;
  }
  return false;
}

/**
 * Index of the <option> an answer refers to, or -1.
 * The empty "clear" entry must never match: 'anything'.includes('') is true, so a naive substring test lands on it.
 * Exact matches win. A partial match is only a fallback: whole words only, at least 3 characters, longest option
 * text preferred ("no" must not match "not enough information").
 */
export function findOptionIndex(options: ArrayLike<{ value: string; text: string }>, answer: string): number {
  const wanted = normalizeOptionText(answer);
  const rawAnswer = answer.trim().toLowerCase();
  if (!wanted) return -1;

  const entries = Array.from(options).map((opt, index) => ({
    index,
    value: (opt.value || '').trim().toLowerCase(),
    text: normalizeOptionText(opt.text || ''),
  }));

  const exact = entries.find((e) => e.text && (e.text === wanted || (e.value && e.value === rawAnswer)));
  if (exact) return exact.index;

  const padded = (text: string) => ` ${text} `;
  const partial = entries
    .filter(
      (e) =>
        e.text &&
        Math.min(e.text.length, wanted.length) >= 3 &&
        (padded(e.text).includes(padded(wanted)) || padded(wanted).includes(padded(e.text)))
    )
    .sort((a, b) => b.text.length - a.text.length)[0];
  return partial ? partial.index : -1;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Presses `item`, moves the pointer to `end` in a few steps and releases: the events a jQuery UI draggable/sortable listens to. */
async function mouseDrag(item: HTMLElement, from: { x: number; y: number }, end: { x: number; y: number }): Promise<void> {
  const doc = item.ownerDocument;
  const view = (doc.defaultView || window) as any;
  const fire = (target: EventTarget, type: string, point: { x: number; y: number }, buttons: number) =>
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view,
        clientX: point.x,
        clientY: point.y,
        screenX: point.x,
        screenY: point.y,
        button: 0,
        buttons,
      })
    );

  item.focus?.();
  fire(item, 'mousedown', from, 1);
  await sleep(30);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    fire(doc, 'mousemove', { x: from.x + (end.x - from.x) * t, y: from.y + (end.y - from.y) * t }, 1);
    await sleep(25);
  }
  fire(doc, 'mouseup', end, 0);
  await sleep(150);
}

const centreOf = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, right: r.right };
};

/**
 * Drags `item` onto the place of `destination`. The pointer ends slightly past the destination's centre so it swaps.
 */
async function dragOntoItem(item: HTMLElement, destination: HTMLElement): Promise<void> {
  item.scrollIntoView?.({ block: 'center', inline: 'center' });
  const from = centreOf(item);
  const to = centreOf(destination);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const end = {
    x: to.x + (horizontal ? Math.sign(dx) * to.w * 0.25 : 0),
    y: to.y + (horizontal ? 0 : Math.sign(dy) * to.h * 0.25),
  };
  await mouseDrag(item, from, end);
}

/** Drops `item` at the far end of `list`, where a new word is appended. */
async function dragItemToEndOf(item: HTMLElement, list: HTMLElement): Promise<void> {
  item.scrollIntoView?.({ block: 'center', inline: 'center' });
  const to = centreOf(list);
  await mouseDrag(item, centreOf(item), { x: to.right - 4, y: to.y });
}

/**
 * Puts the words of an ordering question in the order given by the answer ("Would || you || mind || ...").
 * Fixed items (punctuation, a fixed first word) keep their slots. Every drag is verified by reading the list back,
 * so a sortable that ignores the events is reported instead of silently "succeeding".
 */
async function fillOrdering(
  doc: Document,
  question: Question,
  approvedAnswer: string
): Promise<{ success: boolean; error?: string }> {
  const selector = question.fields[0]?.selector || question.metadata?.containerSelector || '';
  const container = selector ? findDeepElement(doc, selector) : null;
  const list = container?.querySelector('ul') as HTMLElement | null;
  if (!container || !list) {
    return { success: false, error: `Sıralama listesi bulunamadı (soru ${question.index}).` };
  }

  const itemsNow = () => Array.from(list.children).filter((node) => node.matches('li')) as HTMLElement[];
  const isFixed = (li: HTMLElement) => li.classList.contains('fixed') || li.getAttribute('data-fixed') === 'y';
  const wordOf = (li: HTMLElement) => normalizeOptionText(li.getAttribute('data-ordervalue') || li.textContent || '');
  // Items are identified by their rcfid, fixed ones by their (never changing) slot, so a re-rendered node is still found
  const keyOf = (li: HTMLElement, index: number) => (!isFixed(li) && li.getAttribute('data-rcfid')) || `fixed@${index}`;

  const wanted = approvedAnswer
    .split('||')
    .map((part) => normalizeOptionText(part))
    .filter(Boolean);
  const movable = itemsNow().filter((li) => !isFixed(li));
  if (wanted.length !== movable.length) {
    return { success: false, error: `${movable.length} kelime bekleniyordu ama cevapta ${wanted.length} var.` };
  }

  // Match each wanted word to a distinct element: the same word can appear twice ("you ... you")
  const pool = [...movable];
  const desiredKeys: string[] = [];
  for (const word of wanted) {
    const at = pool.findIndex((li) => wordOf(li) === word);
    if (at < 0) return { success: false, error: `"${word}" listedeki kelimelerden biri değil.` };
    desiredKeys.push(keyOf(pool.splice(at, 1)[0], -1));
  }

  let nextWord = 0;
  const targetKeys = itemsNow().map((li, index) => (isFixed(li) ? keyOf(li, index) : desiredKeys[nextWord++]));
  const currentKeys = () => itemsNow().map(keyOf);
  const inOrder = () => currentKeys().every((key, index) => key === targetKeys[index]);
  const itemWithKey = (key: string) => itemsNow().find((li, index) => keyOf(li, index) === key);

  for (let pass = 0; pass < 3 && !inOrder(); pass++) {
    for (let position = 0; position < targetKeys.length; position++) {
      const now = itemsNow();
      if (keyOf(now[position], position) === targetKeys[position]) continue;
      const item = itemWithKey(targetKeys[position]);
      if (item) await dragOntoItem(item, now[position]);
    }
  }

  if (inOrder()) {
    flashHighlight(container);
    return { success: true };
  }
  return {
    success: false,
    error: `Kelimeler sürüklenemedi. Şu anki sıra: ${itemsNow().map((li) => li.textContent?.trim()).join(' ')}`,
  };
}

/** Key of a word-bank entry. Punctuation marks (".", "?") are words too and must not normalise to nothing. */
function wordKey(text: string): string {
  return normalizeOptionText(text) || text.trim();
}

/**
 * Builds a sentence from the word bank ("we're || thinking || about || ... || ."). Each word is added with a click
 * first (what the touch layout of the activity uses) and, if the sentence does not grow, by dragging it into the list.
 * After every word the sentence is read back, so a page that ignores both is reported instead of "succeeding".
 */
async function fillSentenceBuilder(
  doc: Document,
  question: Question,
  approvedAnswer: string
): Promise<{ success: boolean; error?: string }> {
  const selector = question.fields[0]?.selector || question.metadata?.containerSelector || '';
  const container = selector ? findDeepElement(doc, selector) : null;
  const list = container?.querySelector('.sentenceBuilder ul, ul.sentenceWordList, ul.itemSentenceWordList') as HTMLElement | null;
  if (!container || !list) {
    return { success: false, error: `Cümle alanı bulunamadı (soru ${question.index}).` };
  }

  const placed = () =>
    (Array.from(list.children).filter((node) => node.matches('li')) as HTMLElement[])
      .map((li) => wordKey(li.getAttribute('data-originalvalue') || li.textContent || ''))
      .filter(Boolean);
  const bankItems = () => Array.from(container.querySelectorAll('.wordBox li')) as HTMLElement[];
  const textOf = (li: HTMLElement) => wordKey(li.getAttribute('data-originalvalue') || li.textContent || '');

  // Messages quote the words the way the learner sees them, matching uses the normalised keys
  const spoken = approvedAnswer
    .split('||')
    .map((part) => part.trim())
    .filter((part) => wordKey(part));
  const wanted = spoken.map(wordKey);
  if (wanted.length === 0) return { success: false, error: 'Cevapta kelime yok.' };

  // Words already in the sentence (a second run) must be a prefix of the answer; anything else is left alone
  const already = placed();
  if (already.length > wanted.length || already.some((word, i) => word !== wanted[i])) {
    return { success: false, error: 'Cümle alanında zaten başka kelimeler var; önce onları temizle.' };
  }
  if (already.length === wanted.length) {
    flashHighlight(container);
    return { success: true };
  }

  // Map each remaining word to a distinct, still available bank entry
  const taken = new Set<HTMLElement>();
  const plan: HTMLElement[] = [];
  for (const [position, word] of wanted.slice(already.length).entries()) {
    const entry = bankItems().find((li) => !taken.has(li) && !li.classList.contains('dragged') && textOf(li) === word);
    if (!entry) return { success: false, error: `"${spoken[already.length + position]}" kelime listesinde yok ya da zaten kullanılmış.` };
    taken.add(entry);
    plan.push(entry);
  }

  const grewTo = async (count: number) => {
    for (let waited = 0; waited < 800; waited += 100) {
      if (placed().length >= count) return true;
      await sleep(100);
    }
    return placed().length >= count;
  };

  for (const [offset, entry] of plan.entries()) {
    const target = already.length + offset + 1;
    entry.scrollIntoView?.({ block: 'center', inline: 'center' });

    entry.click();
    if (!(await grewTo(target))) {
      await dragItemToEndOf(entry, list);
      if (!(await grewTo(target))) {
        return { success: false, error: `"${spoken[target - 1]}" cümleye eklenemedi (tıklama ve sürükleme işe yaramadı).` };
      }
    }
  }

  const final = placed();
  if (final.length === wanted.length && final.every((word, i) => word === wanted[i])) {
    flashHighlight(container);
    return { success: true };
  }
  return { success: false, error: `Cümle beklenenden farklı çıktı: ${final.join(' ')}` };
}

/** Ticks every option named in a multiple_select answer ("A || B || C"); options already ticked are left alone. */
async function fillMultiSelect(
  doc: Document,
  question: Question,
  approvedAnswer: string
): Promise<{ success: boolean; error?: string }> {
  const options = question.options || [];
  let wanted = approvedAnswer
    .split('||')
    .map((part) => normalizeOptionText(part))
    .filter(Boolean);
  const limit = question.metadata?.selectCount;
  if (limit && wanted.length > limit) wanted = wanted.slice(0, limit);

  const missing: string[] = [];
  let ticked = 0;
  for (const want of wanted) {
    const option =
      options.find((o) => normalizeOptionText(o.label) === want) ||
      options.find((o) => want.length > 3 && (normalizeOptionText(o.label).includes(want) || want.includes(normalizeOptionText(o.label))));
    const el = option?.elementSelector ? findDeepElement(doc, option.elementSelector) : null;
    if (!el) {
      missing.push(want);
      continue;
    }
    if (await tickCheckbox(el)) {
      flashHighlight(el);
      ticked++;
    } else {
      missing.push(want);
    }
  }

  if (ticked === 0) {
    return { success: false, error: `No matching option found for multiple-select answer (Q#${question.index}).` };
  }
  if (missing.length > 0) {
    console.warn('[StudyPilot] multiple_select: no option matched for', missing);
  }
  return { success: missing.length === 0, error: missing.length ? `Could not match: ${missing.join('; ')}` : undefined };
}

export async function fillFormField(
  doc: Document,
  question: Question,
  approvedAnswer: string
): Promise<{ success: boolean; error?: string }> {
  console.log('[StudyPilot] fillFormField starting for Q#' + question.index, {
    approvedAnswer,
    fields: question.fields,
    containerSelector: question.metadata?.containerSelector,
  });

  if (!approvedAnswer && approvedAnswer !== '0') {
    return { success: false, error: 'No approved answer provided to fill.' };
  }

  const cleanAnswer = approvedAnswer.trim().toLowerCase();

  // Tick-box groups take several answers at once and have their own flow
  if (question.type === 'multiple_select') {
    return fillMultiSelect(doc, question, approvedAnswer);
  }

  // Word-ordering lists are rearranged by dragging
  if (question.type === 'ordering') {
    return fillOrdering(doc, question, approvedAnswer);
  }

  // Sentence builders (item-based): words go from the bank into the sentence
  if (question.type === 'sentence_builder') {
    return fillSentenceBuilder(doc, question, approvedAnswer);
  }

  // 1. If this is a Dropdown question, handle select element directly!
  if (question.type === 'dropdown') {
    for (const field of question.fields) {
      const el = findDeepElement(doc, field.selector);
      if (el) {
        const filled = await fillAnyElement(doc, el, approvedAnswer);
        if (filled) return { success: true };
      }
    }
  }

  // 2. Multiple choice & True/False handling (only for non-dropdown)
  if ((question.type === 'multiple_choice' || question.type === 'true_false') && (question.options && question.options.length > 0)) {
    let matchedOptionIndex = -1;
    if (/^[a-d]$/i.test(cleanAnswer) && question.options) {
      const letterCode = cleanAnswer.toUpperCase().charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
      if (letterCode >= 0 && letterCode < question.options.length) {
        matchedOptionIndex = letterCode;
      }
    }

    if (question.options && question.options.length > 0) {
      const textIndex = findOptionIndex(
        question.options.map((o) => ({ value: o.value, text: o.label })),
        approvedAnswer
      );
      const matchedOpt =
        (matchedOptionIndex >= 0 ? question.options[matchedOptionIndex] : null) ||
        (textIndex >= 0 ? question.options[textIndex] : null);

      if (!matchedOpt) {
        return {
          success: false,
          error: `The answer "${approvedAnswer}" does not match any option of Question #${question.index}.`,
        };
      }

      // Only use matchedOpt.elementSelector if field itself is NOT a droppable gap
      const isDroppableQuestion = question.fields.some((f) => f.id.includes('drag') || f.name?.includes('gap'));
      if (!isDroppableQuestion && matchedOpt && matchedOpt.elementSelector) {
        const el = findDeepElement(doc, matchedOpt.elementSelector);
        if (el && (await fillAnyElement(doc, el, approvedAnswer))) {
          console.log('[StudyPilot] Successfully matched and filled via matchedOpt selector');
          return { success: true };
        }
      }
    }

    // Check fields for radio buttons or choice items
    for (const field of question.fields) {
      const isMatch =
        field.currentValue?.toLowerCase() === cleanAnswer ||
        field.label?.toLowerCase() === cleanAnswer ||
        field.label?.toLowerCase().includes(cleanAnswer);

      if (isMatch) {
        const el = findDeepElement(doc, field.selector);
        if (el && (await fillAnyElement(doc, el, approvedAnswer))) {
          console.log('[StudyPilot] Successfully matched and filled via radio field selector');
          return { success: true };
        }
      }
    }
  }

  // 2. Direct field selector lookup (Inputs, Selects, Contenteditable, Click-to-Edit Words)
  for (const field of question.fields) {
    console.log('[StudyPilot] Trying field.selector:', field.selector);
    const el = findDeepElement(doc, field.selector);
    if (el) {
      console.log('[StudyPilot] Found element for field.selector:', el);
      const filled = await fillAnyElement(doc, el, approvedAnswer);
      if (filled) return { success: true };
    } else {
      console.warn('[StudyPilot] Element not found for selector:', field.selector);
    }
  }

  // 3. Fallback: Search within question container if specified
  if (question.metadata?.containerSelector) {
    console.log('[StudyPilot] Searching within container:', question.metadata.containerSelector);
    const container = findDeepElement(doc, question.metadata.containerSelector);
    if (container) {
      const innerTarget = container.querySelector(
        'input:not([type="hidden"]):not([type="submit"]), select, textarea, [contenteditable="true"], [role="textbox"], [class*="word"], [class*="gap"], [class*="token"], [class*="clickable"], [class*="error"], [class*="item"]'
      ) as HTMLElement | null;

      if (innerTarget && (await fillAnyElement(doc, innerTarget, approvedAnswer))) {
        console.log('[StudyPilot] Filled element found within container:', innerTarget);
        return { success: true };
      }
    } else {
      console.warn('[StudyPilot] Container not found:', question.metadata.containerSelector);
    }
  }

  // 4. Fallback: Search by ID, Name or data-rcfid attribute (e.g. id="typein1", name="typein1", data-rcfid="typein_1")
  for (const field of question.fields) {
    if (field.name) {
      const elByName = findDeepElement(doc, `[name="${CSS.escape(field.name)}"]`) ||
                       findDeepElement(doc, `#${CSS.escape(field.name)}`) ||
                       findDeepElement(doc, `[data-rcfid="${CSS.escape(field.name)}"]`);
      if (elByName && (await fillAnyElement(doc, elByName, approvedAnswer))) {
        console.log('[StudyPilot] Matched and filled via field.name:', field.name);
        return { success: true };
      }
    }
  }

  // 5. Smart Type-Based Fallback Matching
  if (question.type === 'multiple_choice' || (question.options && question.options.length > 0)) {
    // Check direct Macmillan radioItemSelect by id (e.g. #radio_1, #radio_2)
    const directRadioGroup = findDeepElement(doc, `#radio_${question.index}`) ||
                            findDeepElement(doc, `[data-rcfid="radio_${question.index}"]`);
    if (directRadioGroup) {
      const items = Array.from(directRadioGroup.querySelectorAll('.selectable, .radio, .dev-list-item, [data-rcfid*="item"]')) as HTMLElement[];
      const chipIndex = findOptionIndex(
        items.map((it) => ({ value: '', text: it.textContent || '' })),
        approvedAnswer
      );
      if (chipIndex >= 0) {
        console.log('[StudyPilot] Matched Macmillan radio chip item:', items[chipIndex]);
        if (await fillAnyElement(doc, items[chipIndex], approvedAnswer)) return { success: true };
      }
    }

    // Check direct Macmillan complexDroppable gap by index
    const directDroppable = findDeepElement(doc, `[data-rcfid="complexDroppable_${question.index}"]`) ||
                            findDeepElement(doc, `[data-rcfid="cd_${question.index}"]`) ||
                            findDeepElement(doc, `#complexDroppable_${question.index}`);
    if (directDroppable) {
      console.log('[StudyPilot] Matched directly by Macmillan complexDroppable index:', question.index);
      if (await fillAnyElement(doc, directDroppable, approvedAnswer)) return { success: true };
    }

    const allDroppableGaps = Array.from(doc.querySelectorAll('[data-rcfinteraction="complexDroppable"]'))
      .filter((el, idx, arr) => arr.indexOf(el) === idx) as HTMLElement[];
    if (allDroppableGaps.length >= question.index) {
      const targetGap = allDroppableGaps[question.index - 1];
      if (targetGap && (await fillAnyElement(doc, targetGap, approvedAnswer))) {
        console.log('[StudyPilot] Matched by global droppable gap index:', question.index);
        return { success: true };
      }
    }

    // Check select by id
    const directSelect = findDeepElement(doc, `#ui-id-${question.index}`) ||
                         findDeepElement(doc, `select#ui-id-${question.index}`);
    if (directSelect && (await fillAnyElement(doc, directSelect, approvedAnswer))) {
      console.log('[StudyPilot] Matched directly by #ui-id- index:', question.index);
      return { success: true };
    }

    const allSelects = queryAllDeep(doc, 'select');
    if (allSelects.length >= question.index) {
      const targetSelect = allSelects[question.index - 1];
      if (targetSelect && (await fillAnyElement(doc, targetSelect, approvedAnswer))) {
        console.log('[StudyPilot] Matched by global select index:', question.index);
        return { success: true };
      }
    }
  } else {
    // Check Macmillan input by index directly (e.g. #typein1, #typein2... or nth markedTextInput)
    const directIdInput = findDeepElement(doc, `#typein${question.index}`) ||
                          findDeepElement(doc, `[name="typein${question.index}"]`) ||
                          findDeepElement(doc, `[data-rcfid="typein_${question.index}"]`);
    if (directIdInput && (await fillAnyElement(doc, directIdInput, approvedAnswer))) {
      console.log('[StudyPilot] Matched directly by Macmillan typein index:', question.index);
      return { success: true };
    }

    const allInputs = queryAllDeep(doc, 'input.text, input.markedTextInput, input[name*="typein"]');
    if (allInputs.length >= question.index) {
      const targetInput = allInputs[question.index - 1];
      if (targetInput && (await fillAnyElement(doc, targetInput, approvedAnswer))) {
        console.log('[StudyPilot] Matched by global input index:', question.index);
        return { success: true };
      }
    }
  }
  // 7. Fallback for containers
  const allQuestionContainers = Array.from(
    doc.querySelectorAll(
      '.exercise-item, .question-item, .question-card, .activity-item, [class*="exercise-item"], [class*="activity-item"], [class*="sentence"], [class*="gap-fill"], [data-question-id]'
    )
  ) as HTMLElement[];

  if (allQuestionContainers.length >= question.index) {
    const targetContainer = allQuestionContainers[question.index - 1];
    if (targetContainer) {
      const innerTarget = targetContainer.querySelector(
        'input:not([type="hidden"]):not([type="submit"]), select, textarea, [contenteditable="true"], [role="textbox"], [class*="word"], [class*="gap"], [class*="token"], [class*="error"], [class*="clickable"]'
      ) as HTMLElement | null;
      if (innerTarget && (await fillAnyElement(doc, innerTarget, approvedAnswer))) {
        return { success: true };
      }
    }
  }

  return {
    success: false,
    error: `Could not match DOM element for Question #${question.index}. Checked ${question.fields.length} selectors.`,
  };
}

/**
 * Macmillan's word box can be a carousel (prev/next buttons) that only shows the `.active` word.
 * A word that is not active cannot be picked, so page through until the wanted one is active.
 */
async function revealWordBoxItem(wordBox: HTMLElement, word: HTMLElement): Promise<void> {
  const prev = wordBox.querySelector('.itemNavigation.previousItem') as HTMLElement | null;
  const next = wordBox.querySelector('.itemNavigation.nextItem') as HTMLElement | null;
  const list = word.parentElement;
  if (!prev || !next || !list) return; // plain word box: every word is already reachable

  const items = Array.from(list.children) as HTMLElement[];
  for (let step = 0; step < items.length + 2; step++) {
    const active = items.find((li) => li.classList.contains('active'));
    if (!active || active === word) return;

    const forward = items.indexOf(word) > items.indexOf(active);
    const button = forward ? next : prev;
    if ((button as HTMLButtonElement).disabled) return;
    button.click();
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * Macmillan "locating" with a choice list: click the wrong phrase to open its popup, then click the right option.
 * The popup toggles, so every step is a single click and the outcome is verified instead of clicking blindly.
 */
async function pickLocatingChoice(root: HTMLElement, openTarget: HTMLElement, answer: string): Promise<boolean> {
  const wanted = normalizeOptionText(answer);
  const choices = Array.from(root.querySelectorAll('.locatingSpanPopup:not(.clear)')) as HTMLElement[];
  const choice =
    choices.find((c) => normalizeOptionText(c.textContent || '') === wanted) ||
    choices.find((c) => wanted.length > 3 && normalizeOptionText(c.textContent || '').includes(wanted));
  if (!choice) {
    console.warn('[StudyPilot] locating: no popup option matches', answer);
    return false;
  }

  const answerEl = root.querySelector('.locating_answer');
  const chosenText = normalizeOptionText(choice.textContent || '');
  // Without a visible answer slot there is nothing to verify against
  const isDone = () => !answerEl || normalizeOptionText(answerEl.textContent || '') === chosenText;
  if (isDone() && answerEl && (answerEl.textContent || '').trim()) return true;

  const view = (root.ownerDocument.defaultView || window) as any;
  const press = (el: HTMLElement) => {
    const init = { bubbles: true, cancelable: true, view };
    el.dispatchEvent(new PointerEvent('pointerdown', init));
    el.dispatchEvent(new MouseEvent('mousedown', init));
    el.dispatchEvent(new PointerEvent('pointerup', init));
    el.dispatchEvent(new MouseEvent('mouseup', init));
    el.dispatchEvent(new MouseEvent('click', init));
  };

  // 1. open the popup with one click, then click the option once
  openTarget.click();
  await new Promise((r) => setTimeout(r, 200));
  choice.click();
  await new Promise((r) => setTimeout(r, 300));
  if (isDone()) {
    flashHighlight(openTarget);
    return true;
  }

  // 2. the popup is open by now: retry the option with a full pointer sequence
  press(choice);
  await new Promise((r) => setTimeout(r, 300));
  if (isDone()) {
    flashHighlight(openTarget);
    return true;
  }
  return false;
}

/**
 * Click-and-stick: click the phrase in the word bank to pick it, then click the gap once to place it.
 * A gap that holds a word gives it back when clicked again, so the gap must be clicked exactly once per attempt and
 * the outcome has to be read back. Returns true only when the gap really shows the wanted phrase.
 */
async function placeWordInGap(gap: HTMLElement, wordBox: HTMLElement, answer: string): Promise<boolean> {
  const doc = gap.ownerDocument;
  const view = (doc.defaultView || window) as any;
  const slot = (gap.querySelector('.dragTarget, .dev-droppable') as HTMLElement | null) || gap;
  const wanted = normalizeOptionText(answer);
  const holds = () => normalizeOptionText(slot.textContent || '');
  const settled = async (waitMs: number) => {
    const until = Date.now() + waitMs;
    while (holds() !== wanted && Date.now() < until) await sleep(100);
    return holds() === wanted;
  };

  // Already right (for example on a second run): clicking it again would take the phrase back out
  if (holds() === wanted) {
    flashHighlight(gap);
    return true;
  }

  const banked = Array.from(wordBox.querySelectorAll('.dragItem')) as HTMLElement[];
  const candidates = banked.length > 0 ? banked : (Array.from(wordBox.querySelectorAll('li, .draggable, [data-rcfid*="drag"]')) as HTMLElement[]);
  const index = findOptionIndex(
    candidates.map((c) => ({ value: '', text: c.textContent || '' })),
    answer
  );
  if (index < 0) {
    console.warn('[StudyPilot] No phrase in the word bank matches', answer);
    return false;
  }
  const word = candidates[index];

  // One click event per press: pointer/mouse down+up as a real click does, then a single click()
  const press = (target: HTMLElement) => {
    target.focus?.();
    const init = { bubbles: true, cancelable: true, view };
    target.dispatchEvent(new PointerEvent('pointerdown', init));
    target.dispatchEvent(new MouseEvent('mousedown', init));
    target.dispatchEvent(new PointerEvent('pointerup', init));
    target.dispatchEvent(new MouseEvent('mouseup', init));
    target.click();
  };

  // The gap holds a different phrase: one click gives it back to the bank
  if (holds()) {
    press(slot);
    await sleep(300);
  }

  await revealWordBoxItem(wordBox, word);

  press(word);
  await sleep(200);
  press(slot);
  if (await settled(1200)) {
    flashHighlight(gap);
    return true;
  }

  // The phrase is picked but the click did not land: try the outer gap element
  press(gap);
  if (await settled(1200)) {
    flashHighlight(gap);
    return true;
  }

  // Last attempt from scratch (the pick may have been lost)
  press(word);
  await sleep(200);
  press(slot);
  if (await settled(1200)) {
    flashHighlight(gap);
    return true;
  }
  console.warn('[StudyPilot] The phrase could not be placed in the gap:', answer, 'gap shows:', slot.textContent);
  return false;
}

export async function fillAnyElement(doc: Document, el: HTMLElement, approvedAnswer: string): Promise<boolean> {
  const safety = validateElementSafety(el);
  if (!safety.isSafe) {
    console.warn('[StudyPilot] Element safety check rejected:', el, safety.reason);
    return false;
  }

  // 1. Dropdown / Select (use tagName check because cross-frame/iframe elements fail instanceof)
  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'SELECT') {
    const selectEl = el as HTMLSelectElement;
    const clean = approvedAnswer.trim().toLowerCase();
    const targetIndex = findOptionIndex(selectEl.options, approvedAnswer);
    if (targetIndex >= 0) {
      console.log(`[StudyPilot] Selecting option #${targetIndex} ("${selectEl.options[targetIndex].text}") for select:`, selectEl);
      // Macmillan's jQuery UI selectmenu only fires its change handlers when the index actually changes,
      // so first let the page's own widget do the selection (MAIN world) before touching the native select.
      if (selectEl.id) {
        const viaWidget = await chrome.runtime
          .sendMessage({ action: 'SYNC_RCF_SELECT', selectId: selectEl.id, index: targetIndex })
          .catch(() => null);
        console.log('[StudyPilot] Widget selection result:', selectEl.id, JSON.stringify(viaWidget));
        if (viaWidget?.success && viaWidget.detail?.viaWidget && selectEl.selectedIndex === targetIndex) {
          flashHighlight(el);
          return true;
        }
      }

      selectEl.selectedIndex = targetIndex;
      selectEl.value = selectEl.options[targetIndex].value;
      
      // Dispatch standard DOM events
      selectEl.dispatchEvent(new Event('input', { bubbles: true }));
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));

      // Macmillan RCF uses jQuery UI Selectmenu:
      // The select element is display: none. Ekranda #ui-id-X-button ve popup menüde #ui-id-X-menu vardır.
      try {
        const docOwner = selectEl.ownerDocument || doc;
        const btnId = `${selectEl.id}-button`;
        const menuId = `${selectEl.id}-menu`;
        const chosenText = selectEl.options[targetIndex].text.trim();

        // 1. Open the UI selectmenu by clicking the button to ensure menu DOM is active
        const uiBtn = docOwner.getElementById(btnId) || docOwner.querySelector(`[aria-owns="${menuId}"]`) as HTMLElement | null;
        if (uiBtn) {
          clickElement(uiBtn);
          await new Promise((r) => setTimeout(r, 60));
        }

        // 2. Select option item inside jQuery UI menu list (<ul id="ui-id-X-menu">)
        const uiMenu = docOwner.getElementById(menuId);
        if (uiMenu) {
          const menuItems = Array.from(uiMenu.querySelectorAll('li.ui-menu-item')) as HTMLElement[];
          // Match by data-index (targetIndex) or matching text/value
          const targetLi = menuItems.find((li) => {
            const liIdx = li.getAttribute('data-index');
            if (liIdx !== null && parseInt(liIdx, 10) === targetIndex) return true;
            const liText = li.textContent?.trim().toLowerCase() || '';
            return liText === clean || (clean.length > 2 && liText.includes(clean));
          }) || menuItems[targetIndex];

          if (targetLi) {
            console.log('[StudyPilot] Found matching jQuery UI menu item, clicking:', targetLi);
            const clickTarget = (targetLi.querySelector('.ui-menu-item-wrapper') as HTMLElement | null) || targetLi;
            
            // Dispatch complete hover and click sequence expected by jQuery UI
            clickTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: docOwner.defaultView || window }));
            clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: docOwner.defaultView || window }));
            clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: docOwner.defaultView || window }));
            clickTarget.click();
            clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: docOwner.defaultView || window }));
          }
        }

        // 3. Update button text and trigger select change
        if (uiBtn) {
          const textSpan = uiBtn.querySelector('.ui-selectmenu-text') as HTMLElement | null;
          if (textSpan) {
            textSpan.textContent = chosenText;
          }
          uiBtn.setAttribute('aria-expanded', 'false');
          flashHighlight(uiBtn);
        }

        // 3. Trigger Macmillan RCF customRcfSelectMenu refresh & jQuery triggers
        // jQuery lives in the page's MAIN world; the content script is isolated, so ask the background to run it there.
        if (selectEl.id) {
          const synced = await chrome.runtime
            .sendMessage({ action: 'SYNC_RCF_SELECT', selectId: selectEl.id })
            .catch(() => null);
          console.log('[StudyPilot] MAIN world RCF select sync result:', selectEl.id, JSON.stringify(synced));
          if (!synced?.success) {
            console.warn('[StudyPilot] MAIN world RCF select sync failed:', JSON.stringify(synced));
          }
        }
      } catch (uiErr) {
        console.warn('[StudyPilot] jQuery UI selectmenu DOM sync warning:', uiErr);
      }

      flashHighlight(el);
      return true;
    }
    return false;
  }

  // 2. Direct Text Input / Textarea (cross-frame safe tag check)
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const inputEl = el as HTMLInputElement;
    if (inputEl.type === 'radio' || inputEl.type === 'checkbox') {
      clickElement(el);
      flashHighlight(el);
      return true;
    }

    // MACMILLAN RCF SPECIAL HANDLING:
    // If element is a direct markedTextInput or standard text input, fill it directly and cleanly
    console.log('[StudyPilot] Direct INPUT tag detected, filling answer:', approvedAnswer);
    inputEl.focus();
    inputEl.value = approvedAnswer;
    inputEl.setAttribute('value', approvedAnswer);
    
    // Macmillan RCF markedTextInput listens to input, change, and keyup
    inputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true }));
    
    // If inside a locating_popup with okButton, confirm it
    const rcfPopup = el.closest('.locating_popup, .locating_typein_container') as HTMLElement | null;
    const okBtn = (rcfPopup?.querySelector('.okButton, [class*="okButton"], a.okButton') as HTMLElement | null) ||
                  (el.parentElement?.querySelector('.okButton, [class*="okButton"]') as HTMLElement | null);
    if (okBtn) {
      console.log('[StudyPilot] Found okButton, clicking:', okBtn);
      clickElement(okBtn);
    }

    flashHighlight(el);
    return true;
  }



  // 3. Contenteditable / Div gap / Role textbox
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox') {
    el.focus();
    el.innerText = approvedAnswer;
    el.textContent = approvedAnswer;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    flashHighlight(el);
    return true;
  }

  // 4. SPECIAL MACMILLAN CLICK-AND-STICK / DRAG-TARGET FILLING
  if (el.classList.contains('dragTarget') || el.classList.contains('clickAndStickable') || el.classList.contains('complexDroppable')) {
    const wordBox = (el.ownerDocument || doc).querySelector('.wordBox') as HTMLElement | null;
    if (wordBox) {
      return placeWordInGap(el, wordBox, approvedAnswer);
    }
  }

  // 4b. Macmillan locating with a popup choice list (no text input to type into)
  const choiceRoot = el.closest('.locating') as HTMLElement | null;
  if (choiceRoot && choiceRoot.querySelector('.locatingSpanPopup')) {
    return pickLocatingChoice(choiceRoot, el, approvedAnswer);
  }

  // 5. SPECIAL MACMILLAN CLICK-TO-EDIT GAP / ERROR CORRECTION
  console.log('[StudyPilot] Triggering click-to-edit on element:', el);
  const docScope = el.ownerDocument || doc;
  const win = docScope.defaultView || window;

  // Identify Macmillan locating ID (e.g. "locating_2")
  const locatingId = el.getAttribute('data-rcfid') ||
                     el.closest('.locating')?.getAttribute('data-rcfid') ||
                     el.getAttribute('data-locatingid') ||
                     '';

  // 1. Click the word to make Macmillan open the popup
  clickElement(el);
  await new Promise((r) => setTimeout(r, 200));

  // 2. Find the exact matching popup using data-locatingid or class
  let rcfPopup: HTMLElement | null = null;
  if (locatingId) {
    rcfPopup = docScope.querySelector(`[data-locatingid="${locatingId}"]`) as HTMLElement | null;
  }
  if (!rcfPopup) {
    rcfPopup = (el.closest('.locating')?.querySelector('.locating_popup') as HTMLElement | null) ||
               (docScope.querySelector('.locating_popup:not([style*="display: none"]), .locating_popup') as HTMLElement | null);
  }

  // If popup exists, make sure it is visible in DOM
  if (rcfPopup && rcfPopup.style.display === 'none') {
    rcfPopup.style.display = 'block';
  }

  // 3. Find the input inside the popup
  let openedInput: HTMLInputElement | null = null;
  if (rcfPopup) {
    openedInput = rcfPopup.querySelector('input.locatingText, input[type="text"], input') as HTMLInputElement | null;
  }
  if (!openedInput && locatingId) {
    const typeinId = locatingId.replace('locating_', 'typein_');
    openedInput = docScope.querySelector(`input[data-rcfid="${typeinId}"]`) as HTMLInputElement | null;
  }
  if (!openedInput) {
    openedInput =
      (el.querySelector('input, textarea') as HTMLInputElement | null) ||
      (el.parentElement?.querySelector('input, textarea') as HTMLInputElement | null) ||
      (docScope.querySelector('.locating_popup input, input.locatingText, input:focus') as HTMLInputElement | null) ||
      (docScope.activeElement instanceof HTMLInputElement ? docScope.activeElement : null);
  }

  if (openedInput) {
    console.log('[StudyPilot] Found matching Macmillan locating input:', openedInput);

    // 1. Focus input
    openedInput.focus();

    // 2. Set value directly on DOM property and attribute
    openedInput.value = approvedAnswer;
    openedInput.setAttribute('value', approvedAnswer);
    setNativeValue(openedInput, approvedAnswer);
    flashHighlight(openedInput);

    // 3. Dispatch full keyboard and typing sequence
    try {
      openedInput.dispatchEvent(new InputEvent('beforeinput', { data: approvedAnswer, inputType: 'insertText', bubbles: true }));
      openedInput.dispatchEvent(new InputEvent('input', { data: approvedAnswer, inputType: 'insertText', bubbles: true }));
    } catch {}

    for (let i = 0; i < approvedAnswer.length; i++) {
      const char = approvedAnswer[i];
      openedInput.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, view: win }));
      openedInput.dispatchEvent(new KeyboardEvent('keypress', { key: char, charCode: char.charCodeAt(0), bubbles: true, view: win }));
      openedInput.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, view: win }));
    }

    openedInput.value = approvedAnswer;
    openedInput.dispatchEvent(new Event('input', { bubbles: true }));
    openedInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait 250ms so Macmillan can register the input value in its model
    await new Promise((r) => setTimeout(r, 250));

    // Also trigger Enter key
    openedInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, view: win }));
    openedInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, view: win }));

    // Check for Macmillan RCF okButton (<a class="okButton singleButton"><span>Ok</span></a>)
    const okBtn = (rcfPopup?.querySelector('.okButton, [class*="okButton"], a.okButton, button.okButton') as HTMLElement | null) ||
                  (openedInput.parentElement?.querySelector('.okButton, button[class*="ok"], button[class*="confirm"], a[class*="ok"]') as HTMLElement | null) ||
                  (docScope.querySelector('.locating_popup:not([style*="display: none"]) .okButton, .locating_popup .okButton, a.okButton') as HTMLElement | null);

    if (okBtn) {
      console.log('[StudyPilot] Clicking Macmillan RCF okButton:', okBtn);
      clickElement(okBtn);
      await new Promise((r) => setTimeout(r, 200));
    }

    openedInput.blur();
    flashHighlight(el);
    return true;
  }

  // If no input opened, this was a regular clickable choice/chip button
  flashHighlight(el);
  return true;
}

function clickElement(el: HTMLElement) {
  el.focus();
  const rect = el.getBoundingClientRect();
  const eventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };

  el.dispatchEvent(new PointerEvent('pointerdown', eventInit));
  el.dispatchEvent(new MouseEvent('mousedown', eventInit));
  el.dispatchEvent(new PointerEvent('pointerup', eventInit));
  el.dispatchEvent(new MouseEvent('mouseup', eventInit));
  el.click();
  el.dispatchEvent(new MouseEvent('click', eventInit));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  // Also trigger click on inner <span> if present (e.g. <a class="okButton"><span>Ok</span></a>)
  const innerSpan = el.querySelector('span');
  if (innerSpan) {
    innerSpan.dispatchEvent(new MouseEvent('mousedown', eventInit));
    innerSpan.dispatchEvent(new MouseEvent('mouseup', eventInit));
    innerSpan.click();
    innerSpan.dispatchEvent(new MouseEvent('click', eventInit));
  }
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  element.focus();

  const win = element.ownerDocument?.defaultView || window;
  const isInput = element instanceof win.HTMLInputElement || element.tagName === 'INPUT';
  const prototype = isInput
    ? (win.HTMLInputElement || window.HTMLInputElement).prototype
    : (win.HTMLTextAreaElement || window.HTMLTextAreaElement).prototype;

  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

  if (valueSetter) {
    valueSetter.call(element, value);
  } else {
    element.value = value;
  }

  // Also directly set property and attribute to ensure Macmillan reads it
  element.value = value;
  element.setAttribute('value', value);

  // Dispatch full event sequence expected by Macmillan markedTextInput / jQuery / Angular
  element.dispatchEvent(new Event('focus', { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keydown', { key: value.slice(-1) || 'a', bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keypress', { key: value.slice(-1) || 'a', bubbles: true }));
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keyup', { key: value.slice(-1) || 'a', bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));

  // Re-verify value wasn't wiped by a reset handler
  if (element.value !== value) {
    element.value = value;
  }
}

export function flashHighlight(element: HTMLElement) {
  const originalTransition = element.style.transition;
  const originalOutline = element.style.outline;

  element.style.transition = 'outline 0.2s ease-in-out';
  element.style.outline = '3px solid #10b981';

  setTimeout(() => {
    element.style.outline = originalOutline;
    element.style.transition = originalTransition;
  }, 1400);
}
