import test from 'node:test';
import assert from 'node:assert/strict';
import { Progress } from '../src/core/autopilot';
import { SeriesControl, SeriesDeps, SeriesResult, runSeries } from '../src/core/series';
import { UiMessage, handleUiCommand } from '../src/core/ui-commands';
import { UserSettings } from '../src/storage/settings';
import { Question } from '../src/types/question';

const settings: UserSettings = {
  selectedProvider: 'gemini',
  apiKeys: { gemini: 'key', openai: '', anthropic: '' },
  selectedModels: { gemini: 'm', openai: '', anthropic: '' },
  saveKeyToSessionOnly: false,
  theme: 'light',
  confidenceThreshold: 0.7,
  autoFillOnGenerate: true,
  autoApproveAll: true,
  nextButtonSelector: '',
};

const question = (n: number): Question => ({
  id: 'q_1',
  index: 1,
  type: 'dropdown',
  promptText: `Activity ${n}: She ____ home.`,
  options: [{ id: 'o1', label: 'went', value: 'went' }],
  fields: [{ id: 'f1', selector: '#s1', fieldType: 'select' }],
});

interface World {
  deps: SeriesDeps;
  log: string[];
  shown: () => number;
}

/** A course of `activities` pages. Next moves to the following one, unless `stuckAfter` says it does nothing. */
function world(
  activities: number,
  options: {
    failFillOn?: number;
    emptyAnswerOn?: number;
    stuckAfter?: number;
    unreadableFrom?: number;
    onFill?: (activity: number) => void;
  } = {}
): World {
  let shown = 0;
  const log: string[] = [];
  const deps: SeriesDeps = {
    loadSettings: async () => settings,
    getProvider: () =>
      ({
        generateAnswers: async (questions: Question[]) => {
          log.push(`ai ${shown}`);
          return {
            modelUsed: 'm',
            providerId: 'gemini',
            suggestions: questions.map((q) => ({
              questionId: q.id,
              suggestedAnswer: shown === options.emptyAnswerOn ? '' : 'went',
              confidence: 1,
              explanation: 'x',
            })),
          };
        },
      }) as any,
    scanFrames: async () =>
      shown < activities && !(options.unreadableFrom !== undefined && shown >= options.unreadableFrom)
        ? { frameId: 7, questions: [question(shown)] }
        : null,
    describeEmpty: async () => 'Sayfada şunlar var: sortable (desteklenmiyor).',
    fill: async () => {
      log.push(`fill ${shown}`);
      options.onFill?.(shown);
      return shown === options.failFillOn ? { success: false, error: 'Could not match' } : { success: true };
    },
    activityId: async () => (shown < activities ? `activity-${shown}` : null),
    clickNext: async () => {
      if (shown + 1 >= activities) return { clicked: false, reason: 'Next düğmesi bulunamadı.' };
      log.push('next');
      if (options.stuckAfter === undefined || shown < options.stuckAfter) shown++;
      return { clicked: true };
    },
    wait: async () => {},
    random: () => 0,
  };
  return { deps, log, shown: () => shown };
}

const run = async (w: World, max: number, control: SeriesControl = { stopped: false }) => {
  const events: Progress[] = [];
  const result: SeriesResult = await runSeries(w.deps, 1, { max, delaySeconds: 1 }, (p) => events.push(p), control);
  return { result, events, last: events[events.length - 1] };
};

test('Series - solves every activity, presses Next between them, and ends normally on the last one', async () => {
  const w = world(3);
  const { result, last } = await run(w, 10);

  assert.deepEqual(w.log, ['ai 0', 'fill 0', 'next', 'ai 1', 'fill 1', 'next', 'ai 2', 'fill 2']);
  assert.deepEqual(result, { completed: 3, ok: true, reason: 'Sonraki etkinliğe geçilemedi: Next düğmesi bulunamadı. Son etkinlik olabilir.' });
  assert.equal(last.stage, 'done');
  assert.deepEqual(last.series, { current: 3, max: 10, finished: true, completed: 3 });
  assert.match(last.text, /^3 etkinlik tamamlandı\./);
});

test('Series - stops at the limit and does not press Next once more', async () => {
  const w = world(5);
  const { result } = await run(w, 2);

  assert.equal(result.completed, 2);
  assert.equal(result.ok, true);
  assert.match(result.reason, /Üst sınıra \(2 etkinlik\) ulaşıldı/);
  assert.equal(w.log.filter((l) => l === 'next').length, 1, 'Next only between the two activities');
  assert.equal(w.shown(), 1);
});

test('Series - a field that could not be filled stops the run before Next', async () => {
  const w = world(3, { failFillOn: 1 });
  const { result, last } = await run(w, 10);

  assert.equal(result.completed, 1);
  assert.equal(result.ok, false);
  assert.equal(last.stage, 'error');
  assert.match(last.text, /1 etkinlik tamamlandı, sonra durdu: Etkinlik 2: 1 alan işaretlenemedi/);
  assert.match(last.text, /Hatalı bir etkinlikten sonra ilerlenmez/);
  assert.equal(w.log.filter((l) => l === 'next').length, 1, 'no Next after the failed activity');
});

test('Series - an unanswered question stops the run too', async () => {
  const w = world(2, { emptyAnswerOn: 0 });
  const { result, last } = await run(w, 10);

  assert.equal(result.completed, 0);
  assert.equal(result.ok, false);
  assert.match(last.text, /1 soru cevapsız kaldı/);
  assert.equal(w.log.includes('next'), false);
});

test('Series - Stop ends the run after the activity in progress, without pressing Next', async () => {
  const control: SeriesControl = { stopped: false };
  const w = world(5, { onFill: (activity) => activity === 1 && (control.stopped = true) });
  const { result, last } = await run(w, 10, control);

  assert.equal(result.completed, 2, 'the activity in progress is finished');
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'Durduruldu.');
  assert.equal(last.stage, 'done');
  assert.equal(w.log.filter((l) => l === 'next').length, 1, 'no Next after Stop');
});

test('Series - a Next that leaves the page unchanged is reported (answers may need an extra step)', async () => {
  const w = world(3, { stuckAfter: 0 });
  const { result, last } = await run(w, 10);

  assert.equal(result.ok, false);
  assert.equal(result.completed, 1);
  assert.match(last.text, /Next'e basıldı ama sayfa değişmedi/);
  assert.match(last.text, /Check\/Submit/);
});

test('Series - an activity that cannot be read says what the page contains, after a few retries', async () => {
  const w = world(3, { unreadableFrom: 1 });
  let scans = 0;
  const original = w.deps.scanFrames;
  w.deps.scanFrames = async (tab) => {
    scans++;
    return original(tab);
  };
  const { result, last } = await run(w, 10);

  assert.equal(result.ok, false);
  assert.equal(result.completed, 1);
  assert.match(last.text, /Çözülecek soru bulunamadı\. Sayfada şunlar var: sortable \(desteklenmiyor\)/);
  assert.equal(scans, 1 + 3, 'first activity once, the unreadable one three times');
});

test('Series - progress is labelled per activity and only the end is reported as done or error', async () => {
  const w = world(2);
  const { events } = await run(w, 5);

  const labelled = events.filter((e) => e.series && !e.series.finished);
  assert.ok(labelled.length > 0);
  assert.ok(labelled.some((e) => e.text.startsWith('Etkinlik 2/5: ')));
  assert.ok(labelled.every((e) => e.stage !== 'done' && e.stage !== 'error'), 'single-activity "done" must not look like the end of the series');
  assert.equal(events.filter((e) => e.stage === 'done' || e.stage === 'error').length, 1);
});

test('Panel commands - series is clamped, and stop flips the shared flag without sending a result', async () => {
  const w = world(1);
  const messages: UiMessage[] = [];
  const control: SeriesControl = { stopped: false };

  await handleUiCommand(w.deps, 1, { cmd: 'series', max: 5000, delaySeconds: 0 }, (m) => messages.push(m), control);
  const final = messages.map((m) => (m.type === 'progress' ? m.progress : null)).filter(Boolean).pop()!;
  assert.equal(final.series?.max, 100, 'the maximum is capped');
  assert.deepEqual(messages[messages.length - 1], { type: 'result', session: null });

  const before = messages.length;
  await handleUiCommand(w.deps, 1, { cmd: 'stop' }, (m) => messages.push(m), control);
  assert.equal(control.stopped, true);
  assert.equal(messages.length, before, 'stop is not answered with a message');
});
