import { Question } from '../types/question';
import { AIProvider } from '../types/ai';
import { UserSettings, getActiveProviderConfig } from '../storage/settings';

/**
 * The scan -> solve -> fill pipeline behind the in-page "fast solve" button.
 * It runs in the background service worker (the only place where AI requests and cross-frame messaging are allowed),
 * and talks to the world only through `PipelineDeps`, so it can be tested without Chrome.
 */

export interface PipelineDeps {
  loadSettings(): Promise<UserSettings>;
  getProvider(id: UserSettings['selectedProvider']): AIProvider;
  /** Finds the frame that holds the activity and extracts its questions. */
  scanFrames(tabId: number): Promise<{ frameId: number; questions: Question[] } | null>;
  /** Explains why a scan found nothing (which widgets exist, which are unsupported). */
  describeEmpty(tabId: number): Promise<string>;
  fill(tabId: number, frameId: number, question: Question, answer: string): Promise<{ success: boolean; error?: string }>;
}

export interface SolvedAnswer {
  answer: string;
  explanation?: string;
  confidence?: number;
}

export interface Session {
  frameId: number;
  questions: Question[];
  answers: Record<string, SolvedAnswer>;
}

export type ItemStatus = 'idle' | 'filled' | 'failed';

export interface ItemView {
  id: string;
  index: number;
  type: string;
  prompt: string;
  answer: string;
  explanation?: string;
  confidence?: number;
  status: ItemStatus;
  error?: string;
}

export type Stage = 'scan' | 'solve' | 'fill' | 'done' | 'error';

export interface Progress {
  stage: Stage;
  text: string;
  items?: ItemView[];
  summary?: { total: number; filled: number; failed: number };
}

export type Report = (progress: Progress) => void;

const PROMPT_PREVIEW = 160;

/** Short, learner-facing version of a prompt: the instruction aimed at the AI becomes a small "▸ boşluk N" marker. */
export function previewPrompt(promptText: string): string {
  const text = promptText.replace(/\s*\(Answer ONLY for \[BLANK (\d+)\]\)$/, '  ▸ boşluk $1');
  return text.length > PROMPT_PREVIEW ? `${text.slice(0, PROMPT_PREVIEW)}…` : text;
}

export function toItems(session: Session, statuses: Record<string, { status: ItemStatus; error?: string }> = {}): ItemView[] {
  return session.questions.map((q) => {
    const solved = session.answers[q.id];
    return {
      id: q.id,
      index: q.index,
      type: q.type,
      prompt: previewPrompt(q.promptText),
      answer: solved?.answer ?? '',
      explanation: solved?.explanation,
      confidence: solved?.confidence,
      status: statuses[q.id]?.status ?? 'idle',
      error: statuses[q.id]?.error,
    };
  });
}

/** Step 1: find the activity and its questions. Returns null (after reporting why) when there is nothing to solve. */
export async function scanStep(deps: PipelineDeps, tabId: number, report: Report): Promise<Session | null> {
  report({ stage: 'scan', text: 'Sayfa taranıyor…' });
  const scan = await deps.scanFrames(tabId);
  if (!scan || scan.questions.length === 0) {
    const why = await deps.describeEmpty(tabId).catch(() => '');
    report({ stage: 'error', text: `Çözülecek soru bulunamadı. ${why}`.trim() });
    return null;
  }
  const session: Session = { frameId: scan.frameId, questions: scan.questions, answers: {} };
  report({
    stage: 'scan',
    text: `${scan.questions.length} soru bulundu.`,
    items: toItems(session),
  });
  return session;
}

/** Step 2: ask the AI. Fills `session.answers`; reports an error (and returns false) when it cannot. */
export async function solveStep(deps: PipelineDeps, session: Session, report: Report): Promise<boolean> {
  const settings = await deps.loadSettings();
  const config = getActiveProviderConfig(settings);
  if (!config.apiKey.trim()) {
    report({
      stage: 'error',
      text: `${settings.selectedProvider} API anahtarı yok. Tarayıcı çubuğundaki StudyPilot simgesinden Ayarlar'a girip anahtarı ekle.`,
    });
    return false;
  }

  report({ stage: 'solve', text: `Yapay zeka ${session.questions.length} soruyu çözüyor…`, items: toItems(session) });
  try {
    const result = await deps.getProvider(config.providerId).generateAnswers(session.questions, config.apiKey, config.modelId);
    session.answers = {};
    for (const suggestion of result.suggestions) {
      session.answers[suggestion.questionId] = {
        answer: suggestion.suggestedAnswer,
        explanation: suggestion.explanation,
        confidence: suggestion.confidence,
      };
    }
  } catch (err) {
    report({ stage: 'error', text: `Yapay zeka hatası: ${(err as Error).message}`, items: toItems(session) });
    return false;
  }

  const answered = session.questions.filter((q) => session.answers[q.id]?.answer).length;
  report({ stage: 'solve', text: `${answered}/${session.questions.length} soru cevaplandı.`, items: toItems(session) });
  return true;
}

/** Step 3: put the answers on the page, one question at a time, reporting after each. */
export async function fillStep(deps: PipelineDeps, tabId: number, session: Session, report: Report): Promise<{ filled: number; failed: number }> {
  const statuses: Record<string, { status: ItemStatus; error?: string }> = {};
  const targets = session.questions.filter((q) => session.answers[q.id]?.answer?.trim());
  let filled = 0;
  let failed = 0;

  for (const [position, question] of targets.entries()) {
    report({
      stage: 'fill',
      text: `Cevaplar işaretleniyor… (${position + 1}/${targets.length})`,
      items: toItems(session, statuses),
    });

    const answer = session.answers[question.id].answer;
    let result = await deps.fill(tabId, session.frameId, question, answer).catch((err) => ({ success: false, error: String(err) }));
    if (!result.success && session.frameId !== 0) {
      // The top frame can reach same-origin iframes as well
      result = await deps.fill(tabId, 0, question, answer).catch((err) => ({ success: false, error: String(err) }));
    }

    if (result.success) {
      filled++;
      statuses[question.id] = { status: 'filled' };
    } else {
      failed++;
      statuses[question.id] = { status: 'failed', error: result.error || 'Alan eşleştirilemedi.' };
    }
  }

  const skipped = session.questions.length - targets.length;
  report({
    stage: 'done',
    text:
      failed === 0 && skipped === 0
        ? `${filled}/${session.questions.length} soru işaretlendi.`
        : `${filled} soru işaretlendi${failed ? `, ${failed} hata` : ''}${skipped ? `, ${skipped} soru cevapsız` : ''}.`,
    items: toItems(session, statuses),
    summary: { total: session.questions.length, filled, failed },
  });
  return { filled, failed };
}

/** The one-click flow: scan, solve, fill. Always scans the page that is open right now. */
export async function runAutoPilot(deps: PipelineDeps, tabId: number, report: Report): Promise<Session | null> {
  const session = await scanStep(deps, tabId, report);
  if (!session) return null;
  if (!(await solveStep(deps, session, report))) return session;
  await fillStep(deps, tabId, session, report);
  return session;
}
