import { extractQuestionsFromGenericDOM } from './dom-scanner';

/**
 * Macmillan RCF tags every interactive widget with `data-rcfinteraction="<type>"`.
 * This inspector reports which of those widgets are on the page, which ones StudyPilot can handle,
 * and whether the number of detected questions matches the number of gaps on the page.
 */

/** Interaction types the scanner + filler know how to handle. */
export const SUPPORTED_RCF_INTERACTIONS = new Set(['dropDown', 'complexDroppable', 'locating', 'typein', 'radioItemSelect']);

/** Layout-only wrappers: they contain questions but are not questions themselves. */
export const CONTAINER_RCF_INTERACTIONS = new Set(['collapsibleList']);

/** Interactions that each correspond to exactly one answerable gap. */
const GAP_RCF_INTERACTIONS = new Set(['dropDown', 'complexDroppable', 'locating', 'typein']);

export interface RcfInteractionSummary {
  type: string;
  count: number;
  status: 'supported' | 'container' | 'UNSUPPORTED';
  /** First element of this type, stripped of feedback/svg/script and truncated. Only for unsupported types. */
  sampleHtml?: string;
}

export interface RcfInspectionReport {
  url: string;
  activity?: Record<string, string | null>;
  interactions: RcfInteractionSummary[];
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
    const status = SUPPORTED_RCF_INTERACTIONS.has(type)
      ? 'supported'
      : CONTAINER_RCF_INTERACTIONS.has(type)
        ? 'container'
        : 'UNSUPPORTED';
    return {
      type,
      count: els.length,
      status,
      sampleHtml: status === 'UNSUPPORTED' ? sanitizedSample(els[0]) : undefined,
    };
  });

  let questions: ReturnType<typeof extractQuestionsFromGenericDOM> = [];
  try {
    questions = extractQuestionsFromGenericDOM(doc);
  } catch (err) {
    warnings.push(`Scanner threw: ${(err as Error).message}`);
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

  const list = doc.querySelector('[data-rcfinteraction="collapsibleList"]');
  if (list && list.getAttribute('data-default') !== 'expanded') {
    warnings.push('collapsibleList is in "one by one" mode: only the active item is visible, others may not be fillable.');
  }

  return { url, activity, interactions, gapsOnPage, questionsDetected: questions.length, questionTypes, warnings };
}
