import { PlatformAdapter, PlatformId } from '../types/platform';
import { Question } from '../types/question';
import { extractQuestionsFromGenericDOM } from '../extractor/dom-scanner';
import { fillFormField } from '../filler/form-filler';

/**
 * Macmillan Education Everywhere / Language Hub Adapter
 * 
 * NOTE ON MACMILLAN REAL-PAGE TESTING:
 * Macmillan uses dynamic client-side rendering (SPA / Angular / React / Vue)
 * and sometimes embedded iframes for interactive courseware activities.
 * 
 * Known domain patterns:
 * - *.macmillaneducationeverywhere.com
 * - *.languagehub.macmillaneducation.com
 * - *.macmillanenglish.com
 * 
 * Marked integration points below show where exact proprietary selectors
 * can be plugged in once inspected on a live student session.
 */
export class MacmillanPlatformAdapter implements PlatformAdapter {
  readonly id: PlatformId = 'macmillan';
  readonly name = 'Macmillan Education / Language Hub';

  isPlatformPage(url: string, _doc: Document): boolean {
    try {
      const parsedUrl = new URL(url);
      const host = parsedUrl.hostname.toLowerCase();
      return (
        host.includes('macmillaneducationeverywhere.com') ||
        host.includes('languagehub.macmillaneducation.com') ||
        host.includes('macmillanenglish.com') ||
        host.includes('macmillan')
      );
    } catch {
      return false;
    }
  }

  detectExercise(doc: Document): boolean {
    /* -------------------------------------------------------------
     * [INTEGRATION POINT 1: Real-page Macmillan Exercise Selectors]
     * Macmillan Language Hub typically loads activities into content panes
     * like .activity-container, .exercise-view, .activity-body, or an iframe.
     * ------------------------------------------------------------- */
    const macmillanSpecificSelectors = [
      '[data-activity-id]',
      '.activity-container',
      '.exercise-container',
      '.activity-player',
      '.activity-content',
      '.question-container',
      'iframe[src*="activity"]',
      'iframe[src*="exercise"]',
    ];

    for (const selector of macmillanSpecificSelectors) {
      if (doc.querySelector(selector)) {
        return true;
      }
    }

    // Fallback: Check if page has interactive form elements inside main content
    const inputs = doc.querySelectorAll('input:not([type="hidden"]), select, textarea');
    return inputs.length > 0;
  }

  async extractQuestions(doc: Document): Promise<Question[]> {
    /* -------------------------------------------------------------
     * [INTEGRATION POINT 2: Macmillan Nested Activity Frames / Shadow DOM]
     * If Macmillan embeds the activity within a same-origin iframe:
     * ------------------------------------------------------------- */
    const activityIframe = doc.querySelector('iframe.activity-frame, iframe[id*="activity"]') as HTMLIFrameElement | null;
    if (activityIframe && activityIframe.contentDocument) {
      const iframeDoc = activityIframe.contentDocument;
      const iframeQuestions = extractQuestionsFromGenericDOM(iframeDoc);
      if (iframeQuestions.length > 0) {
        return iframeQuestions;
      }
    }

    /* -------------------------------------------------------------
     * [INTEGRATION POINT 3: Macmillan Proprietary Question Layout]
     * Language Hub frequently uses custom clickable word chips or
     * text inputs with class names such as .gap-fill, .blank-input.
     * Here we delegate to the robust DOM extractor and annotate with
     * Macmillan platform metadata.
     * ------------------------------------------------------------- */
    const questions = extractQuestionsFromGenericDOM(doc);

    return questions.map((q) => ({
      ...q,
      metadata: {
        ...q.metadata,
        platformSpecificId: `macmillan_${q.id}`,
      },
    }));
  }

  async fillAnswer(doc: Document, question: Question, answer: string): Promise<boolean> {
    /* -------------------------------------------------------------
     * [INTEGRATION POINT 4: Macmillan Custom Input Event Dispatch]
     * In Macmillan Language Hub, custom components might listen for
     * proprietary custom events or store answers in Angular NgModel.
     * The fillFormField helper triggers full synthetic events & native setters.
     * ------------------------------------------------------------- */
    const result = await fillFormField(doc, question, answer);
    return result.success;
  }
}
