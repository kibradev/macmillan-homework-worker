import { PipelineDeps, Progress, Session, fillStep, runAutoPilot, scanStep, solveStep } from './autopilot';

/** Messages the in-page panel sends to the background over a port. */
export type UiCommand =
  | { cmd: 'autopilot' }
  | { cmd: 'scan' }
  | { cmd: 'solve'; session: Session }
  | { cmd: 'fill'; session: Session };

/** Messages the background sends back: any number of progress updates, then exactly one result. */
export type UiMessage =
  | { type: 'progress'; progress: Progress }
  | { type: 'result'; session: Session | null };

/** Runs one panel command and streams its progress. The session travels with the panel, so the worker stays stateless. */
export async function handleUiCommand(
  deps: PipelineDeps,
  tabId: number,
  command: UiCommand,
  send: (message: UiMessage) => void
): Promise<void> {
  const report = (progress: Progress) => send({ type: 'progress', progress });

  try {
    switch (command.cmd) {
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

