// Email Productivity assistant - Background Script

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "get-api-key") {
    chrome.storage.local.get("apiKey", (result) => {
      sendResponse({ apiKey: result.apiKey });
    });
    return true; // Required for async response
  }
});

// Initialize extension when installed
chrome.runtime.onInstalled.addListener(() => {
  // Set default settings if needed
  chrome.storage.local.get("apiKey", (result) => {
    if (!result.apiKey) {
      // For demo purposes only - in a real extension, you would not include an API key
      chrome.storage.local.set({
        apiKey: ""  // User should set their own API key
      });
    }
  });
});
