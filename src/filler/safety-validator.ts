export interface SafetyCheckResult {
  isSafe: boolean;
  reason?: string;
}

const DANGEROUS_PATTERNS = [
  /submit/i,
  /turn\s*in/i,
  /hand\s*in/i,
  /finish\s*test/i,
  /complete\s*assignment/i,
  /end\s*quiz/i,
  /grade/i,
];

export function validateElementSafety(element: Element | null): SafetyCheckResult {
  if (!element) {
    return { isSafe: false, reason: 'Target element was not found in the DOM.' };
  }

  const tagName = element.tagName ? element.tagName.toUpperCase() : '';
  const elType = (element as any).type ? String((element as any).type).toLowerCase() : '';
  const textContent = (element as any).innerText || element.textContent || (element as any).value || '';

  // Refuse submit buttons or buttons with dangerous submit text.
  // A <button> reports type "submit" even when no type is written, so only an explicit type="submit" counts,
  // or a typeless button inside a <form> (which really would submit it).
  const hasDomApi = typeof element.getAttribute === 'function';
  const explicitType = hasDomApi ? (element.getAttribute('type') || '').toLowerCase() : elType;
  const inForm = hasDomApi && typeof element.closest === 'function' && !!element.closest('form');
  const submitsForm = explicitType === 'submit' || (explicitType === '' && inForm);
  if (tagName === 'BUTTON') {
    if (submitsForm || DANGEROUS_PATTERNS.some((p) => p.test(textContent))) {
      return {
        isSafe: false,
        reason: 'Safety policy violation: automated assignment submission or grade triggering is blocked.',
      };
    }
  }

  // Refuse submit inputs
  if (tagName === 'INPUT' && (elType === 'submit' || DANGEROUS_PATTERNS.some((p) => p.test(textContent)))) {
    return {
      isSafe: false,
      reason: 'Safety policy violation: automated assignment submission is strictly prohibited.',
    };
  }

  // Ensure element is not an assignment submission element.
  // Allow inputs, selects, textareas, contenteditables, and educational interaction elements (choice chips, radios, gaps)
  const isFormTag = ['INPUT', 'SELECT', 'TEXTAREA'].includes(tagName);
  const isEditable = element.hasAttribute('contenteditable') || (element as any).isContentEditable;
  const role = element.getAttribute('role') || '';
  const isInteractiveRole = ['textbox', 'radio', 'checkbox', 'button', 'option'].includes(role);
  const className = String((element as any).className || '').toLowerCase();
  const isActivityElement = /gap|blank|choice|option|answer|item|input|drop/i.test(className);

  if (!isFormTag && !isEditable && !isInteractiveRole && !isActivityElement) {
    return {
      isSafe: false,
      reason: `Element <${tagName}> is not an interactive exercise field.`,
    };
  }

  return { isSafe: true };
}

/**
 * Safety check for navigation buttons (the "Next" of the optional solve-everything mode).
 * validateElementSafety answers "is this an exercise field?"; a Next button is not one, so it needs its own check.
 * It refuses anything that could submit or grade work: dangerous wording in the label, class or id, an explicit
 * type="submit", or a typeless button inside a <form> (which would submit that form).
 */
export function validateNavigationSafety(element: Element | null): SafetyCheckResult {
  if (!element) return { isSafe: false, reason: 'Target element was not found in the DOM.' };

  const label = [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.textContent,
    element.getAttribute('class'),
    element.getAttribute('id'),
  ]
    .filter(Boolean)
    .join(' ');
  const explicitType = (element.getAttribute('type') || '').toLowerCase();
  const submitsForm = explicitType === 'submit' || (element.tagName === 'BUTTON' && explicitType === '' && !!element.closest('form'));

  if (submitsForm || DANGEROUS_PATTERNS.some((p) => p.test(label))) {
    return {
      isSafe: false,
      reason: 'Safety policy violation: automated assignment submission or grade triggering is blocked.',
    };
  }
  return { isSafe: true };
}
