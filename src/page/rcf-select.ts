/**
 * Runs inside the page's MAIN world (chrome.scripting.executeScript with world: 'MAIN'), where Macmillan's jQuery
 * and its jQuery UI selectmenu widget live. It must stay self-contained: Chrome serializes it with toString(),
 * so it may not reference imports or module-level values.
 */
export function rcfSelectInMainWorld(selectId: string, index: number): Record<string, any> {
  const w = window as any;
  const select = document.getElementById(selectId) as HTMLSelectElement | null;
  const info: Record<string, any> = { hasSelect: !!select, hasJQuery: !!w.$ };
  if (!select) return { ok: false, ...info };

  info.selectedIndex = select.selectedIndex;
  info.selectedText = select.options[select.selectedIndex]?.text;

  try {
    if (w.$) {
      const $select = w.$(select);
      const customMenu = $select.data('customRcfSelectMenu');
      info.hasCustomMenu = !!customMenu;
      const inst = ($select.selectmenu && $select.selectmenu('instance')) || customMenu;

      // Preferred: let the widget select the item, so its own select/change events (which Macmillan listens to
      // to record the answer) fire. That only happens when the native index has not been touched yet.
      if (inst && index >= 0 && select.selectedIndex !== index) {
        try {
          if (inst.menuItems && inst.menuItems.length === 0 && typeof inst.refresh === 'function') inst.refresh();
          let item: any;
          // The item data lives on the <li>, not on the .ui-menu-item-wrapper that menuItems holds. Match by the
          // item's own option index: Macmillan can render the "clear" entry last, so DOM order is not reliable.
          inst.menuItems?.each(function (this: HTMLElement) {
            const candidate = w.$(this).parent('li').data('ui-selectmenu-item');
            if (candidate && candidate.index === index) item = candidate;
          });
          info.itemFound = !!item;
          if (item && typeof inst._select === 'function') {
            inst._select(item, w.$.Event('click'));
            info.viaWidget = true;
          }
        } catch (widgetErr) {
          info.widgetError = String(widgetErr);
        }
      }

      if (!info.viaWidget) {
        if (index >= 0 && select.selectedIndex !== index) {
          select.selectedIndex = index;
          info.nativeFallback = true;
        }
        if (customMenu && typeof customMenu.refresh === 'function') {
          customMenu.refresh();
        } else if (typeof $select.selectmenu === 'function') {
          $select.selectmenu('refresh');
        }
        $select.trigger('change');
      }
    }
  } catch (err) {
    info.error = String(err);
  }

  // No jQuery (or the widget path failed before selecting): select natively so the answer is not lost
  if (!info.viaWidget && index >= 0 && select.selectedIndex !== index) {
    select.selectedIndex = index;
    info.nativeFallback = true;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Last resort: make sure the visible box shows the chosen option
  const textEl = document.querySelector(`#${CSS.escape(selectId)}-button .ui-selectmenu-text`);
  if (textEl && !(textEl.textContent || '').trim() && select.selectedIndex > 0) {
    textEl.textContent = select.options[select.selectedIndex].text;
    info.forcedText = true;
  }
  info.boxText = textEl?.textContent;
  info.finalIndex = select.selectedIndex;
  return { ok: !info.error, ...info };
}
