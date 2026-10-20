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
 * Exact matches win; a partial match is only a fallback and prefers the longest option text ("solved" over "solve").
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

  const partial = entries
    .filter((e) => e.text && wanted.length > 2 && (e.text.includes(wanted) || wanted.includes(e.text)))
    .sort((a, b) => b.text.length - a.text.length)[0];
  return partial ? partial.index : -1;
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
      const matchedOpt =
        (matchedOptionIndex >= 0 ? question.options[matchedOptionIndex] : null) ||
        question.options.find(
          (o) =>
            o.value.toLowerCase() === cleanAnswer ||
            o.label.toLowerCase() === cleanAnswer ||
            o.label.toLowerCase().includes(cleanAnswer) ||
            cleanAnswer.includes(o.label.toLowerCase())
        );

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
      for (const it of items) {
        const itText = it.textContent?.trim().toLowerCase() || '';
        if (itText === cleanAnswer || (cleanAnswer.length > 2 && itText.includes(cleanAnswer)) || (cleanAnswer.length > 2 && cleanAnswer.includes(itText))) {
          console.log('[StudyPilot] Matched Macmillan radio chip item:', it);
          if (await fillAnyElement(doc, it, approvedAnswer)) return { success: true };
        }
      }
    }

    // Check direct Macmillan complexDroppable gap by index
    const directDroppable = findDeepElement(doc, `[data-rcfid="complexDroppable_${question.index}"]`) ||
                            findDeepElement(doc, `#complexDroppable_${question.index}`);
    if (directDroppable) {
      console.log('[StudyPilot] Matched directly by Macmillan complexDroppable index:', question.index);
      if (await fillAnyElement(doc, directDroppable, approvedAnswer)) return { success: true };
    }

    const allDroppableGaps = Array.from(doc.querySelectorAll('span.complexDroppable.rcfDroppable, span[data-rcfid*="complexDroppable_"]'))
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
        console.log('[StudyPilot] Widget selection result:', selectEl.id, viaWidget);
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
          console.log('[StudyPilot] MAIN world RCF select sync result:', selectEl.id, synced);
          if (!synced?.success) {
            console.warn('[StudyPilot] MAIN world RCF select sync failed:', synced);
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
    console.log('[StudyPilot] Macmillan clickAndStickable target detected, looking for word in wordBox:', approvedAnswer);
    const ownerDoc = el.ownerDocument || doc;
    const ownerWin = (ownerDoc.defaultView || window) as any;
    const wordBox = ownerDoc.querySelector('.wordBox');
    
    if (wordBox) {
      const cleanTarget = approvedAnswer.trim().toLowerCase();
      const allWords = Array.from(wordBox.querySelectorAll('li, .dragItem, .draggable, [data-rcfid*="drag"], span, div'))
        .filter((w) => w.textContent && w.textContent.trim().length > 1 && !w.classList.contains('count')) as HTMLElement[];
      
      // Prefer an exact match on real word-bank items; fuzzy matching is only a fallback
      // (otherwise "look" could pick "looks").
      const dragItems = allWords.filter((w) => w.classList.contains('dragItem'));
      const matchedWordEl =
        dragItems.find((w) => (w.textContent?.trim().toLowerCase() || '') === cleanTarget) ||
        allWords.find((w) => (w.textContent?.trim().toLowerCase() || '') === cleanTarget) ||
        allWords.find((w) => {
          const wt = w.textContent?.trim().toLowerCase() || '';
          return cleanTarget.length > 2 && (wt.includes(cleanTarget) || cleanTarget.includes(wt));
        });

      if (matchedWordEl) {
        console.log('[StudyPilot] Found matching word in wordBox, performing drag & drop simulation:', matchedWordEl);
        await revealWordBoxItem(wordBox as HTMLElement, matchedWordEl);
        
        // 1. CLICK WORD IN WORDBOX FIRST
        matchedWordEl.focus();
        matchedWordEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: ownerWin }));
        matchedWordEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: ownerWin }));
        matchedWordEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: ownerWin }));
        matchedWordEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: ownerWin }));
        matchedWordEl.click();

        await new Promise((r) => setTimeout(r, 200));

        // 2. NOW CLICK THE TARGET GAP
        const innerTarget = (el.querySelector('.dragTarget, .dev-droppable') as HTMLElement | null) || el;
        innerTarget.focus();
        innerTarget.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: ownerWin }));
        innerTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: ownerWin }));
        innerTarget.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: ownerWin }));
        innerTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: ownerWin }));
        innerTarget.click();

        if (el !== innerTarget) {
          el.focus();
          el.click();
        }

        // 3. Small pause between questions so Macmillan UI can finish stick animation
        await new Promise((r) => setTimeout(r, 200));

        flashHighlight(innerTarget);
        flashHighlight(el);
        return true;
      }
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
