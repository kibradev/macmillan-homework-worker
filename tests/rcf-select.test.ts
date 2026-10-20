import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { rcfSelectInMainWorld } from '../src/page/rcf-select';

/**
 * Runs the MAIN-world bridge against the REAL jQuery UI selectmenu widget (the one Macmillan uses),
 * so a wrong assumption about the widget's internals fails here instead of on the live page.
 */
const g = globalThis as any;
const require = createRequire(import.meta.url);

// jQuery binds to the first window it sees, so every test shares one page and resets its body.
const dom = new JSDOM('<body></body>', { pretendToBeVisual: true });
g.window = dom.window;
g.document = dom.window.document;
g.Event = dom.window.Event;
g.CSS = { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c) };
const $ = require('jquery');
g.jQuery = $;
g.$ = $;
require('jquery-ui/dist/jquery-ui.js');
(dom.window as any).$ = $;

const PAGE = `<span class="dropDown"><select id="ui-id-1" style="display:none">
  <option value="" selected></option><option value="item_1">solved</option><option value="item_2">analysed</option><option value="item_3">caused</option>
</select></span>`;

function freshPage(): JQuery_ {
  dom.window.document.body.innerHTML = PAGE;
  return $('#ui-id-1');
}
type JQuery_ = any;

function withWidget(): JQuery_ {
  const $select = freshPage();
  $select.selectmenu();
  $select.selectmenu('instance').refresh();
  return $select;
}

test('MAIN-world select - the real selectmenu widget selects the item and fires its change events', () => {
  const $select = withWidget();
  const events: string[] = [];
  $select.on('selectmenuselect selectmenuchange', (e: any) => events.push(e.type));

  const result = rcfSelectInMainWorld('ui-id-1', 2);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.viaWidget, true, `widget path not used: ${JSON.stringify(result)}`);
  assert.equal(($select[0] as HTMLSelectElement).selectedIndex, 2);
  assert.equal($('#ui-id-1-button .ui-selectmenu-text').text(), 'analysed');
  // These are the events Macmillan reacts to; a native change event alone does not produce them
  assert.deepEqual(events, ['selectmenuselect', 'selectmenuchange']);
});

test('MAIN-world select - finds the item by its option index even when the menu is rendered in a different order', () => {
  const $select = withWidget();
  // Macmillan sometimes renders the menu upside down (clear entry last)
  const ul = $('#ui-id-1-menu');
  ul.append(ul.children('li').get().reverse());

  const result = rcfSelectInMainWorld('ui-id-1', 1);

  assert.equal(result.viaWidget, true, JSON.stringify(result));
  assert.equal(($select[0] as HTMLSelectElement).selectedIndex, 1);
  assert.equal($('#ui-id-1-button .ui-selectmenu-text').text(), 'solved');
});

test('MAIN-world select - without jQuery it still selects natively and fills the visible box', () => {
  const $select = freshPage();
  $select.after('<span id="ui-id-1-button"><span class="ui-selectmenu-text"></span></span>');
  const saved = (dom.window as any).$;
  (dom.window as any).$ = undefined; // a page whose widget markup exists but whose jQuery is unreachable

  try {
    const result = rcfSelectInMainWorld('ui-id-1', 3);
    assert.equal(result.viaWidget, undefined);
    assert.equal(($select[0] as HTMLSelectElement).selectedIndex, 3);
    assert.equal(dom.window.document.querySelector('.ui-selectmenu-text')!.textContent, 'caused');
  } finally {
    (dom.window as any).$ = saved;
  }
});
