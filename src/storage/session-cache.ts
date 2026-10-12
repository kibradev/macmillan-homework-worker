import { AnswerReviewItem } from '../types/answer';

export interface TabHomeworkCache {
  url: string;
  items: AnswerReviewItem[];
  activeFrameId?: number;
  timestamp: number;
}

const CACHE_PREFIX = 'studypilot_tab_cache_';

function getStorage() {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    return chrome.storage.session || chrome.storage.local;
  }
  return null;
}

export async function saveTabHomeworkCache(
  tabId: number,
  url: string,
  items: AnswerReviewItem[],
  activeFrameId?: number
): Promise<void> {
  const storage = getStorage();
  if (!storage) return;

  const key = `${CACHE_PREFIX}${tabId}`;
  const data: TabHomeworkCache = {
    url,
    items,
    activeFrameId,
    timestamp: Date.now(),
  };

  try {
    await storage.set({ [key]: data });
  } catch (err) {
    console.warn('[StudyPilot] Could not save tab homework cache:', err);
  }
}

export async function loadTabHomeworkCache(
  tabId: number,
  currentUrl: string
): Promise<TabHomeworkCache | null> {
  const storage = getStorage();
  if (!storage) return null;

  const key = `${CACHE_PREFIX}${tabId}`;
  try {
    const result = await storage.get([key]);
    const cached: TabHomeworkCache | undefined = result[key];

    // Only restore if from the same page (or same base URL)
    if (cached && (cached.url === currentUrl || currentUrl.startsWith(cached.url.split('?')[0]))) {
      return cached;
    }
  } catch (err) {
    console.warn('[StudyPilot] Could not load tab homework cache:', err);
  }

  return null;
}

export async function clearTabHomeworkCache(tabId: number): Promise<void> {
  const storage = getStorage();
  if (!storage) return;

  const key = `${CACHE_PREFIX}${tabId}`;
  try {
    await storage.remove([key]);
  } catch (err) {
    console.warn('[StudyPilot] Could not clear tab cache:', err);
  }
}
