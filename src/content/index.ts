import { ExtensionRequestMessage } from '../types/messages';
import { detectCurrentPlatform, getPlatformAdapter } from '../platform/registry';
import { flashHighlight } from '../filler/form-filler';
import { inspectRcfPage } from '../extractor/rcf-inspector';

// Signal script presence
console.log('[StudyPilot] Content script initialized on:', window.location.href);

const w = window as unknown as { __studypilotLoaded?: boolean };
if (!w.__studypilotLoaded) {
w.__studypilotLoaded = true;
chrome.runtime.onMessage.addListener((message: ExtensionRequestMessage, _sender, sendResponse) => {
  const handleMessage = async () => {
    switch (message.action) {
      case 'PING_CONTENT_SCRIPT': {
        return { success: true, url: window.location.href };
      }

      case 'DETECT_PLATFORM': {
        const platform = detectCurrentPlatform(window.location.href, document);
        return { success: true, data: platform };
      }

      case 'SCAN_QUESTIONS': {
        const platform = detectCurrentPlatform(window.location.href, document);
        const adapter = getPlatformAdapter(window.location.href, document);
        const questions = await adapter.extractQuestions(document);
        return {
          success: true,
          questions,
          platform,
        };
      }

      case 'FILL_APPROVED_ANSWER': {
        const adapter = getPlatformAdapter(window.location.href, document);
        const result = await adapter.fillAnswer(document, message.question, message.answer);
        return {
          success: result.success,
          filled: result.success,
          error: result.error,
        };
      }

      case 'INSPECT_PAGE': {
        return { success: true, report: inspectRcfPage(document) };
      }

      case 'HIGHLIGHT_FIELD': {
        const el = document.querySelector(message.selector) as HTMLElement | null;
        if (el) {
          flashHighlight(el);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return { success: true };
        }
        return { success: false, error: 'Element not found.' };
      }

      default:
        return { success: false, error: 'Unknown action.' };
    }
  };

  handleMessage()
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ success: false, error: (err as Error).message }));

  return true; // Keep message channel open for async response
});
}
