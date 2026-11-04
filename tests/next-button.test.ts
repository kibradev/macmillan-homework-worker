import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findNextButton } from '../src/extractor/next-button';

const page = (html: string) => new JSDOM(`<body>${html}</body>`).window.document;

test('Next button - found by its label, with the usual wordings', () => {
  for (const html of [
    '<button>Next</button>',
    '<button>  Next   activity </button>',
    '<a href="#" role="button">Continue</a>',
    '<button aria-label="Sonraki"><svg></svg></button>',
    '<button class="btn btn-next"><svg></svg></button>',
  ]) {
    const found = findNextButton(page(`<nav>${html}</nav>`));
    assert.ok(found.element, `not found in: ${html} (${found.reason})`);
  }
});

test('Next button - never picks Previous, Submit, Check, Finish or similar', () => {
  const doc = page(`
    <button>Previous</button><button>Back</button><button>Submit</button><button>Check answers</button>
    <button>Finish</button><button>Turn in</button><button>Send</button>`);
  const found = findNextButton(doc);
  assert.equal(found.element, undefined);
  assert.match(found.reason ?? '', /Next button not found/);

  // "Next" together with a dangerous word is not a plain Next either
  assert.equal(findNextButton(page('<button>Next: submit work</button>')).element, undefined);
});

test('Next button - when several candidates exist it presses none and says so', () => {
  const found = findNextButton(page('<button>Next</button><a href="#">Next unit</a>'));
  assert.equal(found.element, undefined);
  assert.match(found.reason ?? '', /Multiple Next candidates found \(Next \| Next unit\)/);
  assert.match(found.reason ?? '', /CSS selector in Settings/);
});

test('Next button - disabled and hidden buttons do not count', () => {
  assert.equal(findNextButton(page('<button disabled>Next</button>')).element, undefined);
  assert.equal(findNextButton(page('<button aria-disabled="true">Next</button>')).element, undefined);
  assert.equal(findNextButton(page('<button hidden>Next</button>')).element, undefined);
  assert.equal(findNextButton(page('<button style="display:none">Next</button>')).element, undefined);
  // a usable one next to a hidden one is not ambiguous
  assert.ok(findNextButton(page('<button hidden>Next</button><button>Next</button>')).element);
});

test('Next button - a CSS selector from the settings replaces the search', () => {
  const doc = page('<button>Next</button><button class="go-on">Proceed</button>');

  const custom = findNextButton(doc, 'button.go-on');
  assert.equal(custom.element?.textContent, 'Proceed');

  assert.match(findNextButton(doc, 'button.missing').reason ?? '', /No button found for the selector/);
  assert.match(findNextButton(doc, 'button[[').reason ?? '', /selector in Settings is invalid/);
});

test('Next button - even a custom selector cannot point at a submit/finish button', () => {
  const doc = page('<button class="x">Submit</button><button class="y" type="submit">Go</button>');

  const byText = findNextButton(doc, 'button.x');
  assert.equal(byText.element, undefined);
  assert.match(byText.reason ?? '', /Safety policy violation/);

  const byType = findNextButton(doc, 'button.y');
  assert.equal(byType.element, undefined);
  assert.match(byType.reason ?? '', /Safety policy violation/);
});
