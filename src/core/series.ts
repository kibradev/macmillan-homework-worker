import { PipelineDeps, Progress, Report, fillStep, scanStep, solveStep } from './autopilot';

/**
 * "Solve everything": solve an activity, press Next, wait for the next activity, repeat.
 * An optional mode, separate from the one-click solve. It stops on the first problem instead of pressing on blindly,
 * and it only ever presses Next (the safety check inside the page refuses submit/check/finish/grade buttons).
 */

export interface SeriesDeps extends PipelineDeps {
  /** Identifies the activity on screen (so a change after "Next" can be detected); null when none is found. */
  activityId(tabId: number): Promise<string | null>;
  clickNext(tabId: number): Promise<{ clicked: boolean; reason?: string }>;
  wait(ms: number): Promise<void>;
  random?(): number;
}

export interface SeriesOptions {
  /** Hard upper bound of activities in one run. */
  max: number;
  /** Pause between activities, in seconds (a little random jitter is added). */
  delaySeconds: number;
}

/** Set `stopped` from outside (the Stop button) to end the run after the activity in progress. */
export interface SeriesControl {
  stopped: boolean;
}

export interface SeriesResult {
  completed: number;
  /** true when the run ended normally (last activity, limit, stopped by the learner); false when a problem ended it */
  ok: boolean;
  reason: string;
}

const NEXT_PAGE_TIMEOUT_MS = 15000;
const POLL_MS = 400;
const SCAN_RETRIES = 3;

export async function runSeries(
  deps: SeriesDeps,
  tabId: number,
  options: SeriesOptions,
  report: Report,
  control: SeriesControl
): Promise<SeriesResult> {
  const max = Math.max(1, Math.floor(options.max));
  const random = deps.random ?? Math.random;
  let completed = 0;

  const finish = (ok: boolean, reason: string): SeriesResult => {
    const lead = completed === 1 ? '1 activity completed' : `${completed} activities completed`;
    report({
      stage: ok ? 'done' : 'error',
      text: ok ? `${lead}. ${reason}` : `${lead}, then stopped: ${reason}`,
      series: { current: completed, max, finished: true, completed },
    });
    return { completed, ok, reason };
  };

  /** Waits in short slices so the Stop button reacts quickly. */
  const pause = async (ms: number) => {
    for (let waited = 0; waited < ms && !control.stopped; waited += 250) await deps.wait(Math.min(250, ms - waited));
  };

  for (let n = 1; n <= max; n++) {
    if (control.stopped) return finish(true, 'Stopped.');

    // Progress of the single-activity steps, relabelled for the series. Their errors are collected, not shown:
    // the series reports one final message.
    let lastError = '';
    const scoped: Report = (p: Progress) => {
      if (p.stage === 'error') {
        lastError = p.text;
        return;
      }
      report({ ...p, stage: p.stage === 'done' ? 'fill' : p.stage, text: `Activity ${n}/${max}: ${p.text}`, series: { current: n, max } });
    };

    const before = await deps.activityId(tabId);

    // A freshly loaded activity may need a moment before its questions can be read
    let session = await scanStep(deps, tabId, scoped);
    for (let attempt = 1; !session && attempt < SCAN_RETRIES && !control.stopped; attempt++) {
      await deps.wait(1500);
      lastError = '';
      session = await scanStep(deps, tabId, scoped);
    }
    if (!session) return finish(false, lastError || 'No questions to solve were found.');

    if (!(await solveStep(deps, session, scoped))) return finish(false, lastError || 'The questions could not be solved.');

    const { filled, failed } = await fillStep(deps, tabId, session, scoped);
    if (failed > 0 || filled < session.questions.length) {
      const unanswered = session.questions.length - filled - failed;
      const parts = [failed ? `${failed} fields could not be filled` : '', unanswered > 0 ? `${unanswered} questions left unanswered` : ''].filter(Boolean);
      return finish(false, `Activity ${n}: ${parts.join(', ')}. It does not move on after a faulty activity.`);
    }
    completed++;

    if (control.stopped) return finish(true, 'Stopped.');
    if (n >= max) return finish(true, `Reached the limit (${max} activities).`);

    report({
      stage: 'fill',
      text: `Activity ${n}/${max} done. Moving on to the next one…`,
      series: { current: n, max },
    });
    const next = await deps.clickNext(tabId);
    if (!next.clicked) {
      return finish(true, `Could not move on to the next activity: ${(next.reason ?? 'Next button not found').replace(/\.$/, '')}. This may be the last activity.`);
    }

    // Wait until the page really shows another activity
    let changed = false;
    for (let waited = 0; waited < NEXT_PAGE_TIMEOUT_MS && !control.stopped; waited += POLL_MS) {
      await deps.wait(POLL_MS);
      const now = await deps.activityId(tabId);
      if (now && now !== before) {
        changed = true;
        break;
      }
    }
    if (control.stopped) return finish(true, 'Stopped.');
    if (!changed) {
      return finish(false, 'Next was pressed but the page did not change. Saving the answers may need an extra step (Check/Submit).');
    }

    await pause(options.delaySeconds * 1000 * (1 + 0.3 * random()));
  }

  return finish(true, `Reached the limit (${max} activities).`);
}
