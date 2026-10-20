import { ItemView, Progress, Session } from '../core/autopilot';
import { UiCommand, UiMessage } from '../core/ui-commands';
import { MACMILLAN_THEME_CSS } from './macmillan-theme';

/** The slice of chrome.runtime.Port the panel needs (so tests can drive it without a browser). */
export interface PortLike {
  postMessage(message: unknown): void;
  onMessage: { addListener(listener: (message: any) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
  disconnect(): void;
}

export interface FloatingUiOptions {
  connect: () => PortLike;
  document?: Document;
  /** How long a success message stays visible (ms). Errors stay until dismissed or replaced. */
  toastMs?: number;
}

export interface FloatingUi {
  host: HTMLElement;
  destroy(): void;
}

type Tone = 'idle' | 'busy' | 'success' | 'warning' | 'error';

const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(doc: Document, path: string, filled: boolean): SVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'sp-icon');
  svg.setAttribute('aria-hidden', 'true');
  const p = doc.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', path);
  if (filled) {
    p.setAttribute('fill', 'currentColor');
  } else {
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2.5');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
  }
  svg.appendChild(p);
  return svg;
}

const BOLT = 'M13 2 3 14h7l-1 8 10-12h-7l1-8z';
const CHEVRON = 'm6 15 6-6 6 6';

const STAGE_LABEL: Record<string, string> = {
  scan: 'Taranıyor…',
  solve: 'Çözülüyor…',
  fill: 'İşaretleniyor…',
};

export function mountFloatingUi(options: FloatingUiOptions): FloatingUi {
  const doc = options.document ?? document;
  const toastMs = options.toastMs ?? 6000;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // ---- state ----
  let session: Session | null = null;
  let items: ItemView[] = [];
  let busy = false;
  let open = false;
  let status: { text: string; tone: Tone } = { text: 'Hazır. "Hızlı Çöz" sayfayı tarar, çözer ve işaretler.', tone: 'idle' };
  let fastLabel: string | null = null;
  let labelTimer: ReturnType<typeof setTimeout> | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let toastVisible = false;

  // ---- DOM ----
  const host = doc.createElement('div');
  host.id = 'studypilot-root';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = el('style');
  style.textContent = MACMILLAN_THEME_CSS;

  const root = el('div', 'sp');
  const toast = el('div', 'sp-toast');
  toast.hidden = true;
  toast.setAttribute('role', 'status');
  toast.title = 'Kapatmak için tıkla';

  const panel = el('section', 'sp-panel');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'StudyPilot');

  const head = el('header', 'sp-head');
  head.appendChild(el('span', undefined, 'StudyPilot'));
  const closeBtn = el('button', 'sp-close', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Paneli kapat');
  head.appendChild(closeBtn);

  const statusBar = el('div', 'sp-status');
  statusBar.setAttribute('role', 'status');
  statusBar.setAttribute('aria-live', 'polite');
  const spinner = el('span', 'sp-spinner');
  spinner.hidden = true;
  const statusText = el('span');
  statusBar.append(spinner, statusText);

  const list = el('ol', 'sp-list');

  const actions = el('div', 'sp-actions');
  const actionButtons: Record<string, HTMLButtonElement> = {};
  for (const [act, label] of [['scan', 'Tara'], ['solve', 'Çöz'], ['fill', 'İşaretle']] as const) {
    const b = el('button', 'sp-btn', label);
    b.type = 'button';
    b.dataset.act = act;
    actionButtons[act] = b;
    actions.appendChild(b);
  }
  panel.append(head, statusBar, list, actions);

  const dock = el('div', 'sp-dock');
  const fast = el('button', 'sp-fast');
  fast.type = 'button';
  fast.setAttribute('aria-label', 'Sayfayı tara, çöz ve işaretle');
  const fastText = el('span');
  fast.append(icon(doc, BOLT, true), fastText);
  const toggle = el('button', 'sp-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Paneli aç veya kapat');
  toggle.appendChild(icon(doc, CHEVRON, false));
  dock.append(fast, toggle);

  root.append(toast, panel, dock);
  shadow.append(style, root);

  // ---- rendering ----
  function renderList() {
    list.textContent = '';
    if (items.length === 0) {
      list.appendChild(el('li', 'sp-empty', 'Henüz soru yok. "Tara" ile sayfadaki soruları bul.'));
      return;
    }
    for (const item of items) {
      const li = el('li', 'sp-item');
      li.dataset.status = item.status;
      li.dataset.id = item.id;
      li.appendChild(el('span', 'sp-num', String(item.index)));

      const body = el('div');
      body.appendChild(el('p', 'sp-prompt', item.prompt));
      const input = el('input', 'sp-answer');
      input.type = 'text';
      input.value = item.answer;
      input.placeholder = 'Cevap yok';
      input.disabled = busy;
      input.setAttribute('aria-label', `${item.index}. sorunun cevabı`);
      input.addEventListener('input', () => {
        item.answer = input.value;
        if (session) session.answers[item.id] = { ...session.answers[item.id], answer: input.value };
      });
      body.appendChild(input);
      if (item.explanation && item.status !== 'failed') body.appendChild(el('p', 'sp-why', item.explanation));
      if (item.status === 'failed') body.appendChild(el('p', 'sp-error', item.error || 'Alan eşleştirilemedi.'));
      li.appendChild(body);

      const mark = el('span', 'sp-mark', item.status === 'filled' ? '✓' : item.status === 'failed' ? '✗' : '');
      li.appendChild(mark);
      list.appendChild(li);
    }
  }

  function renderChrome() {
    root.dataset.open = String(open);
    root.dataset.busy = String(busy);
    panel.hidden = !open;
    toast.hidden = open || !toastVisible;
    toast.dataset.tone = status.tone;
    toast.textContent = status.text;

    statusBar.dataset.tone = status.tone === 'busy' ? 'idle' : status.tone;
    statusText.textContent = status.text;
    spinner.hidden = !busy;

    fast.disabled = busy;
    fastText.textContent = fastLabel ?? 'Hızlı Çöz';
    for (const b of Object.values(actionButtons)) b.disabled = busy;
  }

  function setStatus(text: string, tone: Tone, showToast = true) {
    status = { text, tone };
    toastVisible = showToast && tone !== 'idle';
    clearTimeout(toastTimer);
    if (toastVisible && (tone === 'success' || tone === 'busy')) {
      toastTimer = setTimeout(() => {
        toastVisible = false;
        renderChrome();
      }, tone === 'success' ? toastMs : toastMs * 4);
    }
    renderChrome();
  }

  function setFastLabel(label: string | null, resetAfterMs?: number) {
    clearTimeout(labelTimer);
    fastLabel = label;
    if (label && resetAfterMs) {
      labelTimer = setTimeout(() => {
        fastLabel = null;
        renderChrome();
      }, resetAfterMs);
    }
    renderChrome();
  }

  function applyProgress(progress: Progress) {
    if (progress.items) items = progress.items;

    if (progress.stage === 'error') {
      setStatus(progress.text, 'error');
      setFastLabel('Hata', toastMs);
    } else if (progress.stage === 'done') {
      const failed = progress.summary?.failed ?? 0;
      setStatus(progress.text, failed > 0 ? 'warning' : 'success');
      setFastLabel(failed > 0 ? `${progress.summary!.filled}/${progress.summary!.total} işaretlendi` : '✓ İşaretlendi', toastMs);
    } else {
      setStatus(progress.text, 'busy', true);
      setFastLabel(STAGE_LABEL[progress.stage] ?? null);
    }
    renderList();
  }

  // ---- talking to the background ----
  function run(command: UiCommand) {
    if (busy) return;

    let port: PortLike;
    try {
      port = options.connect();
    } catch {
      setStatus('Eklenti güncellenmiş. Sayfayı yenile (F5) ve tekrar dene.', 'error');
      return;
    }

    busy = true;
    let finished = false;
    setFastLabel('Başlıyor…');
    renderList();

    port.onMessage.addListener((message: UiMessage) => {
      if (message.type === 'progress') {
        applyProgress(message.progress);
        return;
      }
      finished = true;
      busy = false;
      if (message.session) {
        session = message.session;
      } else if (command.cmd === 'scan' || command.cmd === 'autopilot') {
        session = null;
        items = [];
      }
      // A stage label ("Çözülüyor…") must not outlive the run that set it
      if (fastLabel === 'Başlıyor…' || Object.values(STAGE_LABEL).includes(fastLabel ?? '')) fastLabel = null;
      renderChrome();
      renderList();
      try {
        port.disconnect();
      } catch {
        /* already closed */
      }
    });

    port.onDisconnect.addListener(() => {
      if (finished) return;
      busy = false;
      setStatus('Bağlantı koptu. Sayfayı yenileyip (F5) tekrar dene.', 'error');
      setFastLabel('Hata', toastMs);
      renderList();
    });

    port.postMessage(command);
  }

  function needSession(): Session | null {
    if (session && session.questions.length > 0) return session;
    open = true;
    setStatus('Önce "Tara" ile soruları bul.', 'warning', false);
    return null;
  }

  // ---- events ----
  fast.addEventListener('click', () => {
    open = false;
    toastVisible = false;
    run({ cmd: 'autopilot' });
  });
  toggle.addEventListener('click', () => {
    open = !open;
    if (open) toastVisible = false;
    renderChrome();
  });
  closeBtn.addEventListener('click', () => {
    open = false;
    renderChrome();
  });
  toast.addEventListener('click', () => {
    toastVisible = false;
    renderChrome();
  });
  actionButtons.scan.addEventListener('click', () => run({ cmd: 'scan' }));
  actionButtons.solve.addEventListener('click', () => {
    const s = needSession();
    if (s) run({ cmd: 'solve', session: s });
  });
  actionButtons.fill.addEventListener('click', () => {
    const s = needSession();
    if (s) run({ cmd: 'fill', session: s });
  });

  // Typing in the panel must not trigger the site's own keyboard shortcuts
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    root.addEventListener(type, (event) => event.stopPropagation());
  }

  renderList();
  renderChrome();
  doc.documentElement.appendChild(host);

  return {
    host,
    destroy() {
      clearTimeout(labelTimer);
      clearTimeout(toastTimer);
      host.remove();
    },
  };
}
