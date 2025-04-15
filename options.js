// Email Productivity assistant - Options Script

// DOM Elements
const apiKeyInput = document.getElementById('api-key');
const saveApiKeyBtn = document.getElementById('save-api-key');
const apiStatus = document.getElementById('api-status');
const saveSettingsBtn = document.getElementById('save-settings');
const settingsStatus = document.getElementById('settings-status');

// Suggestion type checkboxes
const grammarCheck = document.getElementById('grammar-check');
const clarityCheck = document.getElementById('clarity-check');
const engagementCheck = document.getElementById('engagement-check');
const deliveryCheck = document.getElementById('delivery-check');

// Initialize options page
function init() {
  // Load saved API key
  chrome.storage.local.get("apiKey", (result) => {
    if (result.apiKey) {
      // Show masked API key for security
      apiKeyInput.value = maskApiKey(result.apiKey);
    }
  });
  
  // Load saved settings
  chrome.storage.local.get("suggestionSettings", (result) => {
    if (result.suggestionSettings) {
      grammarCheck.checked = result.suggestionSettings.grammar;
      clarityCheck.checked = result.suggestionSettings.clarity;
      engagementCheck.checked = result.suggestionSettings.engagement;
      deliveryCheck.checked = result.suggestionSettings.delivery;
    }
  });
  
  // Set up event listeners
  setupEventListeners();
}

// Set up event listeners
function setupEventListeners() {
  // Save API key button
  saveApiKeyBtn.addEventListener('click', saveApiKey);
  
  // Save settings button
  saveSettingsBtn.addEventListener('click', saveSettings);
  
  // Clear status messages when inputs change
  apiKeyInput.addEventListener('input', () => {
    apiStatus.style.display = 'none';
  });
  
  [grammarCheck, clarityCheck, engagementCheck, deliveryCheck].forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      settingsStatus.style.display = 'none';
    });
  });
}

// Save API key to storage
function saveApiKey() {
  const apiKey = apiKeyInput.value.trim();
  
  // Check if the API key is masked (unchanged)
  if (apiKey.includes('*')) {
    showStatus(apiStatus, 'Please enter a new API key or use the current one.', 'error');
    return;
  }
  
  // Validate API key format (basic check)
  if (!apiKey.startsWith('sk-') || apiKey.length < 10) {
    showStatus(apiStatus, 'Invalid API key format. Please enter a valid OpenAI API key.', 'error');
    return;
  }
  
  // Save API key to storage
  chrome.storage.local.set({ apiKey }, () => {
    showStatus(apiStatus, 'API key saved successfully!', 'success');
    
    // Mask the API key for security
    apiKeyInput.value = maskApiKey(apiKey);
  });
}

// Save suggestion settings to storage
function saveSettings() {
  const suggestionSettings = {
    grammar: grammarCheck.checked,
    clarity: clarityCheck.checked,
    engagement: engagementCheck.checked,
    delivery: deliveryCheck.checked
  };
  
  // Save settings to storage
  chrome.storage.local.set({ suggestionSettings }, () => {
    showStatus(settingsStatus, 'Settings saved successfully!', 'success');
  });
}

// Show status message
function showStatus(element, message, type) {
  element.textContent = message;
  element.className = 'status-message ' + type;
  element.style.display = 'block';
  
  // Hide status message after 3 seconds
  setTimeout(() => {
    element.style.display = 'none';
  }, 3000);
}

// Mask API key for security
function maskApiKey(apiKey) {
  if (!apiKey) return '';
  
  // Show first 3 and last 4 characters, mask the rest
  const firstPart = apiKey.substring(0, 3);
  const lastPart = apiKey.substring(apiKey.length - 4);
  const maskedPart = '*'.repeat(apiKey.length - 7);
  
  return firstPart + maskedPart + lastPart;
}

// Initialize options page when DOM is loaded
document.addEventListener('DOMContentLoaded', init);
