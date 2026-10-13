chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[StudyPilot] Extension installed successfully.');
  } else if (details.reason === 'update') {
    console.log('[StudyPilot] Extension updated to version:', chrome.runtime.getManifest().version);
  }
});

// Listener for background actions or cross-context requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'GET_EXTENSION_INFO') {
    sendResponse({
      version: chrome.runtime.getManifest().version,
      name: chrome.runtime.getManifest().name,
    });
    return true;
  }
  if (message.action === 'SYNC_RCF_SELECT') {
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      sendResponse({ success: false, error: 'No sender tab.' });
      return false;
    }
    chrome.scripting
      .executeScript({
        target: { tabId, frameIds: [sender.frameId ?? 0] },
        world: 'MAIN',
        args: [message.selectId, message.index ?? -1],
        func: (selectId: string, index: number) => {
          const w = window as any;
          const select = document.getElementById(selectId) as HTMLSelectElement | null;
          const info: Record<string, unknown> = { hasSelect: !!select, hasJQuery: !!w.$ };
          if (!select) return { ok: false, ...info };
          info.selectedIndex = select.selectedIndex;
          info.selectedText = select.options[select.selectedIndex]?.text;
          try {
            if (w.$) {
              const $select = w.$(select);
              const customMenu = $select.data('customRcfSelectMenu');
              info.hasCustomMenu = !!customMenu;

              // Preferred: let the jQuery UI widget select the item, so its own change/select events
              // (which Macmillan listens to for recording the answer) fire. Needs the native index untouched.
              if (index >= 0 && select.selectedIndex !== index) {
                try {
                  const inst = $select.selectmenu('instance') || customMenu;
                  const li = inst?.menuItems?.eq(index);
                  const item = li?.data('ui-selectmenu-item');
                  if (inst && item && typeof inst._select === 'function') {
                    inst._select(item, w.$.Event('click'));
                    info.viaWidget = true;
                  }
                } catch (widgetErr) {
                  info.widgetError = String(widgetErr);
                }
                if (select.selectedIndex !== index) {
                  select.selectedIndex = index;
                  info.nativeFallback = true;
                }
              }
              if (customMenu && typeof customMenu.refresh === 'function') {
                customMenu.refresh();
              } else if (typeof $select.selectmenu === 'function') {
                $select.selectmenu('refresh');
              }
              $select.trigger('change');
            }
          } catch (err) {
            info.error = String(err);
          }
          // Last resort: make sure the visible box shows the chosen option
          const textEl = document.querySelector(`#${CSS.escape(selectId)}-button .ui-selectmenu-text`);
          if (textEl && !(textEl.textContent || '').trim() && select.selectedIndex > 0) {
            textEl.textContent = select.options[select.selectedIndex].text;
            info.forcedText = true;
          }
          info.boxText = textEl?.textContent;
          return { ok: !info.error, ...info };
        },
      })
      .then((res) => sendResponse({ success: !!res[0]?.result?.ok, detail: res[0]?.result }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }
  return false;
});
