import { SeriesDeps } from '../core/series';
import { getAIProvider } from '../ai';
import { loadSettings } from '../storage/settings';

/**
 * Real-browser implementation of the pipeline's dependencies.
 *
 * Frames are discovered with webNavigation and addressed with tabs.sendMessage: neither needs host access, and the
 * content script is already present in every frame. (scripting.executeScript, which the popup uses under activeTab,
 * would be refused for a click that came from a button inside the page.)
 */

interface FrameInfo {
  frameId: number;
  url: string;
}

async function listFrames(tabId: number): Promise<FrameInfo[]> {
  const frames = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
  const info = frames.map((f) => ({ frameId: f.frameId, url: f.url }));
  // The RCF player first, other child frames next, the top page last (it only wraps the player)
  const rank = (f: FrameInfo) => (/rcf-player/i.test(f.url) ? 0 : f.frameId !== 0 ? 1 : 2);
  return info.sort((a, b) => rank(a) - rank(b));
}

const send = <T>(tabId: number, frameId: number, message: object): Promise<T | null> =>
  chrome.tabs.sendMessage(tabId, message, { frameId }).then(
    (response) => response as T,
    () => null
  );

export const chromeDeps: SeriesDeps = {
  loadSettings,
  getProvider: getAIProvider,

  async scanFrames(tabId) {
    for (const frame of await listFrames(tabId)) {
      const res = await send<{ success: boolean; questions?: import('../types/question').Question[] }>(tabId, frame.frameId, {
        action: 'SCAN_QUESTIONS',
      });
      if (res?.success && res.questions && res.questions.length > 0) {
        return { frameId: frame.frameId, questions: res.questions };
      }
    }
    return null;
  },

  async describeEmpty(tabId) {
    const found: string[] = [];
    for (const frame of await listFrames(tabId)) {
      const res = await send<{ success: boolean; report?: { interactions: Array<{ type: string; status: string }> } }>(
        tabId,
        frame.frameId,
        { action: 'INSPECT_PAGE' }
      );
      for (const i of res?.report?.interactions ?? []) {
        if (i.status !== 'passive') found.push(i.status === 'UNSUPPORTED' ? `${i.type} (desteklenmiyor)` : i.type);
      }
    }
    if (found.length === 0) return 'Ödev tam yüklenmemiş olabilir; sayfayı yenileyip (F5) tekrar dene.';
    return `Sayfada şunlar var: ${found.join(', ')}.`;
  },

  async fill(tabId, frameId, question, answer) {
    const res = await send<{ success: boolean; error?: string }>(tabId, frameId, {
      action: 'FILL_APPROVED_ANSWER',
      question,
      answer,
    });
    return res ?? { success: false, error: 'Sayfa yanıt vermedi. Sayfayı yenileyip (F5) tekrar dene.' };
  },

  async activityId(tabId) {
    for (const frame of await listFrames(tabId)) {
      const res = await send<{ success: boolean; id?: string | null }>(tabId, frame.frameId, { action: 'GET_ACTIVITY_ID' });
      if (res?.id) return res.id;
    }
    return null;
  },

  async clickNext(tabId) {
    const settings = await loadSettings();
    // The Next button belongs to the page around the activity: the top frame
    const res = await send<{ success: boolean; clicked?: boolean; reason?: string }>(tabId, 0, {
      action: 'CLICK_NEXT',
      selector: settings.nextButtonSelector || undefined,
    });
    if (!res) return { clicked: false, reason: 'Sayfa yanıt vermedi.' };
    return { clicked: !!res.clicked, reason: res.reason };
  },

  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
