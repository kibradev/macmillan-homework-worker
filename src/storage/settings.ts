import { AIProviderConfig, AIProviderId } from '../types/ai';

export interface UserSettings {
  selectedProvider: AIProviderId;
  apiKeys: Record<AIProviderId, string>;
  selectedModels: Record<AIProviderId, string>;
  saveKeyToSessionOnly: boolean;
  theme: 'dark' | 'light' | 'system';
  confidenceThreshold: number;
}

const DEFAULT_SETTINGS: UserSettings = {
  selectedProvider: 'gemini',
  apiKeys: {
    gemini: '',
    openai: '',
    anthropic: '',
  },
  selectedModels: {
    gemini: 'gemini-2.5-flash-lite',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-haiku-latest',
  },
  saveKeyToSessionOnly: true,
  theme: 'dark',
  confidenceThreshold: 0.7,
};

const STORAGE_KEY = 'studypilot_settings';
const SESSION_KEYS_KEY = 'studypilot_session_keys';

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage;
}

export async function loadSettings(): Promise<UserSettings> {
  let settings = { ...DEFAULT_SETTINGS };

  try {
    if (hasChromeStorage()) {
      // 1. Load general settings from chrome.storage.local
      const localResult = await chrome.storage.local.get([STORAGE_KEY]);
      if (localResult[STORAGE_KEY]) {
        settings = { ...settings, ...localResult[STORAGE_KEY] };
      }

      // 2. If session-only is preferred, load API keys from chrome.storage.session
      if (chrome.storage.session) {
        const sessionResult = await chrome.storage.session.get([SESSION_KEYS_KEY]);
        if (sessionResult[SESSION_KEYS_KEY]) {
          settings.apiKeys = {
            ...settings.apiKeys,
            ...sessionResult[SESSION_KEYS_KEY],
          };
        }
      }

      // Ensure model defaults to 2.5-flash-lite
      if (!settings.selectedModels.gemini || settings.selectedModels.gemini === 'gemini-1.5-flash') {
        settings.selectedModels.gemini = 'gemini-2.5-flash-lite';
      }
    } else {
      // Dev mode fallback
      const local = localStorage.getItem(STORAGE_KEY);
      if (local) {
        settings = { ...settings, ...JSON.parse(local) };
      }
      const session = sessionStorage.getItem(SESSION_KEYS_KEY);
      if (session) {
        settings.apiKeys = { ...settings.apiKeys, ...JSON.parse(session) };
      }
    }
  } catch (err) {
    console.warn('[StudyPilot] Failed to load settings from storage, using defaults:', err);
  }

  return settings;
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  const { apiKeys, saveKeyToSessionOnly, ...restSettings } = settings;

  try {
    if (hasChromeStorage()) {
      if (saveKeyToSessionOnly) {
        // Save general settings without API keys to local storage
        await chrome.storage.local.set({
          [STORAGE_KEY]: { ...restSettings, saveKeyToSessionOnly: true, apiKeys: { gemini: '', openai: '', anthropic: '' } },
        });

        // Save keys only in session storage (cleared when browser session closes)
        if (chrome.storage.session) {
          await chrome.storage.session.set({
            [SESSION_KEYS_KEY]: apiKeys,
          });
        }
      } else {
        // Persistent storage
        await chrome.storage.local.set({
          [STORAGE_KEY]: settings,
        });
        if (chrome.storage.session) {
          await chrome.storage.session.remove([SESSION_KEYS_KEY]);
        }
      }
    } else {
      // Dev fallback
      if (saveKeyToSessionOnly) {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...restSettings, saveKeyToSessionOnly: true, apiKeys: { gemini: '', openai: '', anthropic: '' } })
        );
        sessionStorage.setItem(SESSION_KEYS_KEY, JSON.stringify(apiKeys));
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        sessionStorage.removeItem(SESSION_KEYS_KEY);
      }
    }
  } catch (err) {
    console.error('[StudyPilot] Error saving settings:', err);
    throw err;
  }
}

export function getActiveProviderConfig(settings: UserSettings): AIProviderConfig {
  const provider = settings.selectedProvider;
  return {
    providerId: provider,
    apiKey: settings.apiKeys[provider] || '',
    modelId: settings.selectedModels[provider] || '',
    saveKeyToSessionOnly: settings.saveKeyToSessionOnly,
  };
}
