import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './fixture-loader';
import { extractQuestionsFromGenericDOM } from '../src/extractor/dom-scanner';
import { inspectRcfPage, snapshotRcfActivity } from '../src/extractor/rcf-inspector';
import { fillFormField } from '../src/filler/form-filler';
import { MULTI_ANSWER_SEPARATOR } from '../src/types/question';

test('Macmillan dropdown dialogue - extracts every dropDown with full sentence and speaker context', () => {
  const doc = loadFixture('tests/fixtures/macmillan-dropdown-dialogue.html');
  const qs = extractQuestionsFromGenericDOM(doc);

  assert.equal(qs.length, 4);
  assert.ok(qs.every((q) => q.type === 'dropdown'));
  assert.deepEqual(qs[0].options?.map((o) => o.label), ['I spoke to John', 'John spoke to me']);
  assert.equal(qs[0].fields[0].selector, '#ui-id-31');

  // Text after the gap is kept, not just text before it
  assert.equal(qs[2].promptText, 'A: [_____] papers are these?');
  assert.equal(qs[3].promptText, 'B: [_____] Russian and a bit of French.');

  // The other speaker's line is passed as context; feedback (which reveals answers) is not
  assert.match(qs[0].contextText ?? '', /Who spoke to you\?/);
  assert.match(qs[3].contextText ?? '', /Do you speak any other languages\?/);
  for (const q of qs) assert.doesNotMatch(q.contextText ?? '', /feedback/);
});

test('Macmillan drag & drop word box - numbers gaps sharing a sentence and passes the full dialogue', () => {
  const doc = loadFixture('tests/fixtures/macmillan-dragdrop-wordbox.html');
  const qs = extractQuestionsFromGenericDOM(doc);

  assert.equal(qs.length, 5);
  assert.deepEqual(qs[0].options?.map((o) => o.label), ['sound', 'recognise', 'watching', 'noticed', 'heard', 'looks', 'staring at']);
  assert.equal(qs[0].fields[0].selector, '[data-rcfid="complexDroppable_1"]');

  // Gaps 1 and 2 share one sentence: prompts must differ and say which blank to answer
  assert.notEqual(qs[0].promptText, qs[1].promptText);
  assert.match(qs[0].promptText, /Answer ONLY for \[BLANK 1\]/);
  assert.match(qs[1].promptText, /Answer ONLY for \[BLANK 2\]/);

  // Single-gap sentence keeps the plain placeholder
  assert.equal(qs[4].promptText, "Amber: So that's why you were [_____] them?");

  // Whole dialogue and the single-use rule are passed as context
  assert.match(qs[4].contextText ?? '', /Hi Christina!/);
  assert.match(qs[4].contextText ?? '', /only once/);
});

test('RCF inspector - reports supported widgets and matches gap count to detected questions', () => {
  const dd = inspectRcfPage(loadFixture('tests/fixtures/macmillan-dropdown-dialogue.html'));
  assert.deepEqual(
    dd.interactions.map((i) => [i.type, i.count, i.status]).sort(),
    [['collapsibleList', 1, 'passive'], ['dropDown', 4, 'supported']]
  );
  assert.equal(dd.gapsOnPage, 4);
  assert.equal(dd.questionsDetected, 4);
  assert.deepEqual(dd.warnings, []);

  const dnd = inspectRcfPage(loadFixture('tests/fixtures/macmillan-dragdrop-wordbox.html'));
  assert.equal(dnd.interactions.find((i) => i.type === 'complexDroppable')?.count, 5);
  assert.equal(dnd.questionsDetected, 5);
});

test('RCF inspector - flags unsupported widgets with a sanitized sample', () => {
  const report = inspectRcfPage(loadFixture('tests/fixtures/unknown-interaction.html'));
  const sortable = report.interactions.find((i) => i.type === 'sortable');
  assert.equal(sortable?.status, 'UNSUPPORTED');
  assert.match(sortable?.sampleHtml ?? '', /<li>one<\/li>/);
  assert.doesNotMatch(sortable?.sampleHtml ?? '', /secret answer/);
  assert.ok(report.warnings.some((w) => w.includes('sortable')));
});

test('RCF inspector - audio player and glossary are passive, and a captions button is not mistaken for a transcript', () => {
  const doc = loadFixture('tests/fixtures/macmillan-listening-audio.html');
  const report = inspectRcfPage(doc);

  assert.deepEqual(
    report.interactions.map((i) => [i.type, i.status]).sort(),
    [['audioElement', 'passive'], ['collapsibleBlock', 'passive']]
  );
  assert.equal(report.context.isListening, true);
  assert.equal(report.context.audioFile, 'LH_OPP4_Aud_U02_2.1_Lisprac1_001.mp3');
  assert.equal(report.context.glossaryFound, true);
  assert.equal(report.context.captionsButtonPresent, true);

  // "Hide captions / Show captions" is the toggle's label, not a transcript
  assert.equal(report.context.transcriptFound, false);
  assert.ok(report.warnings.some((w) => w.includes('without a readable transcript')));
  assert.ok(!report.warnings.some((w) => w.includes('Unsupported interaction')));
});

test('Macmillan listening radio questions - real prompt, unique per-group selectors, transcript by speaker turn', () => {
  const doc = loadFixture('tests/fixtures/macmillan-listening-radio.html');
  const qs = extractQuestionsFromGenericDOM(doc);

  assert.equal(qs.length, 3);
  assert.deepEqual(qs.map((q) => q.promptText), [
    'Who are Lucy and Maria talking about?',
    "Lucy ____ about Mark's experiment.",
    'Lucy is ____.',
  ]);

  // data-rcfid="item_1" repeats in every radio group: each selector must resolve to exactly one element, in its own group
  for (const q of qs) {
    for (const field of q.fields) {
      assert.equal(doc.querySelectorAll(field.selector).length, 1, `selector not unique: ${field.selector}`);
      assert.ok(doc.querySelector(field.selector)?.closest(`#radio_${q.index}`), `selector escapes group ${q.index}: ${field.selector}`);
    }
  }

  // Transcript keeps one speaker turn per line and is not the captions button label
  const transcript = qs[0].metadata?.audioTranscript ?? '';
  assert.match(transcript, /Maria: Hey Lucy! How have you been\?\nLucy: Hi Maria!/);
  assert.doesNotMatch(transcript, /captions/i);
  assert.match(qs[0].contextText ?? '', /Glossary/i);
});

test('Macmillan checkbox group - one multiple_select question; audio sliders are not questions', () => {
  const doc = loadFixture('tests/fixtures/macmillan-checkbox-select.html');
  const qs = extractQuestionsFromGenericDOM(doc);

  assert.equal(qs.length, 1, `got: ${JSON.stringify(qs.map((q) => [q.type, q.promptText]))}`);
  const q = qs[0];
  assert.equal(q.type, 'multiple_select');
  assert.equal(q.metadata?.selectCount, 3);
  assert.equal(q.options?.length, 5);
  assert.match(q.promptText, /three correct statements/);
  for (const o of q.options ?? []) {
    assert.equal(doc.querySelectorAll(o.elementSelector!).length, 1);
    assert.ok(doc.querySelector(o.elementSelector!)?.closest('#checkbox_1'));
  }

  const report = inspectRcfPage(doc);
  assert.equal(report.interactions.find((i) => i.type === 'checkboxItemSelect')?.status, 'supported');
  assert.equal(report.questionsDetected, 1);
  assert.deepEqual(report.warnings, []);
});

test('Macmillan checkbox group - filler ticks every named option, even with typographic differences', async () => {
  const doc = loadFixture('tests/fixtures/macmillan-checkbox-select.html');
  // Stand-in for RCF: clicking a checkbox chip toggles aria-checked
  doc.querySelectorAll('[role="checkbox"]').forEach((el) =>
    el.addEventListener('click', () => el.setAttribute('aria-checked', el.getAttribute('aria-checked') === 'true' ? 'false' : 'true'))
  );
  const [question] = extractQuestionsFromGenericDOM(doc);

  const answer = [
    "Marks happy - definitely happier than before.", // dash/apostrophe differ from the page
    'Maria hopes he can find his true passion.',
    "Mark's experiment will be life-changing.",
  ].join(MULTI_ANSWER_SEPARATOR);
  const result = await fillFormField(doc, question, answer);

  assert.equal(result.success, true, result.error);
  const checked = Array.from(doc.querySelectorAll('[role="checkbox"]')).map((el) => el.getAttribute('aria-checked'));
  assert.deepEqual(checked, ['true', 'false', 'true', 'false', 'true']);

  // Running it again must not untick anything
  await fillFormField(doc, question, answer);
  assert.deepEqual(
    Array.from(doc.querySelectorAll('[role="checkbox"]')).map((el) => el.getAttribute('aria-checked')),
    ['true', 'false', 'true', 'false', 'true']
  );
});

test('Macmillan word-box carousel - one paragraph with many gaps is not sent twice per question', () => {
  const qs = extractQuestionsFromGenericDOM(loadFixture('tests/fixtures/macmillan-dragdrop-carousel.html'));

  assert.equal(qs.length, 8);
  assert.equal(qs[0].options?.length, 8);
  qs.forEach((q, i) => assert.ok(q.promptText.includes(`(Answer ONLY for [BLANK ${i + 1}])`), q.promptText));
  // Passage == prompt, so the context only carries the single-use rule
  assert.equal(qs[0].contextText, '[Note: each word in the word bank can be used only once.]');
});

test('Macmillan word-box carousel - filler pages to the wanted word before picking it', async () => {
  const doc = loadFixture('tests/fixtures/macmillan-dragdrop-carousel.html');
  const words = Array.from(doc.querySelectorAll('.wordBox li')) as HTMLElement[];
  const gap8 = doc.querySelector('[data-rcfid="complexDroppable_8"]') as HTMLElement;

  // Stand-in for RCF: only the active word can be picked; prev/next move the active word; a click on a gap places it
  const move = (delta: number) => {
    const at = words.findIndex((w) => w.classList.contains('active'));
    words[at].classList.remove('active');
    words[at + delta].classList.add('active');
  };
  let picked = '';
  words.forEach((w) =>
    w.addEventListener('click', () => {
      if (w.classList.contains('active')) picked = w.textContent || '';
    })
  );
  doc.querySelector('.nextItem')!.addEventListener('click', () => move(1));
  doc.querySelector('.previousItem')!.addEventListener('click', () => move(-1));
  gap8.addEventListener('click', () => {
    if (picked) gap8.setAttribute('data-filled', picked);
  });

  const questions = extractQuestionsFromGenericDOM(doc);
  const result = await fillFormField(doc, questions[7], 'take'); // "take" is the 5th word; the box starts on "make"

  assert.equal(result.success, true, result.error);
  assert.equal(gap8.getAttribute('data-filled'), 'take');
});

test('RCF snapshot - keeps the structure needed to support a new widget, drops noise and answer feedback', () => {
  const doc = loadFixture('tests/fixtures/macmillan-dropdown-dialogue.html');
  // Pretend the page carries the noise real pages have
  doc.querySelector('li')!.insertAdjacentHTML('beforeend', '<svg><path d="M0 0"/></svg><img src="x.jpg"><div class="dev-feedback"><p>secret answer</p></div>');
  doc.querySelector('select')!.setAttribute('style', 'display: none;');

  const snapshot = snapshotRcfActivity(doc);

  // Structure that a handler is written against
  assert.match(snapshot.html, /data-rcfinteraction="dropDown"/);
  assert.match(snapshot.html, /data-rcfid="dropDown_1"/);
  assert.match(snapshot.html, /<option[^>]*>I spoke to John<\/option>/);
  assert.match(snapshot.html, /id="ui-id-31"/);

  // Noise and answer-revealing feedback are gone
  assert.doesNotMatch(snapshot.html, /secret answer/);
  assert.doesNotMatch(snapshot.html, /<svg|<img|style=/);
  assert.equal(snapshot.truncated, false);
  assert.ok(snapshot.html.length < 60_000);
});

test('Macmillan checkbox list - one multiple_select per list item with its own prompt and tick count', () => {
  const doc = loadFixture('tests/fixtures/macmillan-checkbox-list.html');
  const qs = extractQuestionsFromGenericDOM(doc);

  assert.equal(qs.length, 3);
  assert.deepEqual(qs.map((q) => q.type), ['multiple_select', 'multiple_select', 'multiple_select']);
  assert.deepEqual(qs.map((q) => q.promptText), [
    "When I was a university student, I'd eat lots of takeaways because I ____ cook well.",
    'She has recovered well from the accident but she still ____ walk very well.',
    'He ____ speak three different languages now.',
  ]);
  // Each question says how many to tick; this activity mixes 2 and 1
  assert.deepEqual(qs.map((q) => q.metadata?.selectCount), [2, 1, 2]);

  // The activity instructions travel as context, the answer-revealing feedback block does not
  for (const q of qs) {
    assert.match(q.contextText ?? '', /more than one possible answer/);
    assert.doesNotMatch(`${q.promptText} ${q.contextText ?? ''}`, /talk about our ability/);
  }

  // item_1..item_3 repeat in every group: each selector must stay inside its own group
  qs.forEach((q, i) => {
    for (const o of q.options ?? []) {
      assert.equal(doc.querySelectorAll(o.elementSelector!).length, 1, o.elementSelector);
      assert.ok(doc.querySelector(o.elementSelector!)?.closest(`#checkbox_${i + 1}`));
    }
  });

  const report = inspectRcfPage(doc);
  assert.equal(report.questionsDetected, 3);
  assert.deepEqual(report.warnings, []);
});

test('Macmillan checkbox list - filler ticks the right chips in the right group', async () => {
  const doc = loadFixture('tests/fixtures/macmillan-checkbox-list.html');
  doc.querySelectorAll('[role="checkbox"]').forEach((el) =>
    el.addEventListener('click', () => el.setAttribute('aria-checked', el.getAttribute('aria-checked') === 'true' ? 'false' : 'true'))
  );
  const qs = extractQuestionsFromGenericDOM(doc);

  assert.equal((await fillFormField(doc, qs[0], ["couldn't", "wasn't able to"].join(MULTI_ANSWER_SEPARATOR))).success, true);
  assert.equal((await fillFormField(doc, qs[1], "can't")).success, true); // a single answer, no separator
  assert.equal((await fillFormField(doc, qs[2], ['is able to', 'can'].join(MULTI_ANSWER_SEPARATOR))).success, true);

  const state = (n: number) =>
    Array.from(doc.querySelectorAll(`#checkbox_${n} [role="checkbox"]`)).map((el) => el.getAttribute('aria-checked'));
  assert.deepEqual(state(1), ['true', 'true', 'false']);
  assert.deepEqual(state(2), ['true', 'false', 'false']);
  assert.deepEqual(state(3), ['true', 'false', 'true']);
});

test('Macmillan locating - finds the error words and survives an empty dropDown wrapper on the page', () => {
  const doc = loadFixture('tests/fixtures/macmillan-locating-empty-dropdown.html');
  const qs = extractQuestionsFromGenericDOM(doc);

  assert.equal(qs.length, 2);
  assert.deepEqual(qs.map((q) => q.type), ['fill_in_the_blank', 'fill_in_the_blank']);
  assert.match(qs[0].promptText, /Incorrect word: "am not liking"/);
  assert.match(qs[1].promptText, /Incorrect word: "check"/);

  const report = inspectRcfPage(doc);
  assert.equal(report.interactions.find((i) => i.type === 'locating')?.status, 'supported');
  assert.equal(report.questionsDetected, 2);
  assert.ok(!report.warnings.some((w) => w.includes('Scanner')), report.warnings.join('; '));
});

test('Macmillan locating (choice popup) - options, bracketed mistake, clean report with variants', () => {
  const doc = loadFixture('tests/fixtures/macmillan-locating-choice.html');
  const qs = extractQuestionsFromGenericDOM(doc);

  assert.equal(qs.length, 3);
  assert.ok(qs.every((q) => q.type === 'dropdown'));
  assert.equal(
    qs[0].promptText,
    'The phrase in square brackets is a mistake. Choose the option that corrects it: "I [can\'t] swim well when I was younger."'
  );
  assert.equal(qs[2].promptText.includes('[am not able]. The website wasn\'t working.'), true, qs[2].promptText);
  // The "(Clear)" entry is not an answer; the wrong phrase itself is not offered either
  assert.deepEqual(qs[0].options?.map((o) => o.label), ["couldn't", "wasn't able"]);
  assert.deepEqual(qs[1].options?.map((o) => o.label), ["can't", 'managed to']);
  // Feedback explains the answer and must not reach the AI
  for (const q of qs) assert.doesNotMatch(`${q.promptText} ${q.contextText ?? ''}`, /ability or skills|specific task|past ability/);

  for (const q of qs) assert.equal(doc.querySelectorAll(q.fields[0].selector).length, 1, q.fields[0].selector);

  const report = inspectRcfPage(doc);
  const locating = report.interactions.find((i) => i.type === 'locating');
  assert.deepEqual(locating?.variants, { 'choice-popup': 3 });
  assert.equal(report.questionsDetected, 3);
  assert.deepEqual(report.warnings, []);

  const typed = inspectRcfPage(loadFixture('tests/fixtures/macmillan-locating.html'));
  assert.deepEqual(typed.interactions.find((i) => i.type === 'locating')?.variants, { 'typed-correction': 2 });
});

test('Macmillan locating (choice popup) - filler opens the popup once and picks the option', async () => {
  const doc = loadFixture('tests/fixtures/macmillan-locating-choice.html');

  // Stand-in for RCF: clicking the wrong phrase TOGGLES its popup; an option only registers while the popup is open
  doc.querySelectorAll('.locating').forEach((locating) => {
    let open = false;
    locating.querySelector('.locatingItem')!.addEventListener('click', () => {
      open = !open;
    });
    locating.querySelectorAll('.locatingSpanPopup').forEach((option) =>
      option.addEventListener('click', () => {
        if (!open) return;
        locating.querySelector('.locating_answer')!.textContent = option.classList.contains('clear') ? '' : option.textContent;
        open = false;
      })
    );
  });

  const qs = extractQuestionsFromGenericDOM(doc);
  assert.equal((await fillFormField(doc, qs[0], "couldn't")).success, true);
  assert.equal((await fillFormField(doc, qs[1], 'managed to')).success, true);
  // typographic apostrophe from the AI must still match
  assert.equal((await fillFormField(doc, qs[2], 'couldn’t')).success, true);

  const answers = Array.from(doc.querySelectorAll('.locating_answer')).map((el) => el.textContent);
  assert.deepEqual(answers, ["couldn't", 'managed to', "couldn't"]);

  // An answer that is not on the list fails instead of pretending to succeed
  const bad = await fillFormField(doc, qs[0], 'is not an option');
  assert.equal(bad.success, false);
});
