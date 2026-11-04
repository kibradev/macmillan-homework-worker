import React, { useState } from 'react';
import { Check, Eye, EyeOff, Loader2, ShieldCheck, Zap } from 'lucide-react';
import { AIProviderId } from '../../types/ai';
import { UserSettings } from '../../storage/settings';
import { getAllAIProviders, getAIProvider } from '../../ai';

interface SettingsTabProps {
  settings: UserSettings;
  onSaveSettings: (newSettings: UserSettings) => Promise<void>;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({ settings, onSaveSettings }) => {
  const [localSettings, setLocalSettings] = useState<UserSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Keep localSettings in sync if parent settings change
  React.useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const providers = getAllAIProviders();
  const currentProvider = getAIProvider(localSettings.selectedProvider);
  const availableModels = currentProvider.getAvailableModels();

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProviderId = e.target.value as AIProviderId;
    const providerObj = getAIProvider(newProviderId);
    const updated: UserSettings = {
      ...localSettings,
      selectedProvider: newProviderId,
      selectedModels: {
        ...localSettings.selectedModels,
        [newProviderId]: localSettings.selectedModels[newProviderId] || providerObj.getDefaultModelId(),
      },
    };
    setLocalSettings(updated);
    onSaveSettings(updated).catch(() => {});
    setTestResult(null);
  };

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const updated: UserSettings = {
      ...localSettings,
      apiKeys: {
        ...localSettings.apiKeys,
        [localSettings.selectedProvider]: val,
      },
    };
    setLocalSettings(updated);
    // Instant auto-save to storage on change so user never loses it
    onSaveSettings(updated).catch(() => {});
    setTestResult(null);
    setSavedSuccess(false);
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const updated: UserSettings = {
      ...localSettings,
      selectedModels: {
        ...localSettings.selectedModels,
        [localSettings.selectedProvider]: val,
      },
    };
    setLocalSettings(updated);
    onSaveSettings(updated).catch(() => {});
  };

  const handleTestConnection = async () => {
    const currentKey = localSettings.apiKeys[localSettings.selectedProvider] || '';
    const currentModel = localSettings.selectedModels[localSettings.selectedProvider] || '';

    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await currentProvider.testConnection(currentKey, currentModel);
      setTestResult(res);
    } catch (err) {
      setTestResult({
        success: false,
        message: `Error testing connection: ${(err as Error).message}`,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveSettings(localSettings);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  const getPlaceholder = (providerId: AIProviderId) => {
    switch (providerId) {
      case 'gemini':
        return 'AIzaSy... (Get free key from Google AI Studio)';
      case 'openai':
        return 'sk-proj-... (OpenAI platform)';
      case 'anthropic':
        return 'sk-ant-... (Anthropic Console)';
      default:
        return 'Enter API Key';
    }
  };

  const currentApiKey = localSettings.apiKeys[localSettings.selectedProvider] || '';
  const currentModelId =
    localSettings.selectedModels[localSettings.selectedProvider] || currentProvider.getDefaultModelId();

  return (
    <div className="tab-content">
      {/* Provider Selector */}
      <div className="form-group">
        <label className="form-label">AI Provider</label>
        <select
          className="form-select"
          value={localSettings.selectedProvider}
          onChange={handleProviderChange}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="form-hint">Choose your preferred AI reasoning engine.</span>
      </div>

      {/* Model Selector */}
      <div className="form-group">
        <label className="form-label">Model Selection</label>
        <select
          className="form-select"
          value={availableModels.some((m) => m.id === currentModelId) ? currentModelId : 'custom'}
          onChange={(e) => {
            if (e.target.value !== 'custom') {
              handleModelChange(e);
            } else {
              setLocalSettings((prev) => ({
                ...prev,
                selectedModels: {
                  ...prev.selectedModels,
                  [prev.selectedProvider]: '',
                },
              }));
            }
          }}
        >
          {availableModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value="custom">Custom Model ID...</option>
        </select>
        {!availableModels.some((m) => m.id === currentModelId) && (
          <input
            type="text"
            className="form-input"
            style={{ marginTop: '6px' }}
            value={currentModelId}
            onChange={(e) => {
              const val = e.target.value;
              setLocalSettings((prev) => ({
                ...prev,
                selectedModels: {
                  ...prev.selectedModels,
                  [prev.selectedProvider]: val,
                },
              }));
            }}
            placeholder="Enter custom model ID (e.g. gemini-2.5-flash-lite)"
          />
        )}
        <span className="form-hint">
          {availableModels.find((m) => m.id === currentModelId)?.description ||
            `Current model: ${currentModelId || 'None'}`}
        </span>
      </div>

      {/* API Key */}
      <div className="form-group">
        <label className="form-label">
          {currentProvider.name} API Key
        </label>
        <div className="input-with-button">
          <input
            type={showKey ? 'text' : 'password'}
            className="form-input"
            value={currentApiKey}
            onChange={handleApiKeyChange}
            placeholder={getPlaceholder(localSettings.selectedProvider)}
          />
          <button
            className="icon-btn"
            style={{ width: '36px', height: '36px', flexShrink: 0 }}
            onClick={() => setShowKey(!showKey)}
            title={showKey ? 'Hide key' : 'Show key'}
          >
            {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>

      {/* Connection Test */}
      <div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleTestConnection}
          disabled={isTesting || !currentApiKey.trim()}
          style={{ width: '100%' }}
        >
          {isTesting ? (
            <>
              <Loader2 size={13} className="spin" /> Verifying Connection...
            </>
          ) : (
            <>
              <Zap size={13} /> Test API Connection
            </>
          )}
        </button>

        {testResult && (
          <div
            className={`banner banner-${testResult.success ? 'success' : 'error'}`}
            style={{ marginTop: '8px' }}
          >
            <span>{testResult.message}</span>
          </div>
        )}
      </div>

      {/* Automation Preferences */}
      <div className="security-note">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
          <Zap size={14} />
          <span>Automation & Auto-Fill</span>
        </div>
        <label className="approval-toggle" style={{ marginTop: '3px' }}>
          <input
            type="checkbox"
            checked={localSettings.autoFillOnGenerate}
            onChange={(e) =>
              setLocalSettings((prev) => ({
                ...prev,
                autoFillOnGenerate: e.target.checked,
              }))
            }
          />
          <span style={{ fontSize: '11px' }}>
            Automatically fill fields as soon as AI generates answers
          </span>
        </label>
        <label className="approval-toggle" style={{ marginTop: '2px' }}>
          <input
            type="checkbox"
            checked={localSettings.autoApproveAll}
            onChange={(e) =>
              setLocalSettings((prev) => ({
                ...prev,
                autoApproveAll: e.target.checked,
              }))
            }
          />
          <span style={{ fontSize: '11px' }}>
            Auto-approve all suggestions by default
          </span>
        </label>
      </div>

      {/* Security notice & Session storage toggle */}
      <div className="security-note">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
          <ShieldCheck size={14} />
          <span>Local-First & Client-Side Privacy</span>
        </div>
        <div>
          StudyPilot runs 100% in your browser without any middleman server. API keys communicate
          directly with {currentProvider.name}.
        </div>
        <label className="approval-toggle" style={{ marginTop: '4px' }}>
          <input
            type="checkbox"
            checked={localSettings.saveKeyToSessionOnly}
            onChange={(e) =>
              setLocalSettings((prev) => ({
                ...prev,
                saveKeyToSessionOnly: e.target.checked,
              }))
            }
          />
          <span style={{ fontSize: '11px' }}>
            {localSettings.saveKeyToSessionOnly
              ? 'Temporary mode (the key is erased when the browser session ends)'
              : 'Persistent mode: the API key survives reloads and browser restarts (recommended)'}
          </span>
        </label>
      </div>

      {/* Auto-advance (optional "solve everything" mode) */}
      <div className="form-group">
        <label className="form-label">Next button selector (optional)</label>
        <input
          type="text"
          className="form-input"
          value={localSettings.nextButtonSelector}
          onChange={(e) => {
            const val = e.target.value;
            setLocalSettings((prev) => ({ ...prev, nextButtonSelector: val }));
          }}
          placeholder="Leave empty to find it by its label. E.g. button.next-activity"
        />
        <span className="form-hint">
          Only used by the &quot;Solve All&quot; option of the on-page panel. If the extension cannot find the Next button, or
          finds more than one candidate, paste the button&apos;s CSS selector here.
        </span>
      </div>

      {/* Save Button */}
      <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <>
              <Loader2 size={15} className="spin" /> Saving...
            </>
          ) : savedSuccess ? (
            <>
              <Check size={15} /> Settings Saved
            </>
          ) : (
            'Save Settings'
          )}
        </button>
      </div>
    </div>
  );
};
