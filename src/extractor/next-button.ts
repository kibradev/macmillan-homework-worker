import { validateNavigationSafety } from '../filler/safety-validator';

/**
 * Finds the button that moves to the next activity, in the page that surrounds the activity.
 * It is deliberately cautious: it presses nothing when it is not sure. A wrong click here could submit work,
 * so ambiguity is an error, not a guess.
 */

export interface NextButtonResult {
  element?: HTMLElement;
  /** Why no element was returned (shown to the learner). */
  reason?: string;
}

const NEXT_LABEL = /^(next|next activity|next exercise|next page|next unit|continue|go on|sonraki|ileri|devam|siguiente|suivant)\b/i;
const NEXT_HINT = /(^|[\s_-])next([\s_-]|$)/i; // icon-only buttons: class / data-* / aria-label carrying "next"
const NOT_NEXT = /\b(previous|prev|back|geri|önceki|anterior)\b|submit|check|finish|grade|turn\s*in|hand\s*in|send|gönder|bitir|kontrol/i;
const CANDIDATES = 'button, a, [role="button"], [role="link"]';

function accessibleName(el: Element): string {
  return (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim();
}

function isUsable(el: HTMLElement): boolean {
  if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
  if (el.style.display === 'none' || el.style.visibility === 'hidden') return false;
  return true;
}

export function findNextButton(doc: Document, customSelector?: string): NextButtonResult {
  const selector = customSelector?.trim();
  if (selector) {
    let match: HTMLElement | null;
    try {
      match = doc.querySelector(selector) as HTMLElement | null;
    } catch {
      return { reason: `The selector in Settings is invalid: ${selector}` };
    }
    if (!match) return { reason: `No button found for the selector in Settings: ${selector}` };
    if (!isUsable(match)) return { reason: 'The Next button is not usable right now (disabled or hidden).' };
    const safety = validateNavigationSafety(match);
    if (!safety.isSafe) return { reason: safety.reason };
    return { element: match };
  }

  const usable = (Array.from(doc.querySelectorAll(CANDIDATES)) as HTMLElement[]).filter(isUsable);
  const matches = usable.filter((el) => {
    const name = accessibleName(el);
    if (NOT_NEXT.test(name) || NOT_NEXT.test(el.className?.toString() ?? '')) return false;
    return NEXT_LABEL.test(name) || NEXT_HINT.test(`${el.className} ${el.getAttribute('data-testid') ?? ''} ${el.getAttribute('aria-label') ?? ''}`);
  });

  if (matches.length === 0) return { reason: 'Next button not found.' };
  if (matches.length > 1) {
    return {
      reason: `Multiple Next candidates found (${matches.map(accessibleName).join(' | ')}). Enter the button's CSS selector in Settings.`,
    };
  }

  const safety = validateNavigationSafety(matches[0]);
  if (!safety.isSafe) return { reason: safety.reason };
  return { element: matches[0] };
}
