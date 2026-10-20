import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

/**
 * Loads an HTML fixture the way a live Macmillan page looks to the scanner.
 * Macmillan builds its widgets through the DOM API, so a <p> can contain block elements (<ul>/<div>),
 * which the HTML parser would otherwise split apart. Fixtures mark such paragraphs with data-as="p".
 */
export function loadFixture(path: string): Document {
  const dom = new JSDOM(readFileSync(path, 'utf8'));
  const doc = dom.window.document;
  for (const div of Array.from(doc.querySelectorAll('div[data-as="p"]'))) {
    const p = doc.createElement('p');
    while (div.firstChild) p.appendChild(div.firstChild);
    div.replaceWith(p);
  }

  const g = globalThis as any;
  g.window = dom.window;
  g.CSS = { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c) };
  for (const k of Object.getOwnPropertyNames(dom.window)) {
    if (/^(Node|Element|HTML\w*Element|ShadowRoot|Document|Event|MouseEvent|KeyboardEvent|PointerEvent|InputEvent|MutationObserver)$/.test(k)) {
      g[k] = (dom.window as any)[k];
    }
  }
  return doc;
}
