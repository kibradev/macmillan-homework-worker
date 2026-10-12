import { AnswerOption, FormFieldRef, Question } from '../types/question';
import { classifyQuestionType } from './question-classifier';

export function getUniqueCssSelector(el: Element): string {
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }

  // Check unique name attribute for inputs
  const name = el.getAttribute('name');
  if (name && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
    const matching = document.querySelectorAll(`${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`);
    if (matching.length === 1) {
      return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    }
  }

  const parts: string[] = [];
  let curr: Element | null = el;

  while (curr && curr.nodeType === Node.ELEMENT_NODE) {
    let selector = curr.nodeName.toLowerCase();
    if (curr.id) {
      selector = `#${CSS.escape(curr.id)}`;
      parts.unshift(selector);
      break;
    } else {
      let sibling = curr;
      let nth = 1;
      while (sibling.previousElementSibling) {
        sibling = sibling.previousElementSibling;
        if (sibling.nodeName.toLowerCase() === selector) nth++;
      }
      selector += `:nth-of-type(${nth})`;
    }
    parts.unshift(selector);
    curr = curr.parentElement;
    if (curr && curr.tagName === 'BODY') break;
  }

  return parts.join(' > ');
}

export function cleanText(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

function findLabelForElement(inputEl: HTMLElement): string {
  // 1. Check aria-label
  const ariaLabel = inputEl.getAttribute('aria-label');
  if (ariaLabel) return cleanText(ariaLabel);

  // 2. Check aria-labelledby
  const ariaLabelledby = inputEl.getAttribute('aria-labelledby');
  if (ariaLabelledby) {
    const lbl = document.getElementById(ariaLabelledby);
    if (lbl) return cleanText(lbl.textContent);
  }

  // 3. Check <label for="id">
  if (inputEl.id) {
    const label = document.querySelector(`label[for="${CSS.escape(inputEl.id)}"]`);
    if (label) return cleanText(label.textContent);
  }

  // 4. Check wrapping <label>
  const parentLabel = inputEl.closest('label');
  if (parentLabel) {
    // Clone and remove the input itself to avoid repeating input text
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    const innerInputs = clone.querySelectorAll('input, select, textarea');
    innerInputs.forEach((i) => i.remove());
    return cleanText(clone.textContent);
  }

  // 5. Check placeholder
  const placeholder = inputEl.getAttribute('placeholder');
  if (placeholder) return cleanText(placeholder);

  // 6. Check closest preceding sibling or parent text
  const prev = inputEl.previousElementSibling;
  if (prev && ['SPAN', 'P', 'LABEL', 'DIV'].includes(prev.tagName)) {
    const txt = cleanText(prev.textContent);
    if (txt.length > 0 && txt.length < 100) return txt;
  }

  return '';
}

export function extractQuestionsFromGenericDOM(doc: Document): Question[] {
  const questions: Question[] = [];

  // Look for potential question container elements
  const containerSelectors = [
    '.exercise-item',
    '.question-card',
    '.question-item',
    '.question',
    '.quiz-item',
    '[data-question-id]',
    '[data-question]',
    'fieldset',
    '.form-group',
    'li.exercise',
    '.task-item',
  ];

  const matchedContainers = Array.from(doc.querySelectorAll(containerSelectors.join(','))) as HTMLElement[];

  if (matchedContainers.length > 0) {
    let index = 1;
    for (const container of matchedContainers) {
      const q = parseContainerIntoQuestion(container, index, doc);
      if (q && (q.fields.length > 0 || (q.options && q.options.length > 0))) {
        questions.push(q);
        index++;
      }
    }
  }

  // Fallback: If no recognized containers were found, scan all interactive form elements directly
  if (questions.length === 0) {
    const interactiveElements = Array.from(
      doc.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea')
    ) as HTMLElement[];

    // Group radio buttons by name
    const radioGroups = new Map<string, HTMLElement[]>();
    const standaloneFields: HTMLElement[] = [];

    for (const el of interactiveElements) {
      if (el instanceof HTMLInputElement && el.type === 'radio') {
        const name = el.name || 'unnamed_radio';
        if (!radioGroups.has(name)) radioGroups.set(name, []);
        radioGroups.get(name)!.push(el);
      } else {
        standaloneFields.push(el);
      }
    }

    let index = 1;

    // Process radio groups (Multiple Choice / True-False)
    for (const [name, radios] of radioGroups.entries()) {
      const firstRadio = radios[0];
      const parentBlock = (firstRadio.closest('form, fieldset, div, section') as HTMLElement | null) || doc.body;
      const promptText = findPromptForElements(radios, parentBlock);

      const options: AnswerOption[] = radios.map((r, i) => {
        const optLabel = findLabelForElement(r) || (r as HTMLInputElement).value || `Option ${i + 1}`;
        return {
          id: `opt_${index}_${i}`,
          label: optLabel,
          value: (r as HTMLInputElement).value || optLabel,
          elementSelector: getUniqueCssSelector(r),
        };
      });

      const fields: FormFieldRef[] = radios.map((r, i) => ({
        id: `field_${index}_${i}`,
        selector: getUniqueCssSelector(r),
        fieldType: 'radio',
        name,
        currentValue: (r as HTMLInputElement).checked ? (r as HTMLInputElement).value : undefined,
        label: options[i]?.label,
      }));

      const type = classifyQuestionType(fields, options, promptText);

      questions.push({
        id: `q_${index}`,
        index,
        type,
        promptText: promptText || `Question ${index}`,
        options,
        fields,
      });
      index++;
    }

    // Process standalone inputs / selects / textareas
    for (const el of standaloneFields) {
      const fieldType =
        el instanceof HTMLSelectElement
          ? 'select'
          : el instanceof HTMLTextAreaElement
          ? 'textarea'
          : 'input';

      const label = findLabelForElement(el);
      const parentBlock = (el.closest('div, section, p, li') as HTMLElement | null) || doc.body;
      const prompt = findPromptForElements([el], parentBlock) || label || `Question ${index}`;

      let options: AnswerOption[] | undefined;
      if (el instanceof HTMLSelectElement) {
        options = Array.from(el.options)
          .filter((opt) => opt.value !== '' || opt.text !== '-- Select --')
          .map((opt, i) => ({
            id: `opt_${index}_${i}`,
            label: cleanText(opt.text),
            value: opt.value || opt.text,
          }));
      }

      const fieldRef: FormFieldRef = {
        id: `field_${index}`,
        selector: getUniqueCssSelector(el),
        fieldType,
        name: el.getAttribute('name') || undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        currentValue: (el as HTMLInputElement).value || undefined,
        label,
      };

      const type = classifyQuestionType([fieldRef], options, prompt);

      questions.push({
        id: `q_${index}`,
        index,
        type,
        promptText: prompt,
        options,
        fields: [fieldRef],
      });
      index++;
    }
  }

  return questions;
}

function parseContainerIntoQuestion(
  container: HTMLElement,
  index: number,
  _doc: Document
): Question | null {
  // Find prompt inside container (e.g. .prompt, .question-text, h3, h4, legend, p)
  const promptEl =
    container.querySelector('.prompt, .question-text, .exercise-prompt, legend, h3, h4, .title, p') ||
    container;

  let promptText = '';
  if (promptEl) {
    const clone = promptEl.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea, button, .options').forEach((n) => n.remove());
    promptText = cleanText(clone.textContent);
  }

  const inputs = Array.from(
    container.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea')
  ) as HTMLElement[];

  const fields: FormFieldRef[] = [];
  const options: AnswerOption[] = [];

  // Check if inputs are radio buttons
  const isRadioGroup = inputs.length > 0 && inputs.every((i) => i instanceof HTMLInputElement && i.type === 'radio');

  if (isRadioGroup) {
    inputs.forEach((r, i) => {
      const radioInput = r as HTMLInputElement;
      const optLabel = findLabelForElement(r) || radioInput.value || `Choice ${i + 1}`;
      options.push({
        id: `opt_${index}_${i}`,
        label: optLabel,
        value: radioInput.value || optLabel,
        elementSelector: getUniqueCssSelector(r),
      });
      fields.push({
        id: `field_${index}_${i}`,
        selector: getUniqueCssSelector(r),
        fieldType: 'radio',
        name: radioInput.name,
        currentValue: radioInput.checked ? radioInput.value : undefined,
        label: optLabel,
      });
    });
  } else {
    inputs.forEach((inputEl, i) => {
      const fieldType =
        inputEl instanceof HTMLSelectElement
          ? 'select'
          : inputEl instanceof HTMLTextAreaElement
          ? 'textarea'
          : 'input';

      if (inputEl instanceof HTMLSelectElement) {
        Array.from(inputEl.options).forEach((opt, optIdx) => {
          if (opt.text && opt.text.trim()) {
            options.push({
              id: `opt_${index}_${optIdx}`,
              label: cleanText(opt.text),
              value: opt.value || opt.text,
            });
          }
        });
      }

      fields.push({
        id: `field_${index}_${i}`,
        selector: getUniqueCssSelector(inputEl),
        fieldType,
        name: inputEl.getAttribute('name') || undefined,
        placeholder: inputEl.getAttribute('placeholder') || undefined,
        currentValue: (inputEl as HTMLInputElement).value || undefined,
        label: findLabelForElement(inputEl),
      });
    });
  }

  const type = classifyQuestionType(fields, options.length > 0 ? options : undefined, promptText);

  return {
    id: `q_${index}`,
    index,
    type,
    promptText: promptText || `Exercise Question ${index}`,
    options: options.length > 0 ? options : undefined,
    fields,
    metadata: {
      containerSelector: getUniqueCssSelector(container),
    },
  };
}

function findPromptForElements(elements: HTMLElement[], parentBlock: HTMLElement): string {
  // Try finding header, legend, or preceding paragraph in parent block
  const heading = parentBlock.querySelector('legend, h1, h2, h3, h4, h5, p.prompt, .question-text');
  if (heading) {
    return cleanText(heading.textContent);
  }

  // Look for preceding sibling text node or element before the first element
  const first = elements[0];
  let prev = first.previousElementSibling;
  while (prev) {
    if (['P', 'SPAN', 'DIV', 'LABEL'].includes(prev.tagName)) {
      const txt = cleanText(prev.textContent);
      if (txt.length > 3) return txt;
    }
    prev = prev.previousElementSibling;
  }

  return cleanText(parentBlock.textContent?.slice(0, 80));
}
