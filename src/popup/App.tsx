import React, { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { ScannerTab } from './components/ScannerTab';
import { SettingsTab } from './components/SettingsTab';
import { BannerMessage, StatusBanner } from './components/StatusBanner';
import { AnswerReviewItem } from '../types/answer';
import { PlatformDetectionResult } from '../types/platform';
import { loadSettings, saveSettings, UserSettings, getActiveProviderConfig } from '../storage/settings';
import { getAIProvider } from '../ai';
import { ScanQuestionsResponse, FillApprovedAnswerResponse } from '../types/messages';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'assistant' | 'settings'>('assistant');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [platform, setPlatform] = useState<PlatformDetectionResult | null>(null);
  const [items, setItems] = useState<AnswerReviewItem[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFilling, setIsFilling] = useState(false);
  const [banner, setBanner] = useState<BannerMessage | null>(null);

  // Load user settings on startup
  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setTheme(s.theme === 'light' ? 'light' : 'dark');
      document.documentElement.setAttribute('data-theme', s.theme === 'light' ? 'light' : 'dark');
    });
  }, []);

  // Detect current platform on popup open
  useEffect(() => {
    detectActiveTabPlatform();
  }, []);

  const toggleTheme = () => {
    const nextTheme: 'dark' | 'light' = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    if (settings) {
      const updated: UserSettings = { ...settings, theme: nextTheme };
      setSettings(updated);
      saveSettings(updated).catch(() => {});
    }
  };

  const getActiveTabId = async (): Promise<number | null> => {
    if (typeof chrome === 'undefined' || !chrome.tabs) return null;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  };

  const ensureContentScriptInjected = async (tabId: number): Promise<boolean> => {
    try {
      // Ping content script to see if active
      await chrome.tabs.sendMessage(tabId, { action: 'PING_CONTENT_SCRIPT' });
      return true;
    } catch {
      // If ping failed, try programmatic injection
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        });
        return true;
      } catch (injectErr) {
        console.warn('Could not inject content script:', injectErr);
        return false;
      }
    }
  };

  const detectActiveTabPlatform = async () => {
    const tabId = await getActiveTabId();
    if (!tabId) {
      setPlatform({
        id: 'generic',
        name: 'Browser Tab (Testing Mode)',
        isPlatformPage: false,
        hasExercise: false,
        confidence: 0,
        reason: 'Running in detached or preview environment.',
      });
      return;
    }

    const ready = await ensureContentScriptInjected(tabId);
    if (!ready) {
      setPlatform({
        id: 'generic',
        name: 'Restricted Page',
        isPlatformPage: false,
        hasExercise: false,
        confidence: 0,
        reason: 'Extensions cannot run on internal browser pages (e.g. chrome://).',
      });
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: 'DETECT_PLATFORM' });
      if (response && response.success) {
        setPlatform(response.data);
      }
    } catch (err) {
      console.warn('Platform detection error:', err);
    }
  };

  const handleScan = async () => {
    setIsScanning(true);
    setBanner(null);

    const tabId = await getActiveTabId();
    if (!tabId) {
      setIsScanning(false);
      setBanner({
        type: 'warning',
        text: 'No active tab found. Please open an educational exercise page.',
      });
      return;
    }

    const ready = await ensureContentScriptInjected(tabId);
    if (!ready) {
      setIsScanning(false);
      setBanner({
        type: 'error',
        text: 'Unable to access page. Ensure the extension has permission for this URL.',
      });
      return;
    }

    try {
      const response: ScanQuestionsResponse = await chrome.tabs.sendMessage(tabId, {
        action: 'SCAN_QUESTIONS',
      });

      if (!response.success || !response.questions) {
        throw new Error(response.error || 'Question scan failed.');
      }

      if (response.platform) {
        setPlatform(response.platform);
      }

      if (response.questions.length === 0) {
        setItems([]);
        setBanner({
          type: 'info',
          text: 'No homework questions detected on the current page.',
        });
      } else {
        const reviewItems: AnswerReviewItem[] = response.questions.map((q) => ({
          question: q,
          userEditedAnswer: '',
          approved: false,
          fillStatus: 'idle',
        }));
        setItems(reviewItems);
        setBanner({
          type: 'success',
          text: `Successfully detected ${reviewItems.length} question${reviewItems.length === 1 ? '' : 's'}.`,
        });
      }
    } catch (err) {
      setBanner({
        type: 'error',
        text: `Scan failed: ${(err as Error).message}`,
      });
    } finally {
      setIsScanning(false);
    }
  };

  const handleGenerate = async () => {
    if (!settings) return;
    const providerConfig = getActiveProviderConfig(settings);

    if (!providerConfig.apiKey.trim()) {
      setBanner({
        type: 'warning',
        text: `Please enter your ${settings.selectedProvider} API key in Settings first.`,
      });
      setActiveTab('settings');
      return;
    }

    if (items.length === 0) {
      setBanner({
        type: 'info',
        text: 'No questions to analyze. Scan a homework page first.',
      });
      return;
    }

    setIsGenerating(true);
    setBanner(null);

    try {
      const aiProvider = getAIProvider(providerConfig.providerId);
      const questionsToSolve = items.map((i) => i.question);

      const result = await aiProvider.generateAnswers(
        questionsToSolve,
        providerConfig.apiKey,
        providerConfig.modelId
      );

      // Merge suggestions into review items
      const updatedItems: AnswerReviewItem[] = items.map((item) => {
        const suggestion = result.suggestions.find((s) => s.questionId === item.question.id);
        const suggestedAnswer = suggestion?.suggestedAnswer || '';
        const meetsConfidence = (suggestion?.confidence ?? 0) >= (settings.confidenceThreshold ?? 0.7);

        return {
          ...item,
          suggestion,
          userEditedAnswer: suggestedAnswer,
          // Auto-approve if high confidence, but let user uncheck
          approved: meetsConfidence && Boolean(suggestedAnswer),
          fillStatus: 'idle',
        };
      });

      setItems(updatedItems);
      setBanner({
        type: 'success',
        text: `Generated suggestions using ${aiProvider.name} (${result.modelUsed}).`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: `AI Generation failed: ${(err as Error).message}`,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFillApproved = async () => {
    const tabId = await getActiveTabId();
    if (!tabId) return;

    const approvedIndices = items
      .map((item, idx) => (item.approved && item.userEditedAnswer ? idx : -1))
      .filter((idx) => idx !== -1);

    if (approvedIndices.length === 0) {
      setBanner({
        type: 'warning',
        text: 'No approved answers to fill. Please review and check "Approve to fill".',
      });
      return;
    }

    setIsFilling(true);
    setBanner(null);

    let successCount = 0;
    let failCount = 0;

    for (const idx of approvedIndices) {
      const item = items[idx];

      // Mark filling
      setItems((prev) =>
        prev.map((it, i) => (i === idx ? { ...it, fillStatus: 'filling' } : it))
      );

      try {
        const response: FillApprovedAnswerResponse = await chrome.tabs.sendMessage(tabId, {
          action: 'FILL_APPROVED_ANSWER',
          question: item.question,
          answer: item.userEditedAnswer,
        });

        if (response && response.success) {
          successCount++;
          setItems((prev) =>
            prev.map((it, i) => (i === idx ? { ...it, fillStatus: 'filled' } : it))
          );
        } else {
          failCount++;
          setItems((prev) =>
            prev.map((it, i) =>
              i === idx
                ? { ...it, fillStatus: 'error', fillErrorMessage: response?.error || 'Field match failed' }
                : it
            )
          );
        }
      } catch (err) {
        failCount++;
        setItems((prev) =>
          prev.map((it, i) =>
            i === idx
              ? { ...it, fillStatus: 'error', fillErrorMessage: (err as Error).message }
              : it
          )
        );
      }

      // Small delay between fills for visual feedback
      await new Promise((r) => setTimeout(r, 120));
    }

    setIsFilling(false);

    if (failCount === 0) {
      setBanner({
        type: 'success',
        text: `Filled ${successCount} approved answer${successCount === 1 ? '' : 's'}. Review carefully before manually submitting.`,
      });
    } else {
      setBanner({
        type: 'warning',
        text: `Filled ${successCount} fields. ${failCount} fields could not be matched.`,
      });
    }
  };

  const handleUpdateAnswer = (index: number, newAnswer: string) => {
    setItems((prev) =>
      prev.map((it, idx) => (idx === index ? { ...it, userEditedAnswer: newAnswer } : it))
    );
  };

  const handleToggleApproval = (index: number) => {
    setItems((prev) =>
      prev.map((it, idx) => (idx === index ? { ...it, approved: !it.approved } : it))
    );
  };

  const handleToggleAllApprovals = () => {
    const allApproved = items.every((i) => i.approved);
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        approved: !allApproved && Boolean(it.userEditedAnswer),
      }))
    );
  };

  const handleHighlightField = async (selector: string) => {
    const tabId = await getActiveTabId();
    if (!tabId) return;
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'HIGHLIGHT_FIELD',
        selector,
      });
    } catch (err) {
      console.warn('Could not highlight field:', err);
    }
  };

  const handleSaveSettings = async (newSettings: UserSettings) => {
    await saveSettings(newSettings);
    setSettings(newSettings);
  };

  if (!settings) {
    return (
      <div
        className="app-container"
        style={{ alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}
      >
        Loading StudyPilot...
      </div>
    );
  }

  const activeProvider = getAIProvider(settings.selectedProvider);
  const hasApiKey = Boolean(settings.apiKeys[settings.selectedProvider]?.trim());

  return (
    <div className="app-container">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        platform={platform}
        theme={theme}
        toggleTheme={toggleTheme}
      />

      <div style={{ padding: '8px 16px 0 16px' }}>
        <StatusBanner banner={banner} onDismiss={() => setBanner(null)} />
      </div>

      {activeTab === 'assistant' ? (
        <ScannerTab
          items={items}
          isScanning={isScanning}
          isGenerating={isGenerating}
          isFilling={isFilling}
          hasApiKey={hasApiKey}
          activeProviderName={activeProvider.name}
          onScan={handleScan}
          onGenerate={handleGenerate}
          onFillApproved={handleFillApproved}
          onUpdateAnswer={handleUpdateAnswer}
          onToggleApproval={handleToggleApproval}
          onToggleAllApprovals={handleToggleAllApprovals}
          onHighlightField={handleHighlightField}
          onOpenSettings={() => setActiveTab('settings')}
        />
      ) : (
        <SettingsTab settings={settings} onSaveSettings={handleSaveSettings} />
      )}
    </div>
  );
};
