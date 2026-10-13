import React, { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { ScannerTab } from './components/ScannerTab';
import { SettingsTab } from './components/SettingsTab';
import { BannerMessage, StatusBanner } from './components/StatusBanner';
import { AnswerReviewItem } from '../types/answer';
import { Question } from '../types/question';
import { PlatformDetectionResult } from '../types/platform';
import { loadSettings, saveSettings, UserSettings, getActiveProviderConfig } from '../storage/settings';
import { loadTabHomeworkCache, saveTabHomeworkCache, clearTabHomeworkCache } from '../storage/session-cache';
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
  const [activeFrameId, setActiveFrameId] = useState<number | undefined>(undefined);
  const [banner, setBanner] = useState<BannerMessage | null>(null);

  // Load user settings on startup
  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setTheme(s.theme === 'light' ? 'light' : 'dark');
      document.documentElement.setAttribute('data-theme', s.theme === 'light' ? 'light' : 'dark');
    });
  }, []);

  // Detect current platform and restore cached homework questions for this tab
  useEffect(() => {
    detectActiveTabPlatform();

    const restoreCache = async () => {
      const tab = await getActiveTab();
      if (tab?.id && tab.url) {
        const cached = await loadTabHomeworkCache(tab.id, tab.url);
        if (cached && cached.items && cached.items.length > 0) {
          setItems(cached.items);
          if (cached.activeFrameId !== undefined) {
            setActiveFrameId(cached.activeFrameId);
          }
          setBanner({
            type: 'info',
            text: `Restored ${cached.items.length} questions from current session.`,
          });
        }
      }
    };
    restoreCache();
  }, []);

  // Auto-save questions to cache whenever items change
  useEffect(() => {
    if (items.length > 0) {
      getActiveTab().then((tab) => {
        if (tab?.id && tab.url) {
          saveTabHomeworkCache(tab.id, tab.url, items, activeFrameId);
        }
      });
    }
  }, [items, activeFrameId]);

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

  const getActiveTab = async (): Promise<chrome.tabs.Tab | null> => {
    if (typeof chrome === 'undefined' || !chrome.tabs) return null;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  };

  const getActiveTabId = async (): Promise<number | null> => {
    const tab = await getActiveTab();
    return tab?.id ?? null;
  };

  const handleClear = async () => {
    setItems([]);
    setActiveFrameId(undefined);
    setBanner(null);
    const tabId = await getActiveTabId();
    if (tabId) {
      await clearTabHomeworkCache(tabId);
    }
  };

  const handleOpenSidePanel = async () => {
    const tab = await getActiveTab();
    if (tab?.id && typeof chrome !== 'undefined' && (chrome as any).sidePanel?.open) {
      try {
        await (chrome as any).sidePanel.open({ tabId: tab.id });
        window.close(); // Close small popup as side panel is now open
      } catch (err) {
        console.warn('Could not open sidePanel:', err);
      }
    }
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

  const performScan = async (): Promise<{
    questions: Question[];
    frameId?: number;
  } | null> => {
    const tabId = await getActiveTabId();
    if (!tabId) return null;

    const ready = await ensureContentScriptInjected(tabId);
    if (!ready) return null;

    let response: ScanQuestionsResponse | null = null;
    let foundFrameId: number | undefined = undefined;

    // 1. Try scanning top frame (frame 0)
    try {
      const topRes: ScanQuestionsResponse = await chrome.tabs.sendMessage(tabId, {
        action: 'SCAN_QUESTIONS',
      });
      if (topRes && topRes.success && topRes.questions && topRes.questions.length > 0) {
        response = topRes;
        foundFrameId = 0;
      }
    } catch (topErr) {
      console.warn('Top frame scan warning:', topErr);
    }

    // 2. If top frame had 0 questions, search all child iframes (Macmillan embeds activity in iframes)
    if (!response || !response.questions || response.questions.length === 0) {
      try {
        const frameResults = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => {
            const inputs = document.querySelectorAll(
              'input:not([type="hidden"]), select, textarea, [contenteditable="true"], [role="textbox"], [role="radio"], [class*="gap"], [class*="blank"], [class*="activity"]'
            );
            return {
              inputsCount: inputs.length,
              url: window.location.href,
            };
          },
        });

        for (const fr of frameResults) {
          if (fr.frameId !== 0 && (fr.result?.inputsCount || 0) > 0) {
            try {
              // Ensure content script is ready in this sub-frame
              await chrome.scripting
                .executeScript({
                  target: { tabId, frameIds: [fr.frameId] },
                  files: ['content.js'],
                })
                .catch(() => {});

              const frameRes: ScanQuestionsResponse = await chrome.tabs.sendMessage(
                tabId,
                { action: 'SCAN_QUESTIONS' },
                { frameId: fr.frameId }
              );

              if (frameRes && frameRes.success && frameRes.questions && frameRes.questions.length > 0) {
                response = frameRes;
                foundFrameId = fr.frameId;
                break;
              }
            } catch (subErr) {
              console.warn('Sub-frame scan warning:', subErr);
            }
          }
        }
      } catch (frameErr) {
        console.warn('Frame discovery error:', frameErr);
      }
    }

    if (!response || !response.questions) {
      return null;
    }

    setActiveFrameId(foundFrameId);

    if (response.platform) {
      setPlatform(response.platform);
    }

    return {
      questions: response.questions,
      frameId: foundFrameId,
    };
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

    try {
      const scanRes = await performScan();
      if (!scanRes || scanRes.questions.length === 0) {
        setItems([]);
        setBanner({
          type: 'info',
          text: 'No homework questions detected on this page. If this is an iframe, please wait for it to load.',
        });
      } else {
        const reviewItems: AnswerReviewItem[] = scanRes.questions.map((q) => ({
          question: q,
          userEditedAnswer: '',
          approved: false,
          fillStatus: 'idle',
        }));
        setItems(reviewItems);
        setBanner({
          type: 'success',
          text: `Detected ${reviewItems.length} question${reviewItems.length === 1 ? '' : 's'}${
            scanRes.frameId !== 0 && scanRes.frameId !== undefined ? ' (inside activity frame)' : ''
          }.`,
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

  const handleAutoPilot = async () => {
    if (!settings) return;
    const providerConfig = getActiveProviderConfig(settings);

    if (!providerConfig.apiKey.trim()) {
      setBanner({
        type: 'warning',
        text: `Önce Ayarlar (AI & Settings) sekmesinden ${settings.selectedProvider} API anahtarınızı girin.`,
      });
      setActiveTab('settings');
      return;
    }

    setIsScanning(true);
    setBanner({
      type: 'info',
      text: '1/3 Sayfa taranıyor...',
    });

    try {
      let questionsToSolve = items.map((i) => i.question);
      let currentReviewItems = items;

      if (questionsToSolve.length === 0) {
        const scanRes = await performScan();
        if (!scanRes || scanRes.questions.length === 0) {
          setIsScanning(false);
          setBanner({
            type: 'warning',
            text: 'Sayfada çözülecek soru tespit edilemedi. Lütfen ödevin tam yüklendiğinden emin olun.',
          });
          return;
        }
        questionsToSolve = scanRes.questions;
        currentReviewItems = scanRes.questions.map((q) => ({
          question: q,
          userEditedAnswer: '',
          approved: true,
          fillStatus: 'idle',
        }));
        setItems(currentReviewItems);
      }
      setIsScanning(false);

      // 2. Generate with AI
      setIsGenerating(true);
      setBanner({
        type: 'info',
        text: `2/3 Yapay zeka soruları çözüyor (${questionsToSolve.length} soru)...`,
      });

      const aiProvider = getAIProvider(providerConfig.providerId);
      const result = await aiProvider.generateAnswers(
        questionsToSolve,
        providerConfig.apiKey,
        providerConfig.modelId
      );

      const solvedItems: AnswerReviewItem[] = currentReviewItems.map((item) => {
        const suggestion = result.suggestions.find((s) => s.questionId === item.question.id);
        const suggestedAnswer = suggestion?.suggestedAnswer || '';
        return {
          ...item,
          suggestion,
          userEditedAnswer: suggestedAnswer,
          approved: Boolean(suggestedAnswer),
          fillStatus: 'idle',
        };
      });

      setItems(solvedItems);
      setIsGenerating(false);

      // 3. Auto-fill into the webpage!
      setBanner({
        type: 'info',
        text: `3/3 Çözüldü! Cevaplar sayfadaki alanlara otomatik işaretleniyor...`,
      });

      await fillItemsList(solvedItems);
    } catch (err) {
      setIsScanning(false);
      setIsGenerating(false);
      setBanner({
        type: 'error',
        text: `Auto-Pilot hatası: ${(err as Error).message}`,
      });
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
      const autoApprove = settings.autoApproveAll ?? true;
      const updatedItems: AnswerReviewItem[] = items.map((item) => {
        const suggestion = result.suggestions.find((s) => s.questionId === item.question.id);
        const suggestedAnswer = suggestion?.suggestedAnswer || '';
        const meetsConfidence = (suggestion?.confidence ?? 0) >= (settings.confidenceThreshold ?? 0.7);

        return {
          ...item,
          suggestion,
          userEditedAnswer: suggestedAnswer,
          approved: autoApprove ? Boolean(suggestedAnswer) : meetsConfidence && Boolean(suggestedAnswer),
          fillStatus: 'idle',
        };
      });

      setItems(updatedItems);

      // Auto-fill answers if setting is enabled
      if (settings.autoFillOnGenerate) {
        setBanner({
          type: 'info',
          text: `Generated answers! Automatically filling fields into page...`,
        });
        setTimeout(() => {
          fillItemsList(updatedItems);
        }, 150);
      } else {
        setBanner({
          type: 'success',
          text: `Generated suggestions using ${aiProvider.name} (${result.modelUsed}).`,
        });
      }
    } catch (err) {
      setBanner({
        type: 'error',
        text: `AI Generation failed: ${(err as Error).message}`,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const fillItemsList = async (itemList: AnswerReviewItem[]) => {
    const tabId = await getActiveTabId();
    if (!tabId) return;

    const approvedIndices = itemList
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

    let successCount = 0;
    let failCount = 0;

    for (const idx of approvedIndices) {
      const item = itemList[idx];

      // Mark filling
      setItems((prev) =>
        prev.map((it, i) => (i === idx ? { ...it, fillStatus: 'filling' } : it))
      );

      try {
        let response: FillApprovedAnswerResponse | null = null;

        // Try primary targeted frame first
        if (activeFrameId !== undefined) {
          try {
            response = (await chrome.tabs.sendMessage(
              tabId,
              {
                action: 'FILL_APPROVED_ANSWER',
                question: item.question,
                answer: item.userEditedAnswer,
              },
              { frameId: activeFrameId }
            )) as FillApprovedAnswerResponse;
          } catch {}
        }

        // If not successful, try top frame (frame 0)
        if (!response || !response.success) {
          try {
            response = (await chrome.tabs.sendMessage(
              tabId,
              {
                action: 'FILL_APPROVED_ANSWER',
                question: item.question,
                answer: item.userEditedAnswer,
              }
            )) as FillApprovedAnswerResponse;
          } catch {}
        }

        // Direct DOM execution fallback for iframe inputs (guaranteed fallback)
        if (!response || !response.success) {
          try {
            const execResults = await chrome.scripting.executeScript({
              target: { tabId, allFrames: true },
              func: (qIndex: number, ans: string, qName?: string) => {
                const doc = document;
                const target =
                  (qName ? doc.querySelector(`[name="${CSS.escape(qName)}"], #${CSS.escape(qName)}, [data-rcfid="${CSS.escape(qName)}"]`) : null) ||
                  doc.querySelector(`#typein${qIndex}, [name="typein${qIndex}"], [data-rcfid="typein_${qIndex}"]`) ||
                  doc.querySelectorAll('input.text, input.markedTextInput, input[name*="typein"]')[qIndex - 1];

                if (target && target instanceof HTMLInputElement) {
                  target.focus();
                  target.value = ans;
                  target.setAttribute('value', ans);
                  target.dispatchEvent(new Event('input', { bubbles: true }));
                  target.dispatchEvent(new Event('change', { bubbles: true }));
                  target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                  return true;
                }
                return false;
              },
              args: [item.question.index, item.userEditedAnswer, item.question.fields[0]?.name],
            });

            if (execResults.some((r) => r.result === true)) {
              response = { success: true, filled: true };
            }
          } catch (execErr) {
            console.warn('Script execution fallback failed:', execErr);
          }
        }

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

  const handleFillApproved = async () => {
    await fillItemsList(items);
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
      const sendOpts = activeFrameId !== undefined ? { frameId: activeFrameId } : {};
      await chrome.tabs.sendMessage(
        tabId,
        {
          action: 'HIGHLIGHT_FIELD',
          selector,
        },
        sendOpts
      );
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
        onOpenSidePanel={handleOpenSidePanel}
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
          onClear={handleClear}
          onAutoPilot={handleAutoPilot}
        />
      ) : (
        <SettingsTab settings={settings} onSaveSettings={handleSaveSettings} />
      )}
    </div>
  );
};
