import { AnswerOption, FormFieldRef, QuestionType } from '../types/question';

export function classifyQuestionType(
  fields: FormFieldRef[],
  options?: AnswerOption[],
  promptText = ''
): QuestionType {
  const normalizedPrompt = promptText.toLowerCase();

  // 1. True / False check
  if (
    options &&
    options.length === 2 &&
    options.some((o) => /^(true|t|yes)$/i.test(o.label.trim())) &&
    options.some((o) => /^(false|f|no)$/i.test(o.label.trim()))
  ) {
    return 'true_false';
  }

  // 2. Dropdown check
  if (fields.some((f) => f.fieldType === 'select')) {
    return 'dropdown';
  }

  // 3. Multiple Choice check
  if (fields.some((f) => f.fieldType === 'radio') || (options && options.length >= 2)) {
    return 'multiple_choice';
  }

  // 4. Fill in the blank check
  if (fields.some((f) => f.fieldType === 'input' || f.fieldType === 'textarea')) {
    // Check if prompt has blank indicators like "___", "....", "[ ]", "( )"
    if (
      normalizedPrompt.includes('___') ||
      normalizedPrompt.includes('...') ||
      normalizedPrompt.includes('[blank]') ||
      fields.length >= 1
    ) {
      return 'fill_in_the_blank';
    }
  }

  // 5. Matching check
  if (normalizedPrompt.includes('match') && fields.length > 1) {
    return 'matching';
  }

  return 'unknown';
}
