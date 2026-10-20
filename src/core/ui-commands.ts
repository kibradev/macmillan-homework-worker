import { Progress, Session, fillStep, runAutoPilot, scanStep, solveStep } from './autopilot';
import { SeriesControl, SeriesDeps, runSeries } from './series';

/** Messages the in-page panel sends to the background over a port. */
export type UiCommand =
  | { cmd: 'autopilot' }
  | { cmd: 'scan' }
  | { cmd: 'solve'; session: Session }
  | { cmd: 'fill'; session: Session }
  | { cmd: 'series'; max: number; delaySeconds: number }
  | { cmd: 'stop' };

/** Messages the background sends back: any number of progress updates, then exactly one result. */
export type UiMessage =
  | { type: 'progress'; progress: Progress }
  | { type: 'result'; session: Session | null };

/** Runs one panel command and streams its progress. The session travels with the panel, so the worker stays stateless. */
export async function handleUiCommand(
  deps: SeriesDeps,
  tabId: number,
  command: UiCommand,
  send: (message: UiMessage) => void,
  control: SeriesControl = { stopped: false }
): Promise<void> {
  const report = (progress: Progress) => send({ type: 'progress', progress });

  try {
    switch (command.cmd) {
      case 'stop': {
        control.stopped = true;
        return;
      }
      case 'series': {
        const max = Math.min(100, Math.max(1, Math.floor(Number(command.max) || 1)));
        const delaySeconds = Math.min(120, Math.max(1, Number(command.delaySeconds) || 5));
        control.stopped = false;
        await runSeries(deps, tabId, { max, delaySeconds }, report, control);
        send({ type: 'result', session: null });
        return;
      }
      case 'autopilot': {
        send({ type: 'result', session: await runAutoPilot(deps, tabId, report) });
        return;
      }
      case 'scan': {
        send({ type: 'result', session: await scanStep(deps, tabId, report) });
        return;
      }
      case 'solve': {
        await solveStep(deps, command.session, report);
        send({ type: 'result', session: command.session });
        return;
      }
      case 'fill': {
        if (!command.session.questions.length) {
          report({ stage: 'error', text: 'Önce soruları tara.' });
        } else {
          await fillStep(deps, tabId, command.session, report);
        }
        send({ type: 'result', session: command.session });
        return;
      }
    }
  } catch (err) {
    report({ stage: 'error', text: `Beklenmeyen hata: ${(err as Error).message}` });
    send({ type: 'result', session: 'session' in command ? command.session : null });
  }
}

