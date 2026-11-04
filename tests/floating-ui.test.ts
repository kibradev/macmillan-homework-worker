import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { PortLike, mountFloatingUi } from '../src/ui/floating-ui';
import { Progress, Session } from '../src/core/autopilot';
import { UiCommand } from '../src/core/ui-commands';
import { Question } from '../src/types/question';

class FakePort implements PortLike {
  sent: UiCommand[] = [];
  disconnected = false;
  private messageListeners: Array<(m: any) => void> = [];
  private disconnectListeners: Array<() => void> = [];
  onMessage = { addListener: (l: (m: any) => void) => this.messageListeners.push(l) };
  onDisconnect = { addListener: (l: () => void) => this.disconnectListeners.push(l) };
  postMessage(m: unknown) {
    this.sent.push(m as UiCommand);
  }
  disconnect() {
    this.disconnected = true;
  }
  emit(message: unknown) {
    this.messageListeners.forEach((l) => l(message));
  }
  drop() {
    this.disconnectListeners.forEach((l) => l());
  }
}

const question = (n: number, prompt = `Question ${n}`): Question => ({
  id: `q_${n}`,
  index: n,
  type: 'dropdown',
  promptText: prompt,
  fields: [{ id: `f${n}`, selector: `#s${n}`, fieldType: 'select' }],
});

const session = (): Session => ({
  frameId: 3,
  questions: [question(1), question(2)],
  answers: { q_1: { answer: 'went' }, q_2: { answer: 'was' } },
});

function setup(options: { connectThrows?: boolean; toastMs?: number } = {}) {
  const dom = new JSDOM('<body></body>');
  const doc = dom.window.document;
  const ports: FakePort[] = [];
  const ui = mountFloatingUi({
    document: doc,
    toastMs: options.toastMs ?? 50,
    connect: () => {
      if (options.connectThrows) throw new Error('Extension context invalidated.');
      const port = new FakePort();
      ports.push(port);
      return port;
    },
  });
  const root = ui.host.shadowRoot!;
  const $ = <T extends Element = HTMLElement>(selector: string) => root.querySelector(selector) as T;
  const click = (selector: string) => ($(selector) as HTMLElement).click();
  const progress = (port: FakePort, p: Progress) => port.emit({ type: 'progress', progress: p });
  const result = (port: FakePort, s: Session | null) => port.emit({ type: 'result', session: s });
  return { dom, doc, ui, ports, $, click, progress, result, root };
}

const items = (statuses: Array<'idle' | 'filled' | 'failed'>) =>
  statuses.map((status, i) => ({
    id: `q_${i + 1}`,
    index: i + 1,
    type: 'dropdown',
    prompt: `Question ${i + 1}`,
    answer: `answer ${i + 1}`,
    status,
    error: status === 'failed' ? 'Could not match' : undefined,
  }));

test('Floating UI - mounts a closed panel and a "Quick Solve" button in a shadow root', () => {
  const { doc, ui, $ } = setup();

  assert.equal(doc.getElementById('studypilot-root'), ui.host);
  assert.equal($('.sp-fast').textContent, 'Quick Solve');
  assert.equal(($('.sp-panel') as HTMLElement).hidden, true);
  assert.equal(($('.sp-fast') as HTMLButtonElement).disabled, false);
  ui.destroy();
  assert.equal(doc.getElementById('studypilot-root'), null);
});

test('Floating UI - one click starts the auto-pilot, shows each stage, then the outcome', () => {
  const { ports, $, click, progress, result } = setup();

  click('.sp-fast');
  assert.equal(ports.length, 1);
  assert.deepEqual(ports[0].sent, [{ cmd: 'autopilot' }]);
  assert.equal(($('.sp-fast') as HTMLButtonElement).disabled, true, 'button is locked while running');

  progress(ports[0], { stage: 'scan', text: 'Scanning page…' });
  assert.equal($('.sp-fast').textContent, 'Scanning…');
  progress(ports[0], { stage: 'solve', text: 'The AI is solving…', items: items(['idle', 'idle']) });
  assert.equal($('.sp-fast').textContent, 'Solving…');
  progress(ports[0], { stage: 'fill', text: 'Filling in answers… (1/2)', items: items(['filled', 'idle']) });
  assert.equal($('.sp-fast').textContent, 'Filling…');

  progress(ports[0], {
    stage: 'done',
    text: '2/2 questions filled in.',
    items: items(['filled', 'filled']),
    summary: { total: 2, filled: 2, failed: 0 },
  });
  result(ports[0], session());

  assert.equal(($('.sp-fast') as HTMLButtonElement).disabled, false);
  assert.equal($('.sp-fast').textContent, '✓ Filled');
  const toast = $('.sp-toast');
  assert.equal(toast.hidden, false);
  assert.equal(toast.dataset.tone, 'success');
  assert.equal(toast.textContent, '2/2 questions filled in.');
  assert.equal(ports[0].disconnected, true, 'the port is released after the result');
});

test('Floating UI - the success bubble disappears by itself, an error stays until dismissed', async () => {
  const ok = setup({ toastMs: 20 });
  ok.click('.sp-fast');
  ok.progress(ok.ports[0], { stage: 'done', text: 'Tamam', items: items(['filled']), summary: { total: 1, filled: 1, failed: 0 } });
  ok.result(ok.ports[0], session());
  assert.equal(ok.$('.sp-toast').hidden, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(ok.$('.sp-toast').hidden, true);

  const bad = setup({ toastMs: 20 });
  bad.click('.sp-fast');
  bad.progress(bad.ports[0], { stage: 'error', text: 'AI error: quota exceeded' });
  bad.result(bad.ports[0], null);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(bad.$('.sp-toast').hidden, false, 'errors are not auto-dismissed');
  assert.equal(bad.$('.sp-toast').dataset.tone, 'error');
  bad.click('.sp-toast');
  assert.equal(bad.$('.sp-toast').hidden, true, 'a click dismisses it');
});

test('Floating UI - partial failures are shown per question, with the reason', () => {
  const { ports, $, click, progress, result, root } = setup();
  click('.sp-fast');
  progress(ports[0], {
    stage: 'done',
    text: '1 filled in, 1 failed.',
    items: items(['filled', 'failed']),
    summary: { total: 2, filled: 1, failed: 1 },
  });
  result(ports[0], session());
  click('.sp-toggle');

  assert.equal($('.sp-toast').hidden, true, 'the bubble yields to the open panel');
  assert.equal($('.sp-status').dataset.tone, 'warning');
  const rows = Array.from(root.querySelectorAll('.sp-item')) as HTMLElement[];
  assert.deepEqual(rows.map((r) => r.dataset.status), ['filled', 'failed']);
  assert.equal(rows[0].querySelector('.sp-mark')!.textContent, '✓');
  assert.equal(rows[1].querySelector('.sp-mark')!.textContent, '✗');
  assert.equal(rows[1].querySelector('.sp-error')!.textContent, 'Could not match');
  assert.equal($('.sp-fast').textContent, '1/2 filled');
});

test('Floating UI - "Solve" and "Fill" need scanned questions first and do not even open a connection', () => {
  const { ports, $, click } = setup();
  click('.sp-toggle');

  click('[data-act="solve"]');
  click('[data-act="fill"]');

  assert.equal(ports.length, 0);
  assert.match($('.sp-status').textContent!, /Scan for questions first/);
  assert.equal($('.sp-status').dataset.tone, 'warning');
});

test('Floating UI - answers edited in the panel are what gets filled', () => {
  const { ports, $, click, progress, result, root } = setup();
  click('.sp-toggle');

  click('[data-act="scan"]');
  assert.deepEqual(ports[0].sent, [{ cmd: 'scan' }]);
  progress(ports[0], { stage: 'scan', text: '2 questions found.', items: items(['idle', 'idle']) });
  result(ports[0], session());

  const inputs = Array.from(root.querySelectorAll('input.sp-answer')) as HTMLInputElement[];
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].disabled, false);
  inputs[0].value = 'edited answer';
  inputs[0].dispatchEvent(new (setupWindow(root).Event)('input'));

  click('[data-act="fill"]');
  assert.equal(ports.length, 2);
  const command = ports[1].sent[0] as Extract<UiCommand, { cmd: 'fill' }>;
  assert.equal(command.cmd, 'fill');
  assert.equal(command.session.frameId, 3);
  assert.equal(command.session.answers['q_1'].answer, 'edited answer');
  assert.equal(command.session.answers['q_2'].answer, 'was');
  void $;
});

function setupWindow(root: ShadowRoot) {
  return root.ownerDocument.defaultView as unknown as { Event: typeof Event };
}

test('Floating UI - question text from the page is shown as text, never as markup', () => {
  const { ports, click, progress, root } = setup();
  click('.sp-fast');
  progress(ports[0], {
    stage: 'scan',
    text: '1 questions found.',
    items: [{ id: 'q_1', index: 1, type: 'dropdown', prompt: '<img src=x onerror=alert(1)> She ____ home', answer: '<b>went</b>', status: 'idle' }],
  });

  assert.equal(root.querySelectorAll('img, b').length, 0);
  assert.equal(root.querySelector('.sp-prompt')!.textContent, '<img src=x onerror=alert(1)> She ____ home');
  assert.equal((root.querySelector('input.sp-answer') as HTMLInputElement).value, '<b>went</b>');
});

test('Floating UI - a dropped connection unlocks the button and says so', () => {
  const { ports, $, click } = setup();
  click('.sp-fast');
  assert.equal(($('.sp-fast') as HTMLButtonElement).disabled, true);

  ports[0].drop(); // the worker went away before sending a result

  assert.equal(($('.sp-fast') as HTMLButtonElement).disabled, false);
  assert.equal($('.sp-toast').dataset.tone, 'error');
  assert.match($('.sp-toast').textContent!, /Connection lost/);
});

test('Floating UI - after an extension reload it asks for a page refresh instead of failing silently', () => {
  const { $, click } = setup({ connectThrows: true });

  click('.sp-fast');

  assert.equal(($('.sp-fast') as HTMLButtonElement).disabled, false);
  assert.match($('.sp-toast').textContent!, /Reload the page \(F5\)/);
  assert.equal($('.sp-toast').dataset.tone, 'error');
});

test('Floating UI - a second click while running is ignored', () => {
  const { ports, click } = setup();
  click('.sp-fast');
  click('.sp-fast');
  click('.sp-toggle');
  click('[data-act="scan"]');
  assert.equal(ports.length, 1);
});

test('Floating UI - typing in the panel does not reach the page\'s keyboard shortcuts', () => {
  const { doc, ui, root } = setup();
  let reached = 0;
  doc.addEventListener('keydown', () => reached++);
  const input = Object.assign(doc.createElement('input'), { className: 'sp-answer' });
  root.querySelector('.sp')!.appendChild(input);

  input.dispatchEvent(new (doc.defaultView as any).KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true }));

  assert.equal(reached, 0);
  ui.destroy();
});

// ---------------------------------------------------------------------------------------------------------------
// Optional "Otomatik ilerle" (solve everything) section

const setInput = (root: ShadowRoot, label: string, value: string) => {
  const input = root.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  input.value = value;
};

test('Floating UI series - "Solve All" asks for confirmation first and sends nothing until confirmed', () => {
  const { ports, $, click, root } = setup();
  click('.sp-toggle');

  click('.sp-series-start');
  assert.equal(($('.sp-confirm') as HTMLElement).hidden, false);
  assert.match($('.sp-confirm-text').textContent!, /Will solve up to 10 activities/);
  assert.match($('.sp-confirm-text').textContent!, /waiting 5 s in between/);
  assert.match($('.sp-confirm-text').textContent!, /never presses Check\/Submit/);
  assert.equal(ports.length, 0, 'nothing is started by the first click');

  // "Cancel" backs out
  (Array.from(root.querySelectorAll('.sp-confirm .sp-btn')) as HTMLElement[]).find((b) => b.textContent === 'Cancel')!.click();
  assert.equal(($('.sp-confirm') as HTMLElement).hidden, true);
  assert.equal(ports.length, 0);
});

test('Floating UI series - confirming starts the series with the chosen limits', () => {
  const { ports, click, root } = setup();
  click('.sp-toggle');
  setInput(root, 'Max activities', '3');
  setInput(root, 'Delay (sec)', '2');

  click('.sp-series-start');
  (Array.from(root.querySelectorAll('.sp-confirm .sp-btn')) as HTMLElement[]).find((b) => b.textContent === 'Start')!.click();

  assert.equal(ports.length, 1);
  assert.deepEqual(ports[0].sent, [{ cmd: 'series', max: 3, delaySeconds: 2 }]);
});

test('Floating UI series - out-of-range limits are clamped before they are sent', () => {
  const { ports, click, root } = setup();
  click('.sp-toggle');
  setInput(root, 'Max activities', '9999');
  setInput(root, 'Delay (sec)', '0');
  click('.sp-series-start');
  (Array.from(root.querySelectorAll('.sp-confirm .sp-btn')) as HTMLElement[]).find((b) => b.textContent === 'Start')!.click();

  assert.deepEqual(ports[0].sent, [{ cmd: 'series', max: 100, delaySeconds: 5 }]);
});

test('Floating UI series - shows the activity counter, offers Stop, and Stop is sent on the same connection', () => {
  const { ports, $, click, progress, root } = setup();
  click('.sp-toggle');
  assert.equal(($('.sp-stop') as HTMLElement).hidden, true, 'no Stop button when nothing runs');

  click('.sp-series-start');
  (Array.from(root.querySelectorAll('.sp-confirm .sp-btn')) as HTMLElement[]).find((b) => b.textContent === 'Start')!.click();
  progress(ports[0], { stage: 'solve', text: 'Activity 2/10: The AI is solving…', series: { current: 2, max: 10 } });

  assert.equal($('.sp-fast').textContent, 'Activity 2/10');
  assert.equal(($('.sp-stop') as HTMLElement).hidden, false);
  assert.equal(($('.sp-series-start') as HTMLButtonElement).disabled, true, 'a second series cannot be started meanwhile');

  click('.sp-stop');
  assert.deepEqual(ports[0].sent, [{ cmd: 'series', max: 10, delaySeconds: 5 }, { cmd: 'stop' }]);
  assert.equal($('.sp-stop').textContent, 'Stopping…');
  assert.equal(($('.sp-stop') as HTMLButtonElement).disabled, true, 'Stop is pressed once');
});

test('Floating UI series - a normal end reads as success, a problem as an error, and Stop disappears either way', () => {
  const ok = setup();
  ok.click('.sp-toggle');
  ok.click('.sp-series-start');
  (Array.from(ok.root.querySelectorAll('.sp-confirm .sp-btn')) as HTMLElement[]).find((b) => b.textContent === 'Start')!.click();
  ok.progress(ok.ports[0], { stage: 'done', text: '3 activities completed. This may be the last activity.', series: { current: 3, max: 10, finished: true, completed: 3 } });
  ok.result(ok.ports[0], null);
  assert.equal(ok.$('.sp-fast').textContent, '✓ 3 activities');
  assert.equal(ok.$('.sp-status').dataset.tone, 'success');
  assert.equal((ok.$('.sp-stop') as HTMLElement).hidden, true);
  assert.equal((ok.$('.sp-fast') as HTMLButtonElement).disabled, false);

  const bad = setup();
  bad.click('.sp-toggle');
  bad.click('.sp-series-start');
  (Array.from(bad.root.querySelectorAll('.sp-confirm .sp-btn')) as HTMLElement[]).find((b) => b.textContent === 'Start')!.click();
  bad.progress(bad.ports[0], { stage: 'error', text: '1 activity completed, then stopped: Activity 2: 1 fields could not be filled.', series: { current: 1, max: 10, finished: true, completed: 1 } });
  bad.result(bad.ports[0], null);
  assert.equal(bad.$('.sp-fast').textContent, 'Stopped');
  assert.equal(bad.$('.sp-status').dataset.tone, 'error');
  assert.match(bad.$('.sp-status').textContent!, /then stopped/);
  assert.equal((bad.$('.sp-stop') as HTMLElement).hidden, true);
});

test('Floating UI series - one-click solve is unchanged and does not show the series controls as running', () => {
  const { ports, $, click } = setup();
  click('.sp-fast');
  assert.deepEqual(ports[0].sent, [{ cmd: 'autopilot' }]);
  assert.equal(($('.sp-stop') as HTMLElement).hidden, true);
});
