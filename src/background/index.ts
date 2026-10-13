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
        args: [message.selectId],
        func: (selectId: string) => {
          const w = window as any;
          const select = document.getElementById(selectId);
          if (!select || !w.$) return { ok: false, reason: 'jQuery or select missing' };
          const $select = w.$(select);
          const customMenu = $select.data('customRcfSelectMenu');
          if (customMenu && typeof customMenu.refresh === 'function') {
            customMenu.refresh();
          } else if (typeof $select.selectmenu === 'function') {
            $select.selectmenu('refresh');
          }
          $select.trigger('change');
          return { ok: true, custom: !!customMenu };
        },
      })
      .then((res) => sendResponse({ success: !!res[0]?.result?.ok, detail: res[0]?.result }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }
  return false;
});
