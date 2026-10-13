import { AIProviderConfig, AIProviderId } from '../types/ai';

export interface UserSettings {
  selectedProvider: AIProviderId;
  apiKeys: Record<AIProviderId, string>;
  selectedModels: Record<AIProviderId, string>;
  saveKeyToSessionOnly: boolean;
  theme: 'dark' | 'light' | 'system';
  confidenceThreshold: number;
  autoFillOnGenerate: boolean;
  autoApproveAll: boolean;
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
  saveKeyToSessionOnly: false,
  theme: 'dark',
  confidenceThreshold: 0.7,
  autoFillOnGenerate: true,
  autoApproveAll: true,
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
      // 1. Load general settings & persistent keys from chrome.storage.local
      const localResult = await chrome.storage.local.get([STORAGE_KEY, 'studypilot_persistent_keys']);
      console.log('[StudyPilot Storage] Loaded from chrome.storage.local:', localResult);

      if (localResult[STORAGE_KEY]) {
        settings = { ...settings, ...localResult[STORAGE_KEY] };
      }
      if (localResult.studypilot_persistent_keys) {
        settings.apiKeys = {
          ...settings.apiKeys,
          ...localResult.studypilot_persistent_keys,
        };
      }

      // Check localStorage backup
      try {
        const backup = localStorage.getItem('studypilot_backup_keys');
        if (backup) {
          const parsed = JSON.parse(backup);
          settings.apiKeys = { ...settings.apiKeys, ...parsed };
        }
      } catch {}

      // 2. Also check session storage if any session-override keys exist
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
        // Session-only: clear from local, save to session
        await chrome.storage.local.set({
          [STORAGE_KEY]: { ...restSettings, saveKeyToSessionOnly: true, apiKeys: { gemini: '', openai: '', anthropic: '' } },
        });
        if (chrome.storage.session) {
          await chrome.storage.session.set({
            [SESSION_KEYS_KEY]: apiKeys,
          });
        }
      } else {
        // PERMANENT STORAGE: Save keys directly in chrome.storage.local (never lost on reload)
        await chrome.storage.local.set({
          [STORAGE_KEY]: {
            ...settings,
            saveKeyToSessionOnly: false,
            apiKeys,
          },
          studypilot_persistent_keys: apiKeys,
        });
        // Backup to localStorage as fail-safe
        try {
          localStorage.setItem('studypilot_backup_keys', JSON.stringify(apiKeys));
        } catch {}
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
        localStorage.setItem('studypilot_backup_keys', JSON.stringify(apiKeys));
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
