import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './fixture-loader';
import { extractQuestionsFromGenericDOM } from '../src/extractor/dom-scanner';
import { inspectRcfPage, snapshotRcfActivity } from '../src/extractor/rcf-inspector';
import { buildQuestionsPrompt } from '../src/ai/base';
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

  // A single gap inside a numbered passage uses the passage's number too, so prompt and context agree
  assert.equal(qs[4].promptText, "Amber: So that's why you were [BLANK 5] them? (Answer ONLY for [BLANK 5])");

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
  // Passage == prompt, so the context carries only the instructions and the single-use rule, not the paragraph again
  assert.equal(
    qs[0].contextText,
    '[Instructions]: Complete the blog post with suitable words.\n\n[Note: each word in the word bank can be used only once.]'
  );
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
    if (!picked) return;
    gap8.setAttribute('data-filled', picked);
    gap8.querySelector('.dragTarget')!.textContent = picked; // what the learner sees in the gap
    picked = '';
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

test('Macmillan dropdown email - every gap is found with its sentence and the full text as context', () => {
  const doc = loadFixture('tests/fixtures/macmillan-dropdown-email.html');
  const qs = extractQuestionsFromGenericDOM(doc);

  assert.equal(qs.length, 4);
  assert.deepEqual(qs.map((q) => q.fields[0].selector), ['#ui-id-1', '#ui-id-2', '#ui-id-4', '#ui-id-7']);
  assert.deepEqual(qs[2].options?.map((o) => o.label), ['come up with', 'deal with', 'agree on']);

  // Two gaps share one paragraph: blanks are numbered and each question names the one it is about
  assert.match(qs[0].promptText, /^I've \[BLANK 3\] the data from our customer satisfaction survey/);
  assert.match(qs[0].promptText, /problems we need to \[BLANK 4\]\. Here are some examples: \(Answer ONLY for \[BLANK 3\]\)$/);
  assert.match(qs[1].promptText, /\(Answer ONLY for \[BLANK 4\]\)$/);
  assert.notEqual(qs[0].promptText, qs[1].promptText);
  assert.equal(qs[2].promptText, 'How can we [_____] the issue of late deliveries?');

  // The whole email travels as context (subject line, greeting...), with gaps masked
  for (const q of qs) {
    assert.match(q.contextText ?? '', /^\[Full text\]: To: Marketing team/);
    assert.match(q.contextText ?? '', /Subject: Speedy Deliveries Customer Satisfaction Survey/);
    assert.match(q.contextText ?? '', /\[_____\] we meet on Friday afternoon at 4pm\./);
  }

  assert.equal(inspectRcfPage(doc).questionsDetected, 4);
});

test('Macmillan dropdown - the filler selects the real option, never the empty first entry', async () => {
  const doc = loadFixture('tests/fixtures/macmillan-dropdown-email.html');
  (globalThis as any).chrome = { runtime: { sendMessage: async () => null } }; // no page bridge in this test
  const qs = extractQuestionsFromGenericDOM(doc);
  const selectOf = (q: (typeof qs)[number]) => doc.querySelector(q.fields[0].selector) as HTMLSelectElement;

  // Every gap starts on the empty "clear" entry, whose text is '' — and 'anything'.includes('') is true
  assert.equal((await fillFormField(doc, qs[0], 'analysed')).success, true);
  assert.equal(selectOf(qs[0]).selectedIndex, 2);
  assert.equal(selectOf(qs[0]).options[selectOf(qs[0]).selectedIndex].text, 'analysed');

  assert.equal((await fillFormField(doc, qs[1], 'come up with')).success, true);
  assert.equal(selectOf(qs[1]).options[selectOf(qs[1]).selectedIndex].text, 'come up with');

  // Close options: "solve" must not be mistaken for "solved" (or the other way round)
  assert.equal((await fillFormField(doc, qs[3], 'solve')).success, true);
  assert.equal(selectOf(qs[3]).options[selectOf(qs[3]).selectedIndex].text, 'solve');
  assert.equal((await fillFormField(doc, qs[0], 'solved')).success, true);
  assert.equal(selectOf(qs[0]).options[selectOf(qs[0]).selectedIndex].text, 'solved');

  // Typographic and case differences from the AI still match
  assert.equal((await fillFormField(doc, qs[2], 'Deal  With')).success, true);
  assert.equal(selectOf(qs[2]).options[selectOf(qs[2]).selectedIndex].text, 'deal with');

  // An answer that matches nothing must fail, not fall back to the empty entry
  const before = selectOf(qs[2]).selectedIndex;
  assert.equal((await fillFormField(doc, qs[2], 'banana split')).success, false);
  assert.equal(selectOf(qs[2]).selectedIndex, before);
});

test('Macmillan reading activity - the reading text (hidden in a sliding panel) is passed to the AI', () => {
  const doc = loadFixture('tests/fixtures/macmillan-reading-radio.html');
  const [q] = extractQuestionsFromGenericDOM(doc);

  assert.equal(q.type, 'multiple_choice');
  assert.equal(q.promptText, "What is the writer's opinion?");
  assert.equal(q.options?.length, 3);

  const context = q.contextText ?? '';
  assert.match(context, /^\[Instructions\]: Read the text and answer the question\./);
  assert.match(context, /\[Reading text\]:\n/, `no reading text in context: ${JSON.stringify(context.slice(0, 80))}`);
  assert.match(context, /three-quarters of all scientific research is published in English/);
  assert.match(context, /which language should we discuss it\?!/);
  // Paragraphs stay separate, and the panel's own buttons ("Read", "Close") are not part of the text
  assert.match(context, /bad thing\?\nBut could the dominance of English/);
  assert.doesNotMatch(context, /Close/);

  const report = inspectRcfPage(doc);
  assert.equal(report.context.readingFound, true);
  assert.equal(report.interactions.find((i) => i.type === 'slidingBlock')?.status, 'passive');
});

test('AI prompt - a context shared by several questions is sent once, unique contexts stay with their question', () => {
  const doc = loadFixture('tests/fixtures/macmillan-dropdown-email.html');
  const qs = extractQuestionsFromGenericDOM(doc);
  const prompt = buildQuestionsPrompt(qs);

  // The whole email (4 questions share it) appears exactly once, in a shared block
  assert.equal(prompt.split('Subject: Speedy Deliveries Customer Satisfaction Survey').length - 1, 1);
  assert.match(prompt, /\[Shared context for questions q_1, q_2, q_3, q_4\]/);
  assert.ok(qs.every((q) => prompt.includes(`"questionId": "${q.id}"`)));
  assert.equal((prompt.match(/"context": null/g) ?? []).length, 4);

  // A single question keeps its context inline (nothing to share)
  const [only] = extractQuestionsFromGenericDOM(loadFixture('tests/fixtures/macmillan-reading-radio.html'));
  const single = buildQuestionsPrompt([only]);
  assert.doesNotMatch(single, /Shared context/);
  assert.match(single, /"context": "\[Instructions\]: Read the text and answer the question\.\\n\\n\[Reading text\]:/);
});

test('Macmillan reading + rhetorical questions - instructions and reading text reach the AI, prompt shows both once', () => {
  const doc = loadFixture('tests/fixtures/macmillan-reading-rhetorical.html');
  const qs = extractQuestionsFromGenericDOM(doc);

  assert.equal(qs.length, 3);
  assert.deepEqual(qs.map((q) => q.promptText), [
    '… but is the dominance of English in the sciences a bad thing?',
    'Has English always dominated in the sciences?',
    '… what are the benefits for scientists of communicating mainly through English?',
  ]);
  assert.deepEqual(qs[0].options?.map((o) => o.label), ['Yes', 'No', "The writer doesn't answer this."]);

  // The task description is what makes these one-line questions answerable
  for (const q of qs) {
    assert.match(q.contextText ?? '', /^\[Instructions\]: Look at the rhetorical questions from the text\./);
    assert.match(q.contextText ?? '', /\[Reading text\]:\nIt's becoming more and more important/);
  }

  // Same instructions + text for all questions: sent once
  const prompt = buildQuestionsPrompt(qs);
  assert.equal(prompt.split('three-quarters of all scientific research').length - 1, 1);
  assert.equal(prompt.split('Look at the rhetorical questions').length - 1, 1);
  assert.match(prompt, /\[Shared context for questions q_1, q_2, q_3\]/);

  assert.equal(inspectRcfPage(doc).context.readingFound, true);
  assert.deepEqual(inspectRcfPage(doc).warnings, []);
});

test('Macmillan choice answers - an exact option wins over a partial match ("No" is not "The writer doesn\'t answer this.")', async () => {
  const doc = loadFixture('tests/fixtures/macmillan-reading-rhetorical.html');
  // Stand-in for RCF: clicking a chip selects it and deselects its group
  doc.querySelectorAll('[role="radio"]').forEach((chip) =>
    chip.addEventListener('click', () => {
      chip.parentElement!.querySelectorAll('[role="radio"]').forEach((c) => c.setAttribute('aria-checked', String(c === chip)));
    })
  );
  const qs = extractQuestionsFromGenericDOM(doc);
  const picked = (n: number) =>
    Array.from(doc.querySelectorAll(`#radio_${n} [role="radio"]`)).findIndex((c) => c.getAttribute('aria-checked') === 'true');

  assert.equal((await fillFormField(doc, qs[0], 'No')).success, true);
  assert.equal(picked(1), 1);
  assert.equal((await fillFormField(doc, qs[1], 'Yes')).success, true);
  assert.equal(picked(2), 0);
  assert.equal((await fillFormField(doc, qs[1], "The writer doesn't answer this.")).success, true);
  assert.equal(picked(2), 2);
  // An answer sentence that merely contains "no" must not select the "No" chip
  assert.equal((await fillFormField(doc, qs[0], 'Not enough information to say')).success, false);
  assert.equal(picked(1), 1, 'a non-matching answer must leave the previous choice alone');
});

// ---------------------------------------------------------------------------------------------------------------
// Ordering (jQuery UI sortable)

/** Stand-in for a sortable: items sit in a row (100px each); dropping a dragged item re-inserts it beside the nearest one. */
function makeSortable(doc: Document) {
  doc.querySelectorAll('ul.rcfOrderingContainer').forEach((ul) => {
    const rectOf = (li: Element) => {
      const i = Array.from(li.parentElement!.children).indexOf(li);
      return { left: i * 100, top: 0, width: 100, height: 30, right: i * 100 + 100, bottom: 30, x: i * 100, y: 0, toJSON() {} } as DOMRect;
    };
    ul.querySelectorAll('li').forEach((li) => ((li as any).getBoundingClientRect = () => rectOf(li)));

    let dragged: HTMLElement | null = null;
    ul.addEventListener('mousedown', (e) => {
      const li = (e.target as Element).closest('li') as HTMLElement | null;
      dragged = li && !li.classList.contains('fixed') ? li : null; // fixed items cannot be dragged
    });
    doc.addEventListener('mouseup', (e) => {
      if (!dragged) return;
      const others = Array.from(ul.children).filter((c) => c !== dragged && !c.classList.contains('fixed')) as HTMLElement[];
      const x = (e as MouseEvent).clientX;
      const nearest = others.reduce((best, el) => {
        const r = el.getBoundingClientRect();
        const rb = best.getBoundingClientRect();
        return Math.abs(r.left + r.width / 2 - x) < Math.abs(rb.left + rb.width / 2 - x) ? el : best;
      });
      const r = nearest.getBoundingClientRect();
      if (x > r.left + r.width / 2) nearest.after(dragged);
      else nearest.before(dragged);
      dragged = null;
    });
  });
}

const sentence = (doc: Document, n: number) =>
  Array.from(doc.querySelectorAll(`[data-rcfid="ordering_${n}"] li`)).map((li) => li.textContent!.trim());

test('Macmillan ordering - words, fixed items and a selector per word; the answer key in the markup is never read', () => {
  const doc = loadFixture('tests/fixtures/macmillan-ordering.html');
  const qs = extractQuestionsFromGenericDOM(doc);

  assert.equal(qs.length, 4);
  assert.ok(qs.every((q) => q.type === 'ordering'));

  // Words come in the jumbled DOM order, NOT in the authored order hidden in data-origindex
  assert.deepEqual(qs[0].options?.map((o) => o.label), ['me', 'a', 'hand', 'mind', 'Would', 'you', 'giving']);
  assert.match(qs[0].promptText, /me \/ a \/ hand \/ mind \/ Would \/ you \/ giving/);
  assert.match(qs[0].promptText, /"\?" ends the sentence/);

  // A fixed first word is announced and not offered as a movable word
  assert.deepEqual(qs[2].options?.map((o) => o.label), ['you', "wouldn't", 'awesome', 'be', 'would', 'mind, that']);
  assert.match(qs[2].promptText, /"If" is the first word; "\." ends the sentence/);

  // The same word twice ("you ... you") gives two separate options
  assert.equal(qs[1].options?.filter((o) => o.label === 'you').length, 2);

  // item_N repeats in every list: selectors must resolve to exactly one element, in their own list
  qs.forEach((q, i) => {
    for (const o of q.options ?? []) {
      assert.equal(doc.querySelectorAll(o.elementSelector!).length, 1, o.elementSelector);
      assert.ok(doc.querySelector(o.elementSelector!)?.closest(`[data-rcfid="ordering_${i + 1}"]`));
    }
  });

  const text = JSON.stringify(qs);
  assert.doesNotMatch(text, /origindex|showanswer|data-rank|user-answer/);

  const report = inspectRcfPage(doc);
  assert.equal(report.interactions.find((i) => i.type === 'ordering')?.status, 'supported');
  assert.equal(report.questionsDetected, 4);
  assert.deepEqual(report.warnings, []);
});

test('Macmillan ordering - the filler drags every word into place and leaves fixed items alone', async () => {
  const doc = loadFixture('tests/fixtures/macmillan-ordering.html');
  makeSortable(doc);
  const qs = extractQuestionsFromGenericDOM(doc);

  assert.equal((await fillFormField(doc, qs[0], ['Would', 'you', 'mind', 'giving', 'me', 'a', 'hand'].join(MULTI_ANSWER_SEPARATOR))).success, true);
  assert.deepEqual(sentence(doc, 1), ['Would', 'you', 'mind', 'giving', 'me', 'a', 'hand', '?']);

  // A repeated word: both "you" elements end up in their own slot
  const dup = await fillFormField(doc, qs[1], ['Do', 'you', 'think', 'you', 'could', 'help', 'me', 'out'].join(' || '));
  assert.equal(dup.success, true, dup.error);
  assert.deepEqual(sentence(doc, 2), ['Do', 'you', 'think', 'you', 'could', 'help', 'me', 'out', '?']);

  // A fixed first word stays first; "mind, that" is one item; typographic/case differences from the AI are fine
  const fixed = await fillFormField(doc, qs[2], ['You', 'wouldn’t', 'MIND, THAT', 'would', 'be', 'awesome'].join(' || '));
  assert.equal(fixed.success, true, fixed.error);
  assert.deepEqual(sentence(doc, 3), ['If', 'you', "wouldn't", 'mind, that', 'would', 'be', 'awesome', '.']);
});

test('Macmillan ordering - an answer that does not fit the words is refused and the list is left untouched', async () => {
  const doc = loadFixture('tests/fixtures/macmillan-ordering.html');
  makeSortable(doc);
  const qs = extractQuestionsFromGenericDOM(doc);
  const before = sentence(doc, 4);

  const tooShort = await fillFormField(doc, qs[3], 'I || need || a');
  assert.equal(tooShort.success, false);
  assert.match(tooShort.error ?? '', /4 kelime bekleniyordu ama cevapta 3 var/);

  const stranger = await fillFormField(doc, qs[3], 'I || need || a || banana');
  assert.equal(stranger.success, false);
  assert.match(stranger.error ?? '', /"banana" listedeki kelimelerden biri değil/);

  assert.deepEqual(sentence(doc, 4), before);
});

test('Macmillan ordering - a list that ignores the drag is reported as a failure, not as success', async () => {
  const doc = loadFixture('tests/fixtures/macmillan-ordering.html'); // no sortable behind it: nothing moves
  doc.querySelectorAll('ul.rcfOrderingContainer li').forEach((li) => ((li as any).getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 30 })));
  const qs = extractQuestionsFromGenericDOM(doc);

  const result = await fillFormField(doc, qs[3], 'I || need || a || favour');

  assert.equal(result.success, false);
  assert.match(result.error ?? '', /Kelimeler sürüklenemedi\. Şu anki sıra: need I a favour \./);
});

test('Mixed activity - question ids stay unique when several kinds of question share a page', () => {
  const doc = loadFixture('tests/fixtures/macmillan-ordering.html');
  // A dropdown gap next to the ordering lists: both blocks count from 1 on their own
  doc
    .querySelector('.mm_interactive')!
    .insertAdjacentHTML(
      'afterbegin',
      '<p>She <span class="dropDown" data-rcfid="dropDown_1" data-rcfinteraction="dropDown"><select id="x-1"><option value=""></option><option value="a">went</option><option value="b">goed</option></select></span> home.</p>'
    );

  const qs = extractQuestionsFromGenericDOM(doc);
  const ids = qs.map((q) => q.id);

  assert.equal(qs.length, 5);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.join(', ')}`);
  // Each id still resolves to the right question
  assert.equal(qs.find((q) => q.type === 'dropdown')?.options?.[0].label, 'went');
  assert.equal(qs.filter((q) => q.type === 'ordering').length, 4);
});

// ---------------------------------------------------------------------------------------------------------------
// Click-and-stick phrases in a listening dialogue

/**
 * Stand-in for RCF's click-and-stick: clicking a bank item picks it; clicking a gap places the picked item there.
 * Clicking a gap that holds a word (and nothing is picked) takes the word back, exactly like the real thing.
 */
function makeClickAndStick(doc: Document, options: { ignoreClicks?: boolean } = {}) {
  let picked: HTMLElement | null = null;
  const release = (slot: HTMLElement) => {
    doc.querySelectorAll('.wordBox li.dragItem').forEach((li) => {
      if ((li as HTMLElement).dataset.rcfid === slot.dataset.word) li.classList.remove('dragged');
    });
    slot.textContent = '';
    slot.classList.remove('populated');
    delete slot.dataset.word;
  };
  doc.querySelectorAll('.wordBox li.dragItem').forEach((li) =>
    li.addEventListener('click', () => {
      if (options.ignoreClicks || li.classList.contains('dragged')) return;
      picked = picked === li ? null : (li as HTMLElement);
    })
  );
  doc.querySelectorAll('[data-rcfinteraction="complexDroppable"]').forEach((gap) =>
    gap.addEventListener('click', () => {
      if (options.ignoreClicks) return;
      const slot = gap.querySelector('.dragTarget') as HTMLElement;
      if (picked) {
        if (slot.textContent) release(slot);
        slot.textContent = picked.textContent;
        slot.classList.add('populated');
        slot.dataset.word = picked.dataset.rcfid;
        picked.classList.add('dragged');
        picked = null;
      } else if (slot.textContent) {
        release(slot);
      }
    })
  );
  return {
    slot: (n: number) => doc.querySelector(`[data-rcfid="complexDroppable_${n}"] .dragTarget`) as HTMLElement,
  };
}

test('Macmillan listening drag-and-drop - gaps are numbered like the passage, with transcript and instructions as context', () => {
  const doc = loadFixture('tests/fixtures/macmillan-dragdrop-phrases.html');
  const qs = extractQuestionsFromGenericDOM(doc);

  assert.equal(qs.length, 3);
  assert.deepEqual(qs[0].options?.map((o) => o.label), ['It turns out', "You'll never guess", "Really? You're kidding"]);

  // One gap per paragraph, but the passage numbers every gap, so the prompt must use the same numbers
  assert.equal(qs[0].promptText, 'Burak: [BLANK 1] who I saw last night! (Answer ONLY for [BLANK 1])');
  assert.equal(qs[2].promptText, 'Burak: Well, he was! But now he lives round the corner! [BLANK 3] that he was going to the same concert as me. (Answer ONLY for [BLANK 3])');

  const context = qs[0].contextText ?? '';
  assert.match(context, /^\[Instructions\]: Listen and complete the conversation/);
  assert.match(context, /Burak: \[BLANK 1\] who I saw last night!/);
  assert.match(context, /\[Audio Transcript \/ Tapescript\]:\nBurak: You’ll never guess who I saw last night!\nTeresa: Who\?/);
  assert.match(context, /only once/);
});

test('Macmillan click-and-stick - a gap is clicked exactly once, so the placed phrase is not taken back', async () => {
  const doc = loadFixture('tests/fixtures/macmillan-dragdrop-phrases.html');
  const rcf = makeClickAndStick(doc);
  const qs = extractQuestionsFromGenericDOM(doc);

  const first = await fillFormField(doc, qs[0], 'You’ll never guess'); // typographic apostrophe from the AI
  assert.equal(first.success, true, first.error);
  assert.equal(rcf.slot(1).textContent, "You'll never guess");

  assert.equal((await fillFormField(doc, qs[1], "Really? You're kidding")).success, true);
  assert.equal(rcf.slot(2).textContent, "Really? You're kidding");
  assert.equal(rcf.slot(1).textContent, "You'll never guess", 'earlier gaps stay filled');
});

test('Macmillan click-and-stick - running a gap that is already right changes nothing', async () => {
  const doc = loadFixture('tests/fixtures/macmillan-dragdrop-phrases.html');
  const rcf = makeClickAndStick(doc);
  const qs = extractQuestionsFromGenericDOM(doc);

  assert.equal((await fillFormField(doc, qs[0], "You'll never guess")).success, true);
  // A second Auto-Pilot run: a naive click on the filled gap would take the phrase back out
  assert.equal((await fillFormField(doc, qs[0], "You'll never guess")).success, true);

  assert.equal(rcf.slot(1).textContent, "You'll never guess");
  assert.ok(rcf.slot(1).classList.contains('populated'));
});

test('Macmillan click-and-stick - a gap holding a different phrase is corrected and the old phrase goes back to the bank', async () => {
  const doc = loadFixture('tests/fixtures/macmillan-dragdrop-phrases.html');
  const rcf = makeClickAndStick(doc);
  const qs = extractQuestionsFromGenericDOM(doc);

  await fillFormField(doc, qs[0], 'It turns out'); // wrong on purpose
  assert.equal(rcf.slot(1).textContent, 'It turns out');

  const fixed = await fillFormField(doc, qs[0], "You'll never guess");
  assert.equal(fixed.success, true, fixed.error);
  assert.equal(rcf.slot(1).textContent, "You'll never guess");
  const bankItem = doc.querySelector('[data-rcfid="cd_3"]')!;
  assert.equal(bankItem.classList.contains('dragged'), false, 'the replaced phrase is available again');
});

test('Macmillan click-and-stick - a phrase that is not in the bank, or a page that ignores the clicks, is a failure', async () => {
  const doc = loadFixture('tests/fixtures/macmillan-dragdrop-phrases.html');
  const rcf = makeClickAndStick(doc);
  const qs = extractQuestionsFromGenericDOM(doc);
  assert.equal((await fillFormField(doc, qs[0], 'Once upon a time')).success, false);
  assert.equal(rcf.slot(1).textContent, '');

  const deaf = loadFixture('tests/fixtures/macmillan-dragdrop-phrases.html');
  makeClickAndStick(deaf, { ignoreClicks: true });
  const result = await fillFormField(deaf, extractQuestionsFromGenericDOM(deaf)[0], "You'll never guess");
  assert.equal(result.success, false, 'success must be verified, not assumed');
});
