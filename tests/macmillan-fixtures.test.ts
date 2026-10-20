import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './fixture-loader';
import { extractQuestionsFromGenericDOM } from '../src/extractor/dom-scanner';
import { inspectRcfPage } from '../src/extractor/rcf-inspector';

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
    [['collapsibleList', 1, 'container'], ['dropDown', 4, 'supported']]
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
