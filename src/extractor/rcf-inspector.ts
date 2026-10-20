import { extractQuestionsFromGenericDOM, findGlossaryData, findListeningData, getLastScannerError } from './dom-scanner';

/**
 * Macmillan RCF tags every interactive widget with `data-rcfinteraction="<type>"`.
 * This inspector reports which of those widgets are on the page, which ones StudyPilot can handle,
 * and whether the number of detected questions matches the number of gaps on the page.
 */

/** Interaction types the scanner + filler know how to handle. */
export const SUPPORTED_RCF_INTERACTIONS = new Set(['dropDown', 'complexDroppable', 'locating', 'typein', 'radioItemSelect', 'checkboxItemSelect']);

/**
 * Widgets that hold content but are never answered: layout wrappers, the audio player, the glossary box.
 * Macmillan also flags such widgets itself with data-ignorenextanswer="y".
 */
export const PASSIVE_RCF_INTERACTIONS = new Set(['collapsibleList', 'collapsibleBlock', 'audioElement']);

/** Interactions that each correspond to exactly one answerable gap. */
const GAP_RCF_INTERACTIONS = new Set(['dropDown', 'complexDroppable', 'locating', 'typein', 'radioItemSelect', 'checkboxItemSelect']);

export interface RcfInteractionSummary {
  type: string;
  count: number;
  status: 'supported' | 'passive' | 'UNSUPPORTED';
  /** The same interaction name can hide different mechanisms (e.g. locating: typed correction vs choice popup). */
  variants?: Record<string, number>;
  /** First element of this type, stripped of feedback/svg/script and truncated. Only for unsupported types. */
  sampleHtml?: string;
}

export interface RcfInspectionReport {
  url: string;
  activity?: Record<string, string | null>;
  interactions: RcfInteractionSummary[];
  /** What the AI will be told about audio/glossary: shows whether a listening activity has a usable transcript. */
  context: {
    isListening: boolean;
    audioFile?: string | null;
    transcriptFound: boolean;
    transcriptPreview?: string;
    captionsButtonPresent: boolean;
    glossaryFound: boolean;
  };
  gapsOnPage: number;
  questionsDetected: number;
  questionTypes: Record<string, number>;
  warnings: string[];
}

const SAMPLE_LIMIT = 2500;

function sanitizedSample(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  // Feedback blocks reveal answers; svg/script/style/audio are noise.
  clone.querySelectorAll('.feedback, .dev-feedback, svg, script, style, audio, img').forEach((n) => n.remove());
  const html = clone.outerHTML.replace(/\s+/g, ' ');
  return html.length > SAMPLE_LIMIT ? `${html.slice(0, SAMPLE_LIMIT)}…[truncated]` : html;
}

export function inspectRcfPage(doc: Document): RcfInspectionReport {
  const warnings: string[] = [];
  const url = doc.defaultView?.location?.href || '';

  const root = doc.querySelector('.dev-rcf-content, [data-rcfxmlid]') as HTMLElement | null;
  const activity = root
    ? {
        classes: root.className || null,
        interactions: root.getAttribute('data-interactions'),
        gradableType: root.getAttribute('data-gradabletype'),
        usingDragDrop: root.getAttribute('data-usingdragdrop'),
        singleUseWords: root.querySelector('[data-restrictcount="1"]') ? 'yes' : 'no',
      }
    : undefined;

  const byType = new Map<string, Element[]>();
  doc.querySelectorAll('[data-rcfinteraction]').forEach((el) => {
    const type = el.getAttribute('data-rcfinteraction') || '(empty)';
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(el);
  });

  const interactions: RcfInteractionSummary[] = Array.from(byType.entries()).map(([type, els]) => {
    const isPassive = PASSIVE_RCF_INTERACTIONS.has(type) || els.every((el) => el.getAttribute('data-ignorenextanswer') === 'y');
    const status = SUPPORTED_RCF_INTERACTIONS.has(type) ? 'supported' : isPassive ? 'passive' : 'UNSUPPORTED';
    const variants: Record<string, number> = {};
    if (type === 'locating') {
      for (const el of els) {
        const variant = el.querySelector('.locatingSpanPopup') ? 'choice-popup' : 'typed-correction';
        variants[variant] = (variants[variant] || 0) + 1;
      }
    }
    return {
      type,
      count: els.length,
      status,
      variants: Object.keys(variants).length ? variants : undefined,
      sampleHtml: status === 'UNSUPPORTED' ? sanitizedSample(els[0]) : undefined,
    };
  });

  let questions: ReturnType<typeof extractQuestionsFromGenericDOM> = [];
  try {
    questions = extractQuestionsFromGenericDOM(doc);
  } catch (err) {
    warnings.push(`Scanner threw: ${(err as Error).message}`);
  }
  const scannerError = getLastScannerError();
  if (scannerError) {
    // First stack frames are enough to locate the failing block
    warnings.push(`Scanner block failed (partial results kept): ${scannerError.split('\n').slice(0, 4).join(' | ')}`);
  }

  const questionTypes: Record<string, number> = {};
  for (const q of questions) questionTypes[q.type] = (questionTypes[q.type] || 0) + 1;

  const gapsOnPage = interactions
    .filter((i) => GAP_RCF_INTERACTIONS.has(i.type))
    .reduce((sum, i) => sum + i.count, 0);

  for (const i of interactions) {
    if (i.status === 'UNSUPPORTED') warnings.push(`Unsupported interaction "${i.type}" (${i.count}x): answers cannot be filled.`);
  }
  if (gapsOnPage > 0 && questions.length !== gapsOnPage) {
    warnings.push(`Page has ${gapsOnPage} gap widgets but ${questions.length} questions were detected.`);
  }
  if (interactions.length === 0 && questions.length === 0) {
    warnings.push('No data-rcfinteraction widgets found: wrong frame, or the activity has not finished loading.');
  }

  const listening = findListeningData(doc);
  const context: RcfInspectionReport['context'] = {
    isListening: listening.isListening,
    audioFile: doc.querySelector('[data-audiosrc]')?.getAttribute('data-audiosrc'),
    transcriptFound: !!listening.transcript,
    transcriptPreview: listening.transcript?.slice(0, 200),
    captionsButtonPresent: !!doc.querySelector('.audioScriptButton, [data-plyr="rcf-captions"]'),
    glossaryFound: !!findGlossaryData(doc),
  };
  if (context.isListening && !context.transcriptFound) {
    warnings.push(
      `Listening activity without a readable transcript${context.captionsButtonPresent ? ' (a captions button exists: the script may only load when it is clicked)' : ''}: the AI cannot hear the audio and will guess.`
    );
  }

  const list = doc.querySelector('[data-rcfinteraction="collapsibleList"]');
  if (list && list.getAttribute('data-default') !== 'expanded') {
    warnings.push('collapsibleList is in "one by one" mode: only the active item is visible, others may not be fillable.');
  }

  return { url, activity, interactions, context, gapsOnPage, questionsDetected: questions.length, questionTypes, warnings };
}

export interface RcfSnapshot {
  url: string;
  /** Sanitized outerHTML of the activity: structure, classes, ids, data-*, aria-checked/role kept; noise removed. */
  html: string;
  originalLength: number;
  truncated: boolean;
}

const SNAPSHOT_LIMIT = 150_000;

/**
 * Compact copy of the activity markup, safe to paste when a new question type needs support.
 * Removes what only adds size or leaks answers (feedback, svg, scripts, styles, images, player internals).
 */
export function snapshotRcfActivity(doc: Document): RcfSnapshot {
  const root = (doc.querySelector('.dev-rcf-content, [data-rcfxmlid]') as HTMLElement | null) || doc.body;
  const clone = root.cloneNode(true) as HTMLElement;

  clone.querySelectorAll('.feedback, .dev-feedback, svg, script, style, img, audio, source, .plyr__controls, noscript').forEach((n) => n.remove());
  const noisyAttrs = ['style', 'tabindex', 'aria-labelledby', 'aria-activedescendant', 'aria-owns', 'aria-live', 'autocomplete', 'crossorigin', 'preload'];
  for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const attr of noisyAttrs) el.removeAttribute(attr);
  }

  const html = clone.outerHTML.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ');
  return {
    url: doc.defaultView?.location?.href || '',
    html: html.length > SNAPSHOT_LIMIT ? `${html.slice(0, SNAPSHOT_LIMIT)}<!-- truncated -->` : html,
    originalLength: html.length,
    truncated: html.length > SNAPSHOT_LIMIT,
  };
}
