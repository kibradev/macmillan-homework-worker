import test from 'node:test';
import assert from 'node:assert/strict';
import { PipelineDeps, Progress, previewPrompt, runAutoPilot } from '../src/core/autopilot';
import { UiMessage, handleUiCommand } from '../src/core/ui-commands';
import { UserSettings } from '../src/storage/settings';
import { Question } from '../src/types/question';

const settings = (apiKey = 'key'): UserSettings => ({
  selectedProvider: 'gemini',
  apiKeys: { gemini: apiKey, openai: '', anthropic: '' },
  selectedModels: { gemini: 'gemini-2.5-flash-lite', openai: '', anthropic: '' },
  saveKeyToSessionOnly: false,
  theme: 'light',
  confidenceThreshold: 0.7,
  autoFillOnGenerate: true,
  autoApproveAll: true,
});

const question = (n: number): Question => ({
  id: `q_${n}`,
  index: n,
  type: 'dropdown',
  promptText: `Question ${n}: She ____ home.`,
  options: [{ id: 'o1', label: 'went', value: 'went' }],
  fields: [{ id: `f${n}`, selector: `#s${n}`, fieldType: 'select' }],
});

interface Calls {
  ai: number;
  fills: Array<{ frameId: number; id: string; answer: string }>;
}

function makeDeps(overrides: Partial<PipelineDeps> = {}, calls: Calls = { ai: 0, fills: [] }): { deps: PipelineDeps; calls: Calls } {
  const deps: PipelineDeps = {
    loadSettings: async () => settings(),
    getProvider: () =>
      ({
        id: 'gemini',
        name: 'fake',
        getAvailableModels: () => [],
        getDefaultModelId: () => 'm',
        testConnection: async () => ({ success: true, message: 'ok' }),
        generateAnswers: async (questions: Question[]) => {
          calls.ai++;
          return {
            modelUsed: 'm',
            providerId: 'gemini',
            suggestions: questions.map((q) => ({ questionId: q.id, suggestedAnswer: `answer ${q.index}`, confidence: 0.9, explanation: `because ${q.index}` })),
          };
        },
      }) as any,
    scanFrames: async () => ({ frameId: 7, questions: [question(1), question(2)] }),
    describeEmpty: async () => 'The page contains: sortable (unsupported).',
    fill: async (_tab, frameId, q, answer) => {
      calls.fills.push({ frameId, id: q.id, answer });
      return { success: true };
    },
    ...overrides,
  };
  return { deps, calls };
}

const collect = () => {
  const events: Progress[] = [];
  return { events, report: (p: Progress) => events.push(p) };
};

test('Auto-Pilot - scans, solves and fills every question, reporting each stage', async () => {
  const { deps, calls } = makeDeps();
  const { events, report } = collect();

  const session = await runAutoPilot(deps, 1, report);

  assert.equal(calls.ai, 1);
  assert.deepEqual(calls.fills.map((f) => [f.frameId, f.id, f.answer]), [
    [7, 'q_1', 'answer 1'],
    [7, 'q_2', 'answer 2'],
  ]);
  assert.deepEqual(
    [...new Set(events.map((e) => e.stage))],
    ['scan', 'solve', 'fill', 'done']
  );
  const last = events[events.length - 1];
  assert.deepEqual(last.summary, { total: 2, filled: 2, failed: 0 });
  assert.equal(last.text, '2/2 questions filled in.');
  assert.ok(last.items!.every((i) => i.status === 'filled'));
  assert.equal(session?.answers['q_1'].explanation, 'because 1');
});

test('Auto-Pilot - a failed fill in the activity frame is retried in the top frame', async () => {
  const attempts: number[] = [];
  const { deps } = makeDeps({
    fill: async (_tab, frameId) => {
      attempts.push(frameId);
      return frameId === 0 ? { success: true } : { success: false, error: 'no element' };
    },
  });
  const { events, report } = collect();

  await runAutoPilot(deps, 1, report);

  assert.deepEqual(attempts, [7, 0, 7, 0]);
  assert.deepEqual(events[events.length - 1].summary, { total: 2, filled: 2, failed: 0 });
});

test('Auto-Pilot - failures are counted and carry their reason', async () => {
  const { deps } = makeDeps({
    fill: async (_tab, _frame, q) => (q.id === 'q_2' ? { success: false, error: 'Could not match' } : { success: true }),
  });
  const { events, report } = collect();

  await runAutoPilot(deps, 1, report);

  const last = events[events.length - 1];
  assert.deepEqual(last.summary, { total: 2, filled: 1, failed: 1 });
  assert.match(last.text, /1 filled in, 1 failed/);
  assert.equal(last.items![1].status, 'failed');
  assert.equal(last.items![1].error, 'Could not match');
});

test('Auto-Pilot - without an API key it explains what to do and never calls the AI', async () => {
  const { deps, calls } = makeDeps({ loadSettings: async () => settings('') });
  const { events, report } = collect();

  await runAutoPilot(deps, 1, report);

  assert.equal(calls.ai, 0);
  assert.deepEqual(calls.fills, []);
  const last = events[events.length - 1];
  assert.equal(last.stage, 'error');
  assert.match(last.text, /API key is missing/);
});

test('Auto-Pilot - a page without questions says what it does contain', async () => {
  const { deps, calls } = makeDeps({ scanFrames: async () => null });
  const { events, report } = collect();

  const session = await runAutoPilot(deps, 1, report);

  assert.equal(session, null);
  assert.equal(calls.ai, 0);
  assert.match(events[events.length - 1].text, /No questions to solve were found\. The page contains: sortable \(unsupported\)\./);
});

test('Auto-Pilot - an AI failure becomes an error message, not an exception', async () => {
  const { deps, calls } = makeDeps({
    getProvider: () =>
      ({
        generateAnswers: async () => {
          throw new Error('quota exceeded');
        },
      }) as any,
  });
  const { events, report } = collect();

  await runAutoPilot(deps, 1, report);

  assert.deepEqual(calls.fills, []);
  const last = events[events.length - 1];
  assert.equal(last.stage, 'error');
  assert.match(last.text, /AI error: quota exceeded/);
});

test('Panel commands - fill uses the answers as edited in the panel and skips unanswered questions', async () => {
  const { deps, calls } = makeDeps();
  const messages: UiMessage[] = [];
  const session = {
    frameId: 7,
    questions: [question(1), question(2), question(3)],
    answers: {
      q_1: { answer: 'edited by the learner' },
      q_2: { answer: '   ' }, // blank: must not be sent
    },
  };

  await handleUiCommand(deps, 1, { cmd: 'fill', session }, (m) => messages.push(m));

  assert.deepEqual(calls.fills.map((f) => [f.id, f.answer]), [['q_1', 'edited by the learner']]);
  const done = messages.filter((m) => m.type === 'progress').map((m) => (m as any).progress as Progress).pop()!;
  assert.match(done.text, /1 filled in, 2 unanswered/);
  // Exactly one result closes the exchange
  assert.equal(messages.filter((m) => m.type === 'result').length, 1);
  assert.equal(messages[messages.length - 1].type, 'result');
});

test('Panel commands - an unexpected exception still ends with a result message', async () => {
  const { deps } = makeDeps({
    scanFrames: async () => {
      throw new Error('frame vanished');
    },
  });
  const messages: UiMessage[] = [];

  await handleUiCommand(deps, 1, { cmd: 'scan' }, (m) => messages.push(m));

  const error = messages.map((m) => (m as any).progress as Progress | undefined).find((p) => p?.stage === 'error');
  assert.match(error?.text ?? '', /Unexpected error: frame vanished/);
  assert.deepEqual(messages[messages.length - 1], { type: 'result', session: null });
});

test('Panel preview - the instruction meant for the AI becomes a small marker for the learner', () => {
  assert.equal(
    previewPrompt("I've [BLANK 3] the data. We need to [BLANK 4]. (Answer ONLY for [BLANK 4])"),
    "I've [BLANK 3] the data. We need to [BLANK 4].  ▸ blank 4"
  );
  assert.equal(previewPrompt('She [_____] home.'), 'She [_____] home.');
  const long = previewPrompt('x'.repeat(500));
  assert.equal(long.length, 161);
  assert.ok(long.endsWith('…'));
});
