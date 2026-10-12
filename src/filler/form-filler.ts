import { Question } from '../types/question';
import { validateElementSafety } from './safety-validator';

export async function fillFormField(
  doc: Document,
  question: Question,
  approvedAnswer: string
): Promise<{ success: boolean; error?: string }> {
  if (!approvedAnswer && approvedAnswer !== '0') {
    return { success: false, error: 'No approved answer provided to fill.' };
  }

  // 1. Multiple choice / Radio group handling
  if (question.type === 'multiple_choice' || question.type === 'true_false') {
    const radioFields = question.fields.filter((f) => f.fieldType === 'radio');
    if (radioFields.length > 0) {
      let matchedField = radioFields.find(
        (f) =>
          f.currentValue?.toLowerCase() === approvedAnswer.toLowerCase() ||
          f.label?.toLowerCase() === approvedAnswer.toLowerCase()
      );

      // Try matching options list
      if (!matchedField && question.options) {
        const matchedOption = question.options.find(
          (o) =>
            o.value.toLowerCase() === approvedAnswer.toLowerCase() ||
            o.label.toLowerCase() === approvedAnswer.toLowerCase() ||
            o.label.toLowerCase().includes(approvedAnswer.toLowerCase())
        );

        if (matchedOption && matchedOption.elementSelector) {
          const el = doc.querySelector(matchedOption.elementSelector) as HTMLInputElement | null;
          if (el) {
            const safety = validateElementSafety(el);
            if (!safety.isSafe) return { success: false, error: safety.reason };
            clickElement(el);
            flashHighlight(el);
            return { success: true };
          }
        }
      }

      if (matchedField) {
        const el = doc.querySelector(matchedField.selector) as HTMLInputElement | null;
        if (el) {
          const safety = validateElementSafety(el);
          if (!safety.isSafe) return { success: false, error: safety.reason };
          clickElement(el);
          flashHighlight(el);
          return { success: true };
        }
      }
    }
  }

  // 2. Dropdown / Select handling
  const selectField = question.fields.find((f) => f.fieldType === 'select');
  if (selectField) {
    const el = doc.querySelector(selectField.selector) as HTMLSelectElement | null;
    if (el) {
      const safety = validateElementSafety(el);
      if (!safety.isSafe) return { success: false, error: safety.reason };

      let targetIndex = -1;
      const cleanAnswer = approvedAnswer.trim().toLowerCase();

      // Find closest option
      for (let i = 0; i < el.options.length; i++) {
        const opt = el.options[i];
        if (
          opt.value.toLowerCase() === cleanAnswer ||
          opt.text.trim().toLowerCase() === cleanAnswer ||
          opt.text.trim().toLowerCase().includes(cleanAnswer)
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
        return { success: true };
      } else {
        return {
          success: false,
          error: `Could not find an option matching "${approvedAnswer}" in dropdown.`,
        };
      }
    }
  }

  // 3. Text Input / Fill in the blank handling
  const textField = question.fields.find((f) => f.fieldType === 'input' || f.fieldType === 'textarea');
  if (textField) {
    const el = doc.querySelector(textField.selector) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el) {
      const safety = validateElementSafety(el);
      if (!safety.isSafe) return { success: false, error: safety.reason };

      setNativeValue(el, approvedAnswer);
      flashHighlight(el);
      return { success: true };
    }
  }

  return {
    success: false,
    error: `Could not find a valid form element matching question "${question.id}".`,
  };
}

function clickElement(el: HTMLElement) {
  el.focus();
  el.click();
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  element.focus();

  // Handle React/synthetic events tracking
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
  element.style.outline = '3px solid #10b981'; // Tailwind emerald-500

  setTimeout(() => {
    element.style.outline = originalOutline;
    element.style.transition = originalTransition;
  }, 1200);
}
