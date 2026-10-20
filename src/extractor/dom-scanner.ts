import { AnswerOption, FormFieldRef, Question } from '../types/question';
import { classifyQuestionType } from './question-classifier';

export function getUniqueCssSelector(el: Element): string {
  // 1. Prioritize Macmillan data-rcfid (most stable and unique attribute in Macmillan RCF)
  const rcfid = el.getAttribute('data-rcfid');
  if (rcfid) {
    const base = `[data-rcfid="${CSS.escape(rcfid)}"]`;
    // data-rcfid is only unique within its parent widget (every radio group has its own item_1), so scope repeats.
    const root = el.ownerDocument;
    if (root && root.querySelectorAll(base).length > 1) {
      for (let anc = el.parentElement; anc; anc = anc.parentElement) {
        const ancId = anc.getAttribute('data-rcfid');
        const ancSel = anc.id ? `#${CSS.escape(anc.id)}` : ancId ? `[data-rcfid="${CSS.escape(ancId)}"]` : null;
        if (ancSel && root.querySelectorAll(`${ancSel} ${base}`).length === 1) {
          return `${ancSel} ${base}`;
        }
      }
    }
    return base;
  }

  // 2. Element ID (if valid and not containing unescaped raw spaces)
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }

  // 3. Unique name attribute for inputs
  const name = el.getAttribute('name');
  if (name && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
    return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  }

  const parts: string[] = [];
  let curr: Element | null = el;

  while (curr && curr.nodeType === Node.ELEMENT_NODE) {
    let selector = curr.nodeName.toLowerCase();
    const currRcfid = curr.getAttribute('data-rcfid');
    if (currRcfid) {
      selector = `[data-rcfid="${CSS.escape(currRcfid)}"]`;
      parts.unshift(selector);
      break;
    } else if (curr.id) {
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

/** Audio player controls (plyr seek/volume range inputs) look like form fields but are never answers. */
export function isMediaControl(el: Element): boolean {
  return el.matches('input[type="range"]') || !!el.closest('.plyr, .audioInterface, .activityAudioPlayerContainer');
}

export function cleanText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/Ok\s*Cancel/gi, ' ')
    .replace(/OkCancel/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

export function queryAllDeep(root: Document | Element | ShadowRoot, selector: string): HTMLElement[] {
  const results: HTMLElement[] = [];

  try {
    const matched = Array.from(root.querySelectorAll(selector)) as HTMLElement[];
    results.push(...matched);
  } catch {}

  // Pierce shadow roots and same-origin iframes recursively
  const allElements = Array.from(root.querySelectorAll('*'));
  for (const el of allElements) {
    if (el.shadowRoot) {
      results.push(...queryAllDeep(el.shadowRoot, selector));
    }
    if (el instanceof HTMLIFrameElement) {
      try {
        if (el.contentDocument && el.contentDocument.body) {
          results.push(...queryAllDeep(el.contentDocument, selector));
        }
      } catch {
        // Cross-origin iframe
      }
    }
  }

  // Deduplicate
  return Array.from(new Set(results));
}

export function findListeningData(doc: Document | Element): { isListening: boolean; audioUrl?: string; transcript?: string } {
  // 1. Search for audio elements or sources across all common players & Macmillan RCF audio player tags
  const audioEl = doc.querySelector(
    'audio, [data-audiosrc], [data-audio-src], [data-audio], [class*="audio-player"], [class*="audioPlayer"], .audioInterface, .player, [data-player-type*="audio"], [id*="audio"]'
  ) as HTMLElement | null;

  let audioUrl: string | undefined;
  if (audioEl) {
    audioUrl = (audioEl as HTMLAudioElement).src ||
               audioEl.getAttribute('data-audiosrc') ||
               audioEl.getAttribute('data-audio-src') ||
               audioEl.getAttribute('data-audio') ||
               audioEl.getAttribute('data-src') ||
               audioEl.querySelector('source')?.getAttribute('src') ||
               undefined;
  }

  // 2. Search for transcripts / tapescripts (Macmillan often keeps tapescript in hidden tabs, modals, accordions, or data attributes)
  const transcriptSelectors = [
    '.scriptScroller',
    '.script',
    '.audioScript',
    '.tapescript',
    '.transcript',
    '[class*="scriptScroller"]',
    '[class*="tapescript"]',
    '[class*="transcript"]',
    '[data-transcript]',
    '.audio-script',
    '[class*="audioScript"]',
    '.script-content',
    '#tapescriptModal',
    '.tapescript-content',
    '.transcript-content',
    '.audio-transcript',
    '[id*="tapescript"]',
    '[id*="transcript"]',
  ];
  let transcript: string | undefined;
  for (const sel of transcriptSelectors) {
    // Class patterns like [class*="audioScript"] also match the captions toggle *button*; its label is not a transcript.
    const el = Array.from(doc.querySelectorAll(sel)).find((candidate) => {
      if (candidate.closest('button, [role="button"]')) return false;
      const text = candidate.textContent?.trim() || '';
      return text.length > 15 && !/^(show|hide)\s*captions/i.test(text);
    }) as HTMLElement | undefined;
    if (el) {
      const lines = Array.from(el.querySelectorAll('p')).map((p) => cleanText(p.textContent)).filter(Boolean);
      transcript = lines.length > 1 ? lines.join('\n') : cleanText(el.textContent);
      break;
    }
  }

  const isListening = Boolean(
    audioUrl ||
    transcript ||
    doc.querySelector(
      '[class*="listening"], [data-activity-type*="listening"], [class*="audioInterface"], .audioControls, .track-info, [data-type*="audio"]'
    )
  );
  return { isListening, audioUrl, transcript };
}

export function findGlossaryData(doc: Document | Element): string | undefined {
  const glossarySelectors = [
    '.collapsibleContainer',
    '.glossary',
    '[class*="glossary"]',
    '[data-glossary]',
    '.vocabulary-box',
    '.word-list',
    '.help-box',
    '.reference-panel',
  ];

  for (const sel of glossarySelectors) {
    const el = doc.querySelector(sel) as HTMLElement | null;
    if (el && el.textContent) {
      const txt = cleanText(el.textContent);
      if (txt.toLowerCase().includes('glossary') || txt.length > 30) {
        return txt;
      }
    }
  }
  return undefined;
}

export function extractQuestionsFromGenericDOM(doc: Document): Question[] {
  const questions: Question[] = [];
  const listeningData = findListeningData(doc);

  // Look for potential question container elements (including Macmillan specific classes and courseware components)
  const containerSelectors = [
    '.exercise-item',
    '.question-card',
    '.question-item',
    '.question-wrapper',
    '.question',
    '.quiz-item',
    '.task-item',
    '.activity-item',
    '.activity-content',
    '.activity-body',
    '[class*="activity-item"]',
    '[class*="question-item"]',
    '[class*="exercise-item"]',
    '[class*="gap-fill"]',
    '[class*="gapfill"]',
    '[class*="task-"]',
    '[data-question-id]',
    '[data-question]',
    '[data-activity-id]',
    'mee-activity',
    'mhe-activity',
    'mhe-question',
    'fieldset',
    '.form-group',
    'li.exercise',
    '.rubric-item',
    '.rubric',
  ];

  // 1. FIRST-CLASS MACMILLAN DROPDOWN GAP-FILL (.dropDown, select[id*="ui-id-"], [data-rcfid*="dropDown_"])
  const dropDownWrappers = Array.from(
    doc.querySelectorAll('.dropDown:not(.example), [data-rcfid*="dropDown_"]:not(.example)')
  ).filter((el, idx, arr) => arr.indexOf(el) === idx) as HTMLElement[];

  const macmillanSelects = dropDownWrappers.length > 0
    ? dropDownWrappers.map((w) => (w.querySelector('select') as HTMLSelectElement | null) || (w.nextElementSibling as HTMLSelectElement | null)).filter(Boolean) as HTMLSelectElement[]
    : Array.from(doc.querySelectorAll('select')).filter((s) => !s.closest('.example')) as HTMLSelectElement[];

  if (macmillanSelects.length > 0) {
    let dropIndex = 1;
    for (const selectEl of macmillanSelects) {
      const parentSentence = (selectEl.closest('p, li, .sentence, .item, tr, div') as HTMLElement | null) || selectEl.parentElement || selectEl;
      const clone = parentSentence.cloneNode(true) as HTMLElement;

      clone.querySelectorAll('.ui-selectmenu-button, .ui-selectmenu-menu, .dropDown, select, button, .textControls, [style*="display: none"]').forEach((n) => {
        const placeholder = clone.ownerDocument.createTextNode(' [_____] ');
        n.replaceWith(placeholder);
      });

      let promptText = cleanText(clone.textContent) || `Dropdown Gap #${dropIndex}`;
      promptText = promptText.replace(/(\[\s*_____\s*\]\s*)+/g, '[_____] ');

      // Dialogue items keep the other speaker's line in a sibling <p> of the same <li>; pass it as context.
      // Feedback blocks are skipped on purpose: they explain (and often reveal) the answer.
      let itemContext: string | undefined;
      const item = selectEl.closest('li') as HTMLElement | null;
      if (item && item !== parentSentence && item.contains(parentSentence)) {
        const itemClone = item.cloneNode(true) as HTMLElement;
        itemClone.querySelectorAll('.feedback, .dev-feedback, .ui-selectmenu-menu, .ui-selectmenu-button, select, button').forEach((n) => n.remove());
        itemClone.querySelectorAll('.dropDown').forEach((n) => n.replaceWith(clone.ownerDocument.createTextNode(' [_____] ')));
        const ctx = cleanText(itemClone.textContent).replace(/(\[\s*_____\s*\]\s*)+/g, '[_____] ');
        if (ctx && ctx !== promptText) itemContext = ctx;
      }

      const validOptions = Array.from(selectEl.options).filter((o) => o.text && o.text.trim().length > 0 && !o.text.includes('---'));
      const options: AnswerOption[] = validOptions.map((opt, optIdx) => ({
        id: `opt_${dropIndex}_${optIdx}`,
        label: cleanText(opt.text),
        value: opt.value || cleanText(opt.text),
      }));

      const fieldRef: FormFieldRef = {
        id: `field_dropdown_${dropIndex}`,
        selector: getUniqueCssSelector(selectEl),
        fieldType: 'select',
        name: selectEl.id || selectEl.getAttribute('data-rcfid') || `dropDown_${dropIndex}`,
        currentValue: selectEl.value || undefined,
        label: `Dropdown #${dropIndex}`,
      };

      questions.push({
        id: `q_${dropIndex}`,
        index: dropIndex,
        type: 'dropdown',
        promptText,
        contextText: itemContext,
        options,
        fields: [fieldRef],
        metadata: {
          containerSelector: getUniqueCssSelector(parentSentence),
        },
      });
      dropIndex++;
    }
  }

  // 2. FIRST-CLASS MACMILLAN ERROR CORRECTION (.locating, .locatingItem)
  // Macmillan locating exercises mark each incorrect word container as .locating (e.g. data-rcfid="locating_2")
  // containing child .locatingItem ("You do")
  const locatingContainers = Array.from(
    doc.querySelectorAll('.locating:not(.example), [data-rcfid*="locating_"]:not(.example)')
  ).filter((el, idx, arr) => {
    return !el.closest('.example') && arr.indexOf(el) === idx;
  }) as HTMLElement[];

  if (locatingContainers.length > 0) {
    let locIndex = 1;
    for (const locEl of locatingContainers) {
      const clickTarget = (locEl.querySelector('.locatingItem') as HTMLElement | null) || locEl;
      const incorrectWordText = cleanText(clickTarget.textContent || locEl.textContent) || `Word #${locIndex}`;
      const parentSentence = (locEl.closest('p, li, .sentence, .item, tr, div') as HTMLElement | null) || locEl.parentElement || locEl;
      const clone = parentSentence.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.locating_popup, .textControls, button, a.okButton, a.cancelButton, [style*="display: none"], .markable, .locating_answer').forEach((n) => n.remove());
      const promptText = cleanText(clone.textContent) || `Sentence #${locIndex}`;

      const fieldRef: FormFieldRef = {
        id: `field_locating_${locIndex}`,
        selector: getUniqueCssSelector(clickTarget),
        fieldType: 'input',
        name: locEl.getAttribute('data-rcfid') || `locating_${locIndex}`,
        label: incorrectWordText,
        currentValue: incorrectWordText,
      };

      questions.push({
        id: `q_${locIndex}`,
        index: locIndex,
        type: 'fill_in_the_blank',
        promptText: `Find and correct the error in: "${promptText}". Incorrect word: "${incorrectWordText}"`,
        fields: [fieldRef],
        metadata: {
          containerSelector: getUniqueCssSelector(locEl),
        },
      });
      locIndex++;
    }
  }

  // 2. FIRST-CLASS MACMILLAN CUSTOM RADIO ITEM SELECT (.radioItemSelect, .radioItem, [class*="radioItemSelect"])
  const radioSelectGroups = queryAllDeep(
    doc,
    '.radioItemSelect, [class*="radioItemSelect"], [class*="radioGroup"], .radioSelect, .checkboxItemSelect, [class*="checkboxItemSelect"]'
  );
  if (radioSelectGroups.length > 0 && questions.length === 0) {
    let rIndex = 1;
    for (const group of radioSelectGroups) {
      const choiceItems = Array.from(
        group.querySelectorAll('.selectable, .radio, .dev-list-item, [data-rcfid*="item"]')
      ) as HTMLElement[];

      if (choiceItems.length > 0) {
        // Find parent sentence or preceding prompt
        const parentSentence = (group.closest('p, li, .sentence, .item, tr, div') as HTMLElement | null) || group.parentElement || group;
        const isCheckboxGroup = group.matches('.checkboxItemSelect, [class*="checkboxItemSelect"]') || group.getAttribute('data-rcfinteraction') === 'checkboxItemSelect';
        const clone = parentSentence.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.radioItemSelect, [class*="radioItemSelect"], .checkboxItemSelect, [class*="checkboxItemSelect"], button, [style*="display: none"]').forEach((n) => n.remove());
        let promptText = cleanText(clone.textContent);
        if (!promptText) {
          // Macmillan keeps the question in a sibling <div class="prompt"> inside the same list item
          const item = group.closest('li, .item, .sentence') as HTMLElement | null;
          if (item) {
            const itemClone = item.cloneNode(true) as HTMLElement;
            itemClone.querySelectorAll('.radioItemSelect, [class*="radioItemSelect"], .checkboxItemSelect, [class*="checkboxItemSelect"], .feedback, .dev-feedback, button').forEach((n) => n.remove());
            promptText = cleanText(itemClone.textContent);
          }
        }
        // The activity instructions (e.g. "Choose the 3 correct statements") often are the only prompt for a tick-box group
        const rubricText = cleanText(doc.querySelector('.rubric, .rubricBody')?.textContent);
        if (!promptText && isCheckboxGroup) promptText = rubricText;
        promptText = promptText || `Question #${rIndex}`;

        const options: AnswerOption[] = [];
        const fields: FormFieldRef[] = [];

        choiceItems.forEach((item, cIdx) => {
          const itemText = cleanText(item.textContent);
          if (itemText) {
            options.push({
              id: `opt_${rIndex}_${cIdx}`,
              label: itemText,
              value: item.getAttribute('data-rcfid') || itemText,
              elementSelector: getUniqueCssSelector(item),
            });
            fields.push({
              id: `field_${rIndex}_${cIdx}`,
              selector: getUniqueCssSelector(item),
              fieldType: isCheckboxGroup ? 'checkbox' : 'radio',
              name: group.id || `radio_${rIndex}`,
              currentValue: item.classList.contains('selected') || item.getAttribute('aria-checked') === 'true' ? itemText : undefined,
              label: itemText,
            });
          }
        });

        if (options.length > 0) {
          questions.push({
            id: `q_${rIndex}`,
            index: rIndex,
            type: isCheckboxGroup ? 'multiple_select' : 'multiple_choice',
            promptText,
            contextText: isCheckboxGroup && rubricText && rubricText !== promptText ? `[Instructions]: ${rubricText}` : undefined,
            options,
            fields,
            metadata: {
              containerSelector: getUniqueCssSelector(group),
              selectCount: isCheckboxGroup ? parseInt(group.getAttribute('data-rcfrestrict') || '', 10) || undefined : undefined,
            },
          });
          rIndex++;
        }
      }
    }
  }

  // 2. FIRST-CLASS MACMILLAN DRAG & DROP / CLICK-AND-STICK (.clickAndStickable, .dragTarget)
  const wordBoxEl = doc.querySelector('.wordBox') as HTMLElement | null;
  const wordBankOptions: AnswerOption[] = [];
  if (wordBoxEl) {
    const wordItems = Array.from(
      wordBoxEl.querySelectorAll('.draggable, .dragItem, [data-rcfid*="drag"], span, li, div')
    ).filter(
      (el) => el.children.length === 0 && el.textContent && el.textContent.trim().length > 1 && !el.classList.contains('count')
    ) as HTMLElement[];

    wordItems.forEach((w, wIdx) => {
      const txt = cleanText(w.textContent);
      if (txt && !wordBankOptions.some((o) => o.label.toLowerCase() === txt.toLowerCase())) {
        wordBankOptions.push({
          id: `wb_${wIdx}`,
          label: txt,
          value: txt,
          elementSelector: getUniqueCssSelector(w),
        });
      }
    });
  }

  // Find exactly the 7 primary droppable gap spans (ignore duplicate dragTarget wrappers)
  const droppableGaps = Array.from(
    doc.querySelectorAll('span.complexDroppable.rcfDroppable[data-rcfid*="complexDroppable_"], span[data-rcfid*="complexDroppable_"]')
  ).filter((el) => !el.classList.contains('wordBox')) as HTMLElement[];

  if (droppableGaps.length > 0 && questions.length === 0) {
    let dIndex = 1;
    for (const gapEl of droppableGaps) {
      const parentSentence = (gapEl.closest('p, li, .sentence, .item, tr, div') as HTMLElement | null) || gapEl.parentElement || gapEl;
      const clone = parentSentence.cloneNode(true) as HTMLElement;
      // When one sentence holds several gaps, number them so each question is distinguishable
      const gapsInSentence = clone.querySelectorAll('[data-rcfid^="complexDroppable_"]');
      const isMultiGap = gapsInSentence.length > 1;
      const currentGapId = gapEl.getAttribute('data-rcfid');
      if (isMultiGap) {
        gapsInSentence.forEach((g) => {
          const gapNo = (g.getAttribute('data-rcfid') || '').replace('complexDroppable_', '');
          g.replaceWith(clone.ownerDocument.createTextNode(` [BLANK ${gapNo}] `));
        });
      }
      clone.querySelectorAll('.dragTarget, .clickAndStickable, .complexDroppable, .wordBox, button, [style*="display: none"]').forEach((n) => {
        const placeholder = clone.ownerDocument.createTextNode(' [_____] ');
        n.replaceWith(placeholder);
      });
      let promptText = cleanText(clone.textContent) || `Gap #${dIndex}`;
      promptText = promptText.replace(/(\[\s*_____\s*\]\s*)+/g, '[_____] ');
      const sentenceText = promptText;
      if (isMultiGap && currentGapId) {
        promptText += ` (Answer ONLY for [BLANK ${currentGapId.replace('complexDroppable_', '')}])`;
      }

      // Whole passage (e.g. the full dialogue) as context, with every gap numbered
      let passageContext: string | undefined;
      const passage = gapEl.closest('.mm_blockText, .mm_interactive') as HTMLElement | null;
      if (passage && passage !== parentSentence) {
        const passageClone = passage.cloneNode(true) as HTMLElement;
        passageClone.querySelectorAll('.wordBox, button').forEach((n) => n.remove());
        passageClone.querySelectorAll('[data-rcfid^="complexDroppable_"]').forEach((g) => {
          const gapNo = (g.getAttribute('data-rcfid') || '').replace('complexDroppable_', '');
          g.replaceWith(clone.ownerDocument.createTextNode(` [BLANK ${gapNo}] `));
        });
        passageContext = cleanText(passageClone.textContent) || undefined;
        // One paragraph holding every gap: the passage *is* the prompt, so sending it twice per question only wastes tokens
        if (passageContext === sentenceText) passageContext = undefined;
      }
      const singleUse = !!wordBoxEl?.querySelector('[data-restrictcount="1"]');
      const contextText = [passageContext, singleUse ? '[Note: each word in the word bank can be used only once.]' : '']
        .filter(Boolean)
        .join('\n\n') || undefined;

      const fieldRef: FormFieldRef = {
        id: `field_drag_${dIndex}`,
        selector: getUniqueCssSelector(gapEl),
        fieldType: 'input',
        name: gapEl.id || `gap_${dIndex}`,
        label: `Gap ${dIndex}`,
      };

      questions.push({
        id: `q_${dIndex}`,
        index: dIndex,
        type: 'dropdown',
        promptText,
        contextText,
        options: wordBankOptions.length > 0 ? wordBankOptions : undefined,
        fields: [fieldRef],
        metadata: {
          containerSelector: getUniqueCssSelector(gapEl),
        },
      });
      dIndex++;
    }
  }

  const matchedContainers = queryAllDeep(doc, containerSelectors.join(','));

  if (matchedContainers.length > 0 && questions.length === 0) {
    let index = 1;
    for (const container of matchedContainers) {
      // Check if container has multiple text inputs (e.g. blog post gap-fill with 8 blanks)
      const innerInputs = (Array.from(
        container.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea')
      ) as HTMLElement[]).filter((i) => !isMediaControl(i));

      // If container has multiple text inputs and NOT a single radio group, treat EACH input as an individual question!
      const isRadioGroup = innerInputs.length > 0 && innerInputs.every((i) => i instanceof HTMLInputElement && i.type === 'radio');

      if (innerInputs.length > 1 && !isRadioGroup) {
        for (const inputEl of innerInputs) {
          const parentSentence = (inputEl.closest('p, li, .sentence, .item, tr, div') as HTMLElement | null) || container;
          const clone = parentSentence.cloneNode(true) as HTMLElement;
          
          // Replace all input, select, dropdown wrappers with blank placeholder [_____] in the prompt
          clone.querySelectorAll('.ui-selectmenu-button, .ui-selectmenu-menu, .dropDown, select, input, textarea, .markable').forEach((n) => {
            const placeholder = clone.ownerDocument.createTextNode(' [_____] ');
            n.replaceWith(placeholder);
          });
          clone.querySelectorAll(
            'button, a.okButton, a.cancelButton, .locating_popup, .textControls, .options, [style*="display: none"]'
          ).forEach((n) => n.remove());

          let promptText = cleanText(clone.textContent) || `Sentence #${index}`;
          // Compress multiple blanks if any
          promptText = promptText.replace(/(\[\s*_____\s*\]\s*)+/g, '[_____] ');

          let options: AnswerOption[] | undefined = undefined;
          let fieldType: FormFieldRef['fieldType'] = 'input';
          let qType: Question['type'] = 'fill_in_the_blank';

          const tag = (inputEl.tagName || '').toUpperCase();
          if (tag === 'SELECT') {
            fieldType = 'select';
            qType = 'dropdown';
            const selectEl = inputEl as HTMLSelectElement;
            const validOptions = Array.from(selectEl.options).filter((o) => o.text && o.text.trim().length > 0);
            if (validOptions.length > 0) {
              options = validOptions.map((opt, optIdx) => ({
                id: `opt_${index}_${optIdx}`,
                label: cleanText(opt.text),
                value: opt.value || opt.text,
              }));
            }
          }

          const fieldRef: FormFieldRef = {
            id: `field_${index}`,
            selector: getUniqueCssSelector(inputEl),
            fieldType,
            name: inputEl.getAttribute('name') || undefined,
            placeholder: inputEl.getAttribute('placeholder') || undefined,
            currentValue: (inputEl as HTMLInputElement).value || undefined,
            label: findLabelForElement(inputEl),
          };

          questions.push({
            id: `q_${index}`,
            index,
            type: qType,
            promptText,
            options,
            fields: [fieldRef],
            metadata: {
              containerSelector: getUniqueCssSelector(parentSentence),
            },
          });
          index++;
        }
      } else {
        const q = parseContainerIntoQuestion(container, index, doc);
        if (q && (q.fields.length > 0 || (q.options && q.options.length > 0))) {
          questions.push(q);
          index++;
        }
      }
    }
  }

  // Fallback: If no recognized containers were found, scan all interactive form elements directly
  if (questions.length === 0) {
    const interactiveElements = queryAllDeep(
      doc,
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea, [contenteditable="true"], [role="textbox"], [role="radio"], [class*="blank-input"], [class*="gap-input"]'
    ).filter((el) => !isMediaControl(el));

    // Group radio buttons by name
    const radioGroups = new Map<string, HTMLElement[]>();
    const standaloneFields: HTMLElement[] = [];

    for (const el of interactiveElements) {
      if ((el instanceof HTMLInputElement && el.type === 'radio') || el.getAttribute('role') === 'radio') {
        const name = (el as HTMLInputElement).name || el.getAttribute('data-group') || 'unnamed_radio';
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

  const glossaryText = findGlossaryData(doc);

  // Annotate all questions with listening context and glossary definitions if present
  for (const q of questions) {
    const contextParts: string[] = [];
    if (q.contextText) contextParts.push(q.contextText);

    if (listeningData.isListening || listeningData.transcript || listeningData.audioUrl) {
      q.metadata = {
        ...q.metadata,
        isListening: listeningData.isListening,
        audioUrl: listeningData.audioUrl,
        audioTranscript: listeningData.transcript,
      };
      if (listeningData.transcript) {
        contextParts.push(`[Audio Transcript / Tapescript]:\n${listeningData.transcript}`);
      } else if (listeningData.isListening) {
        contextParts.push(`[Note: Listening exercise. Audio: ${listeningData.audioUrl || 'in player'}]`);
      }
    }

    if (glossaryText) {
      contextParts.push(`[Glossary / Vocabulary Notes]:\n${glossaryText}`);
    }

    if (contextParts.length > 0) {
      q.contextText = contextParts.join('\n\n');
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
    // Strip all inputs, buttons, modal popups, and controls so their UI text doesn't contaminate the sentence
    clone.querySelectorAll(
      'input, select, textarea, button, a.okButton, a.cancelButton, .locating_popup, .textControls, .options, [style*="display: none"]'
    ).forEach((n) => n.remove());
    promptText = cleanText(clone.textContent);
  }

  const inputs = (Array.from(
    container.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea')
  ) as HTMLElement[]).filter((i) => !isMediaControl(i));

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
    const clone = heading.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.locating_popup, .textControls, button, a.okButton, a.cancelButton, input').forEach((n) => n.remove());
    return cleanText(clone.textContent);
  }

  // Look for preceding sibling text node or element before the first element
  const first = elements[0];
  let prev = first.previousElementSibling;
  while (prev) {
    if (['P', 'SPAN', 'DIV', 'LABEL'].includes(prev.tagName)) {
      const clone = prev.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.locating_popup, .textControls, button, a.okButton, a.cancelButton, input').forEach((n) => n.remove());
      const txt = cleanText(clone.textContent);
      if (txt.length > 3) return txt;
    }
    prev = prev.previousElementSibling;
  }

  const clone = parentBlock.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.locating_popup, .textControls, button, a.okButton, a.cancelButton, input').forEach((n) => n.remove());
  return cleanText(clone.textContent?.slice(0, 150));
}
