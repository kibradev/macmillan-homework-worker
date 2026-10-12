chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[StudyPilot] Extension installed successfully.');
  } else if (details.reason === 'update') {
    console.log('[StudyPilot] Extension updated to version:', chrome.runtime.getManifest().version);
  }
});

// Listener for background actions or cross-context requests
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'GET_EXTENSION_INFO') {
    sendResponse({
      version: chrome.runtime.getManifest().version,
      name: chrome.runtime.getManifest().name,
    });
    return true;
  }
  return false;
});
