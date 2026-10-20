/**
 * End-to-end check of the in-page "Hızlı Çöz" button in a REAL Chrome with the built extension (dist/) loaded.
 *
 * What is real: Chrome, the extension (content script, service worker, ports, MAIN-world bridge), a same-origin
 * activity iframe on a *.macmillan.localhost host, and the real jQuery UI selectmenu widget.
 * What is faked: the AI. Requests the service worker sends to the Gemini API are answered from here.
 *
 * Usage:  npm run build && CHROME_PATH="<Chrome for Testing chrome.exe>" npm run e2e
 * (Branded Chrome 137+ ignores extension loading from the command line, so use Chrome for Testing:
 *  npx @puppeteer/browsers install chrome@stable)
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const chromePath = process.env.CHROME_PATH;
const shotDir = process.env.E2E_SHOTS || tmpdir();
if (!chromePath) {
  console.error('Set CHROME_PATH to a Chrome for Testing executable.');
  process.exit(2);
}

const option = (n, texts) => texts.map((t, i) => `<option value="item_${i + 1}">${t}</option>`).join('');
const gap = (n, texts) =>
  `<span data-rcfid="dropDown_${n}" data-rcfinteraction="dropDown" class="dropDown"><span class="markable dev-markable-container">` +
  `<select id="sel-${n}" style="display:none"><option value="" selected></option>${option(n, texts)}</select></span></span>`;

const PLAYER = `<!doctype html><html><head><meta charset="utf-8"><title>rcf-player</title>
<script src="/vendor/jquery.js"></script><script src="/vendor/jquery-ui.js"></script>
<style>.ui-selectmenu-button{display:inline-block;min-width:130px;border:1px solid #999;padding:2px 8px;margin:0 4px}.rcfOrderingContainer{list-style:none;display:flex;gap:8px;padding:12px 0;margin:0}.orderingItem{padding:8px 14px;border:2px solid #3C6ED2;border-radius:4px;background:#fff;cursor:grab;user-select:none}.orderingItem.fixed{border-color:#999;cursor:default}</style></head>
<body id="player-body"><div class="dev-rcf-content activity mm_C04" data-interactions="rcfDropDown">
<form onsubmit="return false"><div class="rubricContainer"><div class="rubric"><div class="rubricBody"><p>Choose the correct option to complete the email.</p></div></div></div>
<div class="main"><div class="block mm_interactive"><div class="block mm_blockText">
<p>Subject: Customer survey</p>
<p>I've ${gap(1, ['solved', 'analysed', 'caused'])} the data from our survey. There are problems we need to ${gap(2, ['come up with', 'solve', 'cause'])}.</p>
<p>I would like us to meet this week and ${gap(3, ['solve', 'deal with', 'agree on'])} some solutions.</p>
</div></div></div>
<div class="block mm_interactive"><div class="orderingContainer" data-rcfinteraction="ordering" data-rcfid="ordering_1" aria-orientation="horizontal"><span class="ordering horizontal"><ul class="ordering rcfOrderingContainer ui-sortable">
<li data-rcfid="item_5" class="orderingItem" data-ordervalue="me">me</li><li data-rcfid="item_6" class="orderingItem" data-ordervalue="a">a</li><li data-rcfid="item_7" class="orderingItem" data-ordervalue="hand">hand</li><li data-rcfid="item_3" class="orderingItem" data-ordervalue="mind">mind</li><li data-rcfid="item_1" class="orderingItem" data-ordervalue="Would">Would</li><li data-rcfid="item_2" class="orderingItem" data-ordervalue="you">you</li><li data-rcfid="item_4" class="orderingItem" data-ordervalue="giving">giving</li><li class="suffix fixed orderingItem" data-fixed="y">?</li>
</ul></span></div></div></form></div>
<script>$('select').selectmenu(); $('ul.rcfOrderingContainer').sortable({ items: '> li:not(.fixed)', axis: 'x' });</script></body></html>`;

const TOP = `<!doctype html><html><head><meta charset="utf-8"><title>Macmillan Education Everywhere (test shell)</title>
<style>body{margin:0;font-family:'Open Sans',Arial,sans-serif;background:#ECF1FB}iframe{width:100%;height:520px;border:0;background:#fff}</style></head>
<body><h1 style="padding:8px 16px;margin:0">Unit 2 - Vocabulary practice</h1><iframe src="/rcf-player.html"></iframe></body></html>`;

const COURSE = `<!doctype html><html><head><meta charset="utf-8"><title>Macmillan course (test shell)</title>
<style>body{margin:0;font-family:'Open Sans',Arial,sans-serif}iframe{width:100%;height:480px;border:0}nav{padding:8px 16px;background:#ECF1FB;display:flex;gap:8px}</style></head>
<body><nav><button id="previous">Previous</button><button id="next">Next</button><button id="submit">Submit</button></nav>
<iframe id="player" src="/rcf-player.html?n=1"></iframe>
<script>
  window.__submitClicked = false; window.__nextClicks = 0;
  document.getElementById('submit').onclick = () => { window.__submitClicked = true; };
  let n = 1; const total = 3;
  document.getElementById('next').onclick = () => {
    window.__nextClicks++; n++;
    document.getElementById('player').src = '/rcf-player.html?n=' + n;
    if (n >= total) document.getElementById('next').remove();
  };
</script></body></html>`;

const server = createServer((req, res) => {
  const send = (type, body) => {
    res.writeHead(200, { 'Content-Type': type });
    res.end(body);
  };
  const requestUrl = new URL(req.url, 'http://x');
  if (requestUrl.pathname === '/') return send('text/html', TOP);
  if (requestUrl.pathname === '/course') return send('text/html', COURSE);
  if (requestUrl.pathname === '/rcf-player.html') {
    const activity = requestUrl.searchParams.get('n') || '1';
    return send('text/html', PLAYER.replace('<div class="dev-rcf-content activity mm_C04"', `<div data-rcfxmlid="activity-${activity}" class="dev-rcf-content activity mm_C04"`));
  }
  if (requestUrl.pathname === '/vendor/jquery.js') return send('text/javascript', readFileSync(join(root, 'node_modules/jquery/dist/jquery.js')));
  if (requestUrl.pathname === '/vendor/jquery-ui.js') return send('text/javascript', readFileSync(join(root, 'node_modules/jquery-ui/dist/jquery-ui.js')));
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
// A host that matches the extension's real host permissions (https://*.macmillaneducation.com/*), mapped to this server
const HOST = 'mee.macmillaneducation.com';
const url = `http://${HOST}:${port}/`;

// The real manifest only allows https. Test a copy that also allows plain http, so the real code paths run unchanged.
const extensionDir = mkdtempSync(join(tmpdir(), 'sp-ext-'));
cpSync(dist, extensionDir, { recursive: true });
const manifestPath = join(extensionDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.host_permissions.push('http://*.macmillaneducation.com/*');
writeFileSync(manifestPath, JSON.stringify(manifest));

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), 'sp-e2e-')),
  enableExtensions: [extensionDir],
  args: ['--no-first-run', '--window-size=1280,900', `--host-resolver-rules=MAP ${HOST} 127.0.0.1`],
  defaultViewport: { width: 1280, height: 900 },
});

let exitCode = 0;
try {
  // ---- service worker: settings + fake AI -----------------------------------------------------------------
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'), { timeout: 20000 });
  const worker = await swTarget.worker();
  await worker.evaluate(() =>
    chrome.storage.local.set({
      studypilot_settings: { selectedProvider: 'gemini', selectedModels: { gemini: 'gemini-2.5-flash-lite', openai: '', anthropic: '' } },
      studypilot_persistent_keys: { gemini: 'e2e-test-key' },
    })
  );

  const aiRequests = [];
  const cdp = await swTarget.createCDPSession();
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://generativelanguage.googleapis.com/*' }] });
  cdp.on('Fetch.requestPaused', async (event) => {
    const body = JSON.parse(event.request.postData || '{}');
    const prompt = body.contents?.[0]?.parts?.[0]?.text ?? '';
    aiRequests.push(prompt);
    const start = prompt.lastIndexOf('[\n  {');
    const questions = JSON.parse(prompt.slice(start));
    // The "AI" picks the second option of every gap, and sorts the words of an ordering question alphabetically
    const suggestions = questions.map((q) => ({
      questionId: q.questionId,
      suggestedAnswer:
        q.type === 'ordering'
          ? q.options.map((o) => o.label).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).join(' || ')
          : q.options[1].label,
      confidence: 0.9,
      explanation: 'e2e',
    }));
    await cdp.send('Fetch.fulfillRequest', {
      requestId: event.requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Access-Control-Allow-Origin', value: '*' },
      ],
      body: Buffer.from(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ suggestions }) }] } }], usageMetadata: { totalTokenCount: 1 } })).toString('base64'),
    });
  });

  // ---- the page ---------------------------------------------------------------------------------------------
  const page = await browser.newPage();
  const pageLogs = [];
  page.on('console', (m) => {
    const text = m.text();
    if (text.includes('[StudyPilot]')) pageLogs.push(text);
  });
  await page.goto(url, { waitUntil: 'networkidle0' });

  await page.waitForFunction(() => !!document.getElementById('studypilot-root'), { timeout: 10000 });
  check('the panel host is mounted in the top page of a macmillan host', true);

  const inFrame = await page.evaluate(() => document.querySelector('iframe').contentDocument.getElementById('studypilot-root'));
  check('the panel is NOT mounted inside the activity iframe', inFrame === null);

  const shadow = (script) => page.evaluate(`(() => { const r = document.getElementById('studypilot-root').shadowRoot; return (${script})(r); })()`);

  const label0 = await shadow(`(r) => r.querySelector('.sp-fast').textContent`);
  check('the button reads "Hızlı Çöz"', label0 === 'Hızlı Çöz', label0);
  await page.screenshot({ path: join(shotDir, 'e2e-1-idle.png') });

  // ---- one click: scan -> solve -> fill ----------------------------------------------------------------------
  await shadow(`(r) => r.querySelector('.sp-fast').click()`);
  try {
    await page.waitForFunction(
      () => {
        const t = document.getElementById('studypilot-root').shadowRoot.querySelector('.sp-toast');
        return t && !t.hidden && (t.dataset.tone === 'success' || t.dataset.tone === 'error' || t.dataset.tone === 'warning');
      },
      { timeout: 40000 }
    );
  } catch {
    /* fall through: the assertions below print what state we are in */
  }
  const outcome = await shadow(`(r) => ({ text: r.querySelector('.sp-toast').textContent, tone: r.querySelector('.sp-toast').dataset.tone, label: r.querySelector('.sp-fast').textContent })`);
  check('the run ends with a success message', outcome.tone === 'success', JSON.stringify(outcome));
  check('the AI was called exactly once for the whole activity', aiRequests.length === 1, `${aiRequests.length} request(s)`);
  if (aiRequests[0]) {
    check('the prompt carries the instructions and the passage once', aiRequests[0].includes('Choose the correct option to complete the email.') && aiRequests[0].split('Subject: Customer survey').length === 2);
  }

  const frame = page.frames().find((f) => f.url().includes('rcf-player'));
  const boxes = await frame.evaluate(() =>
    Array.from(document.querySelectorAll('select')).map((s) => ({
      id: s.id,
      selected: s.options[s.selectedIndex].text,
      box: document.querySelector(`#${s.id}-button .ui-selectmenu-text`).textContent,
    }))
  );
  const widgetResults = pageLogs.filter((l) => l.includes('Widget selection result'));
  check(
    'every gap was selected through the real jQuery UI widget (MAIN-world bridge, not the DOM fallback)',
    widgetResults.length === 3 && widgetResults.every((l) => l.includes('"viaWidget":true')),
    widgetResults.map((l) => l.slice(l.indexOf('{'))).join(' | ').slice(0, 300)
  );
  const expected = ['analysed', 'solve', 'deal with'];
  boxes.forEach((b, i) => check(`gap ${i + 1}: the select AND the visible box show "${expected[i]}"`, b.selected === expected[i] && b.box === expected[i], JSON.stringify(b)));
  await page.screenshot({ path: join(shotDir, 'e2e-2-done.png') });

  // ---- the panel: open it, look at the list ------------------------------------------------------------------
  await shadow(`(r) => r.querySelector('.sp-toggle').click()`);
  const order = await frame.evaluate(() => Array.from(document.querySelectorAll('[data-rcfid="ordering_1"] li')).map((li) => li.textContent));
  check(
    'the ordering list was rearranged by real drags on the real jQuery UI sortable (fixed "?" stays last)',
    JSON.stringify(order) === JSON.stringify(['a', 'giving', 'hand', 'me', 'mind', 'Would', 'you', '?']),
    order.join(' ')
  );
  const ids = aiRequests[0] ? [...aiRequests[0].matchAll(/"questionId": "([^"]+)"/g)].map((m) => m[1]) : [];
  check('every question in the prompt has its own id (dropdowns and ordering on one page)', ids.length === 4 && new Set(ids).size === 4, ids.join(', '));

  const panel = await shadow(`(r) => ({ rows: r.querySelectorAll('.sp-item').length, marks: Array.from(r.querySelectorAll('.sp-mark')).map((m) => m.textContent), answers: Array.from(r.querySelectorAll('.sp-answer')).map((i) => i.value) })`);
  check('the panel lists the 4 questions, all marked as filled', panel.rows === 4 && panel.marks.every((m) => m === '✓'), JSON.stringify(panel));
  await page.screenshot({ path: join(shotDir, 'e2e-3-panel.png') });

  // ---- a second page: the old answers must not be reused ------------------------------------------------------
  await frame.evaluate(() => {
    document.querySelectorAll('select').forEach((s) => { s.selectedIndex = 0; $(s).selectmenu('refresh'); });
    const ul = document.querySelector('[data-rcfid="ordering_1"] ul');
    Array.from(ul.querySelectorAll('li:not(.fixed)')).reverse().forEach((li) => ul.insertBefore(li, ul.querySelector('li.fixed')));
  });
  await shadow(`(r) => r.querySelector('.sp-close').click()`);
  await shadow(`(r) => r.querySelector('.sp-fast').click()`);
  await page.waitForFunction(() => document.getElementById('studypilot-root').shadowRoot.querySelector('.sp-toast').dataset.tone === 'success' && !document.getElementById('studypilot-root').shadowRoot.querySelector('.sp-fast').disabled, { timeout: 40000 }).catch(() => {});
  check('clicking again scans again (2 AI requests in total)', aiRequests.length === 2, `${aiRequests.length}`);
  const again = await frame.evaluate(() => Array.from(document.querySelectorAll('select')).map((s) => s.options[s.selectedIndex].text));
  check('and fills the cleared gaps again', JSON.stringify(again) === JSON.stringify(expected), JSON.stringify(again));
  const orderAgain = await frame.evaluate(() => Array.from(document.querySelectorAll('[data-rcfid="ordering_1"] li')).map((li) => li.textContent).join(' '));
  check('and puts the shuffled words back in order', orderAgain === 'a giving hand me mind Would you ?', orderAgain);
  // ---- optional mode: solve everything, pressing Next --------------------------------------------------------------
  const before = aiRequests.length;
  const course = await browser.newPage();
  await course.goto(`http://${HOST}:${port}/course`, { waitUntil: 'networkidle0' });
  await course.waitForFunction(() => !!document.getElementById('studypilot-root'), { timeout: 10000 });
  const courseShadow = (script) => course.evaluate(`(() => { const r = document.getElementById('studypilot-root').shadowRoot; return (${script})(r); })()`);

  await courseShadow(`(r) => r.querySelector('.sp-toggle').click()`);
  await courseShadow(`(r) => { const set = (label, v) => { r.querySelector('input[aria-label="' + label + '"]').value = v; }; set('En çok etkinlik', '5'); set('Bekleme (sn)', '1'); r.querySelector('.sp-series-start').click(); }`);
  const confirmText = await courseShadow(`(r) => r.querySelector('.sp-confirm-text').textContent`);
  check('"Tümünü Çöz" asks for confirmation and nothing starts yet', /En çok 5 etkinlik/.test(confirmText) && aiRequests.length === before, confirmText);
  await courseShadow(`(r) => Array.from(r.querySelectorAll('.sp-confirm .sp-btn')).find((b) => b.textContent === 'Başlat').click()`);

  await course
    .waitForFunction(
      () => {
        const label = document.getElementById('studypilot-root').shadowRoot.querySelector('.sp-fast').textContent;
        return label.startsWith('✓') || label === 'Durdu';
      },
      { timeout: 120000, polling: 500 }
    )
    .catch(() => {});
  const seriesOutcome = await courseShadow(`(r) => ({ label: r.querySelector('.sp-fast').textContent, text: r.querySelector('.sp-status').textContent, tone: r.querySelector('.sp-status').dataset.tone })`);
  check('the series solved all 3 activities and ended normally on the last one', seriesOutcome.label === '✓ 3 etkinlik' && seriesOutcome.tone === 'success', JSON.stringify(seriesOutcome));
  check('the AI was asked once per activity (3 requests)', aiRequests.length - before === 3, `${aiRequests.length - before}`);

  const nav = await course.evaluate(() => ({ next: window.__nextClicks, submit: window.__submitClicked }));
  check('Next was pressed exactly twice (between the 3 activities)', nav.next === 2, JSON.stringify(nav));
  check('the decoy "Submit" button was never pressed', nav.submit === false, JSON.stringify(nav));

  const lastFrame = course.frames().find((f) => f.url().includes('rcf-player'));
  const lastState = await lastFrame.evaluate(() => ({
    id: document.querySelector('[data-rcfxmlid]').getAttribute('data-rcfxmlid'),
    gaps: Array.from(document.querySelectorAll('select')).map((sel) => sel.options[sel.selectedIndex].text),
    order: Array.from(document.querySelectorAll('[data-rcfid="ordering_1"] li')).map((li) => li.textContent).join(' '),
  }));
  check(
    'the last activity (3) is filled too: gaps and word order',
    lastState.id === 'activity-3' && JSON.stringify(lastState.gaps) === JSON.stringify(['analysed', 'solve', 'deal with']) && lastState.order === 'a giving hand me mind Would you ?',
    JSON.stringify(lastState)
  );
  await course.screenshot({ path: join(shotDir, 'e2e-4-series.png') });
} catch (err) {
  console.log('E2E ERROR:', err);
  exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in ${shotDir}`);
process.exit(exitCode || (failed ? 1 : 0));
