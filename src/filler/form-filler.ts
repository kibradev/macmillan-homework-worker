import { Question } from '../types/question';
import { validateElementSafety } from './safety-validator';

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

export async function fillFormField(
  doc: Document,
  question: Question,
  approvedAnswer: string
): Promise<{ success: boolean; error?: string }> {
  if (!approvedAnswer && approvedAnswer !== '0') {
    return { success: false, error: 'No approved answer provided to fill.' };
  }

  const cleanAnswer = approvedAnswer.trim().toLowerCase();

  // 1. Multiple choice & True/False handling
  if (question.type === 'multiple_choice' || question.type === 'true_false' || (question.options && question.options.length > 0)) {
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

      if (matchedOpt && matchedOpt.elementSelector) {
        const el = findDeepElement(doc, matchedOpt.elementSelector);
        if (el && (await fillAnyElement(doc, el, approvedAnswer))) {
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
          return { success: true };
        }
      }
    }
  }

  // 2. Direct field selector lookup (Inputs, Selects, Contenteditable, Click-to-Edit Words)
  for (const field of question.fields) {
    const el = findDeepElement(doc, field.selector);
    if (el) {
      const filled = await fillAnyElement(doc, el, approvedAnswer);
      if (filled) return { success: true };
    }
  }

  // 3. Fallback: Search within question container if specified
  if (question.metadata?.containerSelector) {
    const container = findDeepElement(doc, question.metadata.containerSelector);
    if (container) {
      const innerTarget = container.querySelector(
        'input:not([type="hidden"]):not([type="submit"]), select, textarea, [contenteditable="true"], [role="textbox"], [class*="word"], [class*="gap"], [class*="token"], [class*="clickable"]'
      ) as HTMLElement | null;

      if (innerTarget && (await fillAnyElement(doc, innerTarget, approvedAnswer))) {
        return { success: true };
      }
    }
  }

  // 4. Fallback: Search by ID or Name attribute if selector had them
  for (const field of question.fields) {
    if (field.name) {
      const elByName = doc.querySelector(`[name="${CSS.escape(field.name)}"]`) as HTMLElement | null;
      if (elByName && (await fillAnyElement(doc, elByName, approvedAnswer))) {
        return { success: true };
      }
    }
  }

  return {
    success: false,
    error: `Could not match DOM element for Question #${question.index}.`,
  };
}

export async function fillAnyElement(doc: Document, el: HTMLElement, approvedAnswer: string): Promise<boolean> {
  const safety = validateElementSafety(el);
  if (!safety.isSafe) return false;

  // 1. Dropdown / Select
  if (el instanceof HTMLSelectElement) {
    let targetIndex = -1;
    const clean = approvedAnswer.trim().toLowerCase();
    for (let i = 0; i < el.options.length; i++) {
      const opt = el.options[i];
      if (
        opt.value.toLowerCase() === clean ||
        opt.text.trim().toLowerCase() === clean ||
        opt.text.trim().toLowerCase().includes(clean)
      ) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex >= 0) {
      el.selectedIndex = targetIndex;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      flashHighlight(el);
      return true;
    }
    return false;
  }

  // 2. Direct Text Input / Textarea
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.type === 'radio' || el.type === 'checkbox') {
      clickElement(el);
      flashHighlight(el);
      return true;
    }
    setNativeValue(el, approvedAnswer);
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

  // 4. SPECIAL MACMILLAN CLICK-TO-EDIT GAP / ERROR CORRECTION
  // Clicking the word element triggers an inline or popover input!
  clickElement(el);
  await new Promise((r) => setTimeout(r, 90));

  // Check if an input opened upon clicking the word
  const openedInput =
    (el.querySelector('input, textarea') as HTMLInputElement | null) ||
    (el.parentElement?.querySelector('input, textarea') as HTMLInputElement | null) ||
    (doc.activeElement instanceof HTMLInputElement || doc.activeElement instanceof HTMLTextAreaElement ? doc.activeElement : null) ||
    (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null) ||
    (doc.querySelector('input:focus, .popover input, .tooltip input, [class*="correction"] input, [class*="inline-edit"] input') as HTMLInputElement | null);

  if (openedInput && (openedInput instanceof HTMLInputElement || openedInput instanceof HTMLTextAreaElement)) {
    setNativeValue(openedInput, approvedAnswer);
    flashHighlight(openedInput);

    // Confirm inline input with Enter key and change event
    openedInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    openedInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    openedInput.dispatchEvent(new Event('input', { bubbles: true }));
    openedInput.dispatchEvent(new Event('change', { bubbles: true }));
    openedInput.blur();

    // Check if there is an OK / checkmark confirmation button next to the input
    const okBtn = openedInput.parentElement?.querySelector(
      'button[class*="ok"], button[class*="confirm"], button[class*="check"], button[class*="save"], button[type="button"]'
    ) as HTMLElement | null;
    if (okBtn) {
      okBtn.click();
    }

    flashHighlight(el);
    return true;
  }

  // If no input opened, this was a regular clickable choice/chip button
  flashHighlight(el);
  return true;
}

function clickElement(el: HTMLElement) {
  el.focus();
  el.click();
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  element.focus();

  // Reset React synthetic event value tracker
  const prototype =
    element instanceof HTMLInputElement ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

  if (valueSetter) {
    valueSetter.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.blur();
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
