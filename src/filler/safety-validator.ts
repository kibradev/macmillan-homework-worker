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

  // Refuse submit buttons or buttons with dangerous submit text
  if (tagName === 'BUTTON') {
    if (elType === 'submit' || DANGEROUS_PATTERNS.some((p) => p.test(textContent))) {
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
