// GrammarCheck Pro - Popup Script

// DOM Elements
const checkInput = document.getElementById('check-input');
const checkBtn = document.getElementById('check-btn');
const checkResults = document.getElementById('check-results');
const improveInput = document.getElementById('improve-input');
const improveType = document.getElementById('improve-type');
const improveBtn = document.getElementById('improve-btn');
const improveResults = document.getElementById('improve-results');
const settingsBtn = document.getElementById('settings-btn');
const apiStatusText = document.getElementById('api-status-text');
const apiStatusDot = document.querySelector('.status-dot');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

// Statistics elements
const grammarCount = document.getElementById('grammar-count');
const clarityCount = document.getElementById('clarity-count');
const engagementCount = document.getElementById('engagement-count');
const deliveryCount = document.getElementById('delivery-count');

// API Configuration
const API_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-3.5-turbo";
const MAX_RETRIES = 2;
const RETRY_DELAY = 2000; // 2 seconds
let apiKey = null;
let offlineMode = false;
let lastRequestTime = 0;
let requestCount = 0;
const MAX_REQUESTS_PER_MINUTE = 3;

// Initialize popup
function init() {
  // Get API key and settings from storage
  chrome.storage.local.get(["apiKey", "offlineMode"], (result) => {
    apiKey = result.apiKey;
    offlineMode = result.offlineMode || false;
    updateApiStatus();
  });
  
  // Set up event listeners
  setupEventListeners();
  
  // Get active tab statistics
  getActiveTabStatistics();
}

// Set up event listeners
function setupEventListeners() {
  // Tab switching
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.dataset.tab;
      
      // Update active tab button
      tabButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      // Update active tab panel
      tabPanels.forEach(panel => panel.classList.remove('active'));
      document.getElementById(`${tabName}-panel`).classList.add('active');
    });
  });
  
  // Check text button
  checkBtn.addEventListener('click', () => {
    const text = checkInput.value.trim();
    if (text) {
      if (offlineMode) {
        performLocalAnalysis(text);
      } else {
        analyzeText(text);
      }
    } else {
      checkResults.innerHTML = '<p>Please enter some text to check.</p>';
    }
  });
  
  // Improve writing button
  improveBtn.addEventListener('click', () => {
    const text = improveInput.value.trim();
    const toneType = improveType.value;
    
    if (text) {
      if (offlineMode) {
        showOfflineModeMessage(improveResults);
      } else {
        improveText(text, toneType);
      }
    } else {
      improveResults.innerHTML = '<p>Please enter some text to improve.</p>';
    }
  });
  
  // Settings button
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // Add offline mode toggle
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+O to toggle offline mode (hidden feature for testing)
    if (e.ctrlKey && e.shiftKey && e.key === 'O') {
      toggleOfflineMode();
    }
  });
}

// Toggle offline mode
function toggleOfflineMode() {
  offlineMode = !offlineMode;
  chrome.storage.local.set({ offlineMode });
  
  // Send message to content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { 
        action: "setOfflineMode", 
        value: offlineMode 
      });
    }
  });
  
  updateApiStatus();
  
  // Show notification
  const notification = document.createElement('div');
  notification.className = 'notification ' + (offlineMode ? 'warning' : 'success');
  notification.textContent = offlineMode ? 
    'Offline mode enabled. Using basic checks only.' : 
    'Online mode enabled. Using full API functionality.';
  
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}

// Show offline mode message
function showOfflineModeMessage(container) {
  container.innerHTML = `
    <div class="offline-message">
      <h3>Offline Mode Active</h3>
      <p>This feature requires an internet connection and API access.</p>
      <p>Currently using basic grammar checks only.</p>
      <button id="try-online-btn" class="secondary-btn">Try Online Mode</button>
    </div>
  `;
  
  document.getElementById('try-online-btn').addEventListener('click', () => {
    offlineMode = false;
    chrome.storage.local.set({ offlineMode });
    updateApiStatus();
    
    // Send message to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { 
          action: "setOfflineMode", 
          value: false 
        });
      }
    });
    
    // Show notification
    const notification = document.createElement('div');
    notification.className = 'notification success';
    notification.textContent = 'Online mode enabled. Using full API functionality.';
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  });
}

// Update API status indicator
function updateApiStatus() {
  if (offlineMode) {
    apiStatusText.textContent = 'Offline Mode';
    apiStatusDot.classList.remove('active');
    apiStatusDot.style.backgroundColor = '#ff9800'; // Orange for offline
  } else if (apiKey) {
    apiStatusText.textContent = 'Connected';
    apiStatusDot.classList.add('active');
    apiStatusDot.style.backgroundColor = '#4caf50'; // Green for connected
  } else {
    apiStatusText.textContent = 'Not Set';
    apiStatusDot.classList.remove('active');
    apiStatusDot.style.backgroundColor = '#f44336'; // Red for not set
  }
}

// Get statistics from active tab
function getActiveTabStatistics() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "getStatistics" }, (response) => {
        if (response && response.statistics) {
          updateStatistics(response.statistics);
        }
      });
    }
  });
}

// Update statistics display
function updateStatistics(statistics) {
  grammarCount.textContent = statistics.grammar || 0;
  clarityCount.textContent = statistics.clarity || 0;
  engagementCount.textContent = statistics.engagement || 0;
  deliveryCount.textContent = statistics.delivery || 0;
}

// Check if we can make an API request based on rate limits
function canMakeRequest() {
  const now = Date.now();
  
  // Reset counter if a minute has passed since first request in the window
  if (now - lastRequestTime > 60000) {
    requestCount = 0;
    lastRequestTime = now;
    return true;
  }
  
  // Check if we've exceeded our rate limit
  if (requestCount >= MAX_REQUESTS_PER_MINUTE) {
    return false;
  }
  
  // Update request count
  if (requestCount === 0) {
    lastRequestTime = now;
  }
  requestCount++;
  
  return true;
}

// Perform basic local analysis without API
function performLocalAnalysis(text) {
  // Show loading indicator
  checkResults.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
  
  setTimeout(() => {
    // Basic grammar and spelling checks
    const suggestions = [];
    
    // Common grammar errors
    const grammarPatterns = [
      { pattern: /\b(its|it's)\b/g, check: checkItsItsPair },
      { pattern: /\b(their|there|they're)\b/g, check: checkThereTheirPair },
      { pattern: /\b(your|you're)\b/g, check: checkYourYourePair },
      { pattern: /\b(to|too|two)\b/g, check: checkToTooPair },
      { pattern: /\b(affect|effect)\b/g, check: null },
      { pattern: /\b(then|than)\b/g, check: null },
      { pattern: /\ba\s+[aeiou]/gi, check: checkAAnUsage },
      { pattern: /\ban\s+[^aeiou]/gi, check: checkAAnUsage },
      { pattern: /\s\s+/g, check: checkExtraSpaces },
      { pattern: /[,.!?][A-Za-z]/g, check: checkMissingSpace },
      { pattern: /\b(i|I)\b(?![.,;:'"])/g, check: checkCapitalI }
    ];
    
    // Check for double punctuation
    const doublePunctuationMatch = text.match(/[.!?]{2,}/g);
    if (doublePunctuationMatch) {
      doublePunctuationMatch.forEach(match => {
        suggestions.push({
          type: 'GRAMMAR',
          original: match,
          suggestion: match[0],
          explanation: 'Avoid using multiple punctuation marks in formal writing.'
        });
      });
    }
    
    // Check for run-on sentences (very basic check)
    const sentences = text.split(/[.!?]+/);
    sentences.forEach(sentence => {
      const trimmed = sentence.trim();
      if (trimmed.length > 100 && trimmed.split(/\s+/).length > 20) {
        suggestions.push({
          type: 'CLARITY',
          original: trimmed,
          suggestion: trimmed,
          explanation: 'This may be a run-on sentence. Consider breaking it into smaller sentences.'
        });
      }
    });
    
    // Check for passive voice (very basic check)
    const passiveVoiceMatches = text.match(/\b(is|are|was|were|be|been|being)\s+\w+ed\b/g);
    if (passiveVoiceMatches) {
      passiveVoiceMatches.forEach(match => {
        suggestions.push({
          type: 'ENGAGEMENT',
          original: match,
          suggestion: match,
          explanation: 'Consider using active voice for more engaging writing.'
        });
      });
    }
    
    // Apply grammar pattern checks
    grammarPatterns.forEach(({ pattern, check }) => {
      const matches = text.match(pattern);
      if (matches && check) {
        matches.forEach(match => {
          const result = check(match, text);
          if (result) {
            suggestions.push(result);
          }
        });
      }
    });
    
    // Display suggestions
    if (suggestions.length > 0) {
      displaySuggestions(suggestions);
    } else {
      checkResults.innerHTML = `
        <div class="offline-message">
          <p>No issues found with basic checks.</p>
          <p class="note">Note: Using offline mode with limited functionality.</p>
        </div>
      `;
    }
    
    // Update statistics
    const statistics = {
      grammar: suggestions.filter(s => s.type === 'GRAMMAR').length,
      clarity: suggestions.filter(s => s.type === 'CLARITY').length,
      engagement: suggestions.filter(s => s.type === 'ENGAGEMENT').length,
      delivery: suggestions.filter(s => s.type === 'DELIVERY').length
    };
    
    updateStatistics(statistics);
  }, 500); // Simulate processing time
}

// Helper functions for local analysis
function checkItsItsPair(match, text) {
  // Very basic check - would need context for accuracy
  if (match === "its" && text.includes("its the")) {
    return {
      type: 'GRAMMAR',
      original: "its",
      suggestion: "it's",
      explanation: "Use 'it's' (contraction of 'it is') instead of 'its' (possessive)."
    };
  }
  return null;
}

function checkThereTheirPair(match, text) {
  // Very basic check - would need context for accuracy
  return null;
}

function checkYourYourePair(match, text) {
  // Very basic check - would need context for accuracy
  if (match === "your" && (text.includes("your welcome") || text.includes("your right"))) {
    return {
      type: 'GRAMMAR',
      original: "your",
      suggestion: "you're",
      explanation: "Use 'you're' (contraction of 'you are') instead of 'your' (possessive)."
    };
  }
  return null;
}

function checkToTooPair(match, text) {
  // Very basic check - would need context for accuracy
  return null;
}

function checkAAnUsage(match) {
  if (match.toLowerCase().startsWith('a ')) {
    const nextChar = match.charAt(2).toLowerCase();
    if ('aeiou'.includes(nextChar)) {
      return {
        type: 'GRAMMAR',
        original: match,
        suggestion: 'an' + match.substring(1),
        explanation: "Use 'an' before words that begin with a vowel sound."
      };
    }
  } else if (match.toLowerCase().startsWith('an ')) {
    const nextChar = match.charAt(3).toLowerCase();
    if (!'aeiou'.includes(nextChar)) {
      return {
        type: 'GRAMMAR',
        original: match,
        suggestion: 'a' + match.substring(2),
        explanation: "Use 'a' before words that begin with a consonant sound."
      };
    }
  }
  return null;
}

function checkExtraSpaces(match) {
  return {
    type: 'GRAMMAR',
    original: match,
    suggestion: ' ',
    explanation: 'Remove extra spaces.'
  };
}

function checkMissingSpace(match) {
  return {
    type: 'GRAMMAR',
    original: match,
    suggestion: match[0] + ' ' + match[1],
    explanation: 'Add a space after punctuation.'
  };
}

function checkCapitalI(match) {
  if (match === 'i') {
    return {
      type: 'GRAMMAR',
      original: 'i',
      suggestion: 'I',
      explanation: "The pronoun 'I' should always be capitalized."
    };
  }
  return null;
}

// Analyze text for grammar and writing issues with retry logic
async function analyzeText(text, retryCount = 0) {
  if (!apiKey) {
    checkResults.innerHTML = `
      <div class="error-message">
        <h3>API Key Not Set</h3>
        <p>Please set your OpenAI API key in the extension settings.</p>
        <button id="go-to-settings" class="primary-btn">Go to Settings</button>
      </div>
    `;
    
    document.getElementById('go-to-settings').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }
  
  // Check rate limiting
  if (!canMakeRequest() && retryCount === 0) {
    checkResults.innerHTML = `
      <div class="warning-message">
        <h3>Rate Limit Reached</h3>
        <p>Too many requests in a short period. Using basic checks instead.</p>
        <p>Full functionality will resume shortly.</p>
      </div>
    `;
    
    // Fall back to local analysis
    setTimeout(() => performLocalAnalysis(text), 500);
    return;
  }
  
  // Show loading indicator
  checkResults.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
  
  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { 
            role: "system", 
            content: `You are a writing assistant that analyzes text and provides specific suggestions to improve it.
                     Categorize each suggestion as one of these types:
                     1. GRAMMAR - for spelling, grammar, and punctuation errors
                     2. CLARITY - for unclear or wordy sentences
                     3. ENGAGEMENT - for improving engagement and impact
                     4. DELIVERY - for tone and style adjustments
                     
                     For each issue, provide:
                     - The exact problematic text
                     - The suggested correction
                     - A brief explanation
                     - The category
                     
                     Format your response as JSON:
                     {
                       "suggestions": [
                         {
                           "type": "GRAMMAR|CLARITY|ENGAGEMENT|DELIVERY",
                           "original": "exact text with issue",
                           "suggestion": "corrected text",
                           "explanation": "brief explanation"
                         }
                       ]
                     }`
          },
          { 
            role: "user", 
            content: `Analyze this text and provide specific suggestions:\n\n${text}`
          }
        ],
        max_tokens: 500  // Limit token usage to reduce API costs
      })
    });

    // Handle rate limiting
    if (response.status === 429) {
      if (retryCount < MAX_RETRIES) {
        console.log(`Rate limited. Retrying in ${RETRY_DELAY}ms... (${retryCount + 1}/${MAX_RETRIES})`);
        
        // Show retry message
        checkResults.innerHTML = `
          <div class="loading">
            <div class="loading-spinner"></div>
            <p>Rate limited. Retrying in ${RETRY_DELAY/1000}s... (${retryCount + 1}/${MAX_RETRIES})</p>
          </div>
        `;
        
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return analyzeText(text, retryCount + 1);
      } else {
        console.log("Max retries reached. Falling back to local analysis.");
        
        // Show rate limit message
        checkResults.innerHTML = `
          <div class="warning-message">
            <h3>API Rate Limited</h3>
            <p>The OpenAI API is currently rate limited. Using basic checks instead.</p>
          </div>
        `;
        
        // Fall back to local analysis
        setTimeout(() => performLocalAnalysis(text), 500);
        return;
      }
    }

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    
    try {
      // Parse the JSON response
      const parsedContent = JSON.parse(content);
      
      if (parsedContent && parsedContent.suggestions && parsedContent.suggestions.length > 0) {
        displaySuggestions(parsedContent.suggestions);
      } else {
        checkResults.innerHTML = `
          <div class="success-message">
            <h3>No Issues Found</h3>
            <p>Your text looks good! No suggestions found.</p>
          </div>
        `;
      }
    } catch (parseError) {
      console.error("Failed to parse API response:", parseError);
      checkResults.innerHTML = `
        <div class="error-message">
          <h3>Error Parsing Response</h3>
          <p>Failed to parse the API response. Please try again.</p>
          <p class="technical-details">Error: ${parseError.message}</p>
        </div>
      `;
    }
  } catch (error) {
    console.error("Error analyzing text:", error);
    
    // Check for network errors
    if (error.message.includes('Failed to fetch') || error.message.includes('Network error')) {
      checkResults.innerHTML = `
        <div class="error-message">
          <h3>Network Error</h3>
          <p>Unable to connect to the API. Check your internet connection.</p>
          <button id="try-offline-btn" class="secondary-btn">Use Offline Mode</button>
        </div>
      `;
      
      document.getElementById('try-offline-btn').addEventListener('click', () => {
        offlineMode = true;
        chrome.storage.local.set({ offlineMode });
        updateApiStatus();
        performLocalAnalysis(text);
      });
    } else {
      checkResults.innerHTML = `
        <div class="error-message">
          <h3>Error</h3>
          <p>${error.message}</p>
          <button id="retry-btn" class="primary-btn">Retry</button>
        </div>
      `;
      
      document.getElementById('retry-btn').addEventListener('click', () => {
        analyzeText(text);
      });
    }
  }
}

// Display suggestions in the results container
function displaySuggestions(suggestions) {
  if (!suggestions || suggestions.length === 0) {
    checkResults.innerHTML = '<p>No suggestions found. Your text looks good!</p>';
    return;
  }
  
  // Group suggestions by type
  const groupedSuggestions = {
    GRAMMAR: [],
    CLARITY: [],
    ENGAGEMENT: [],
    DELIVERY: []
  };
  
  suggestions.forEach(suggestion => {
    if (groupedSuggestions[suggestion.type]) {
      groupedSuggestions[suggestion.type].push(suggestion);
    } else {
      groupedSuggestions.GRAMMAR.push(suggestion);
    }
  });
  
  // Build HTML for suggestions
  let html = '';
  
  // Add each type of suggestion
  for (const [type, typeSuggestions] of Object.entries(groupedSuggestions)) {
    if (typeSuggestions.length > 0) {
      const typeClass = type.toLowerCase();
      
      typeSuggestions.forEach(suggestion => {
        html += `
          <div class="suggestion-item">
            <div class="suggestion-header">
              <div class="suggestion-type ${typeClass}">${type}</div>
            </div>
            <div class="suggestion-original">${suggestion.original}</div>
            <div class="suggestion-replacement">${suggestion.suggestion}</div>
            <div class="suggestion-explanation">${suggestion.explanation}</div>
          </div>
        `;
      });
    }
  }
  
  if (html) {
    checkResults.innerHTML = html;
  } else {
    checkResults.innerHTML = '<p>No suggestions found. Your text looks good!</p>';
  }
  
  // Update statistics
  const statistics = {
    grammar: groupedSuggestions.GRAMMAR.length,
    clarity: groupedSuggestions.CLARITY.length,
    engagement: groupedSuggestions.ENGAGEMENT.length,
    delivery: groupedSuggestions.DELIVERY.length
  };
  
  updateStatistics(statistics);
}

// Improve text based on selected tone with retry logic
async function improveText(text, toneType, retryCount = 0) {
  if (!apiKey) {
    improveResults.innerHTML = `
      <div class="error-message">
        <h3>API Key Not Set</h3>
        <p>Please set your OpenAI API key in the extension settings.</p>
        <button id="go-to-settings-improve" class="primary-btn">Go to Settings</button>
      </div>
    `;
    
    document.getElementById('go-to-settings-improve').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }
  
  // Check rate limiting
  if (!canMakeRequest() && retryCount === 0) {
    improveResults.innerHTML = `
      <div class="warning-message">
        <h3>Rate Limit Reached</h3>
        <p>Too many requests in a short period. Please try again later.</p>
      </div>
    `;
    return;
  }
  
  // Show loading indicator
  improveResults.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
  
  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { 
            role: "system", 
            content: `You are a writing assistant that improves text to match a specific tone.
                     You should rewrite the text to match the requested tone while preserving the original meaning.
                     Provide the improved version and a brief explanation of the changes made.`
          },
          { 
            role: "user", 
            content: `Improve this text to sound more ${toneType}:\n\n${text}`
          }
        ],
        max_tokens: 500  // Limit token usage to reduce API costs
      })
    });

    // Handle rate limiting
    if (response.status === 429) {
      if (retryCount < MAX_RETRIES) {
        console.log(`Rate limited. Retrying in ${RETRY_DELAY}ms... (${retryCount + 1}/${MAX_RETRIES})`);
        
        // Show retry message
        improveResults.innerHTML = `
          <div class="loading">
            <div class="loading-spinner"></div>
            <p>Rate limited. Retrying in ${RETRY_DELAY/1000}s... (${retryCount + 1}/${MAX_RETRIES})</p>
          </div>
        `;
        
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return improveText(text, toneType, retryCount + 1);
      } else {
        console.log("Max retries reached. Showing error message.");
        
        // Show rate limit message
        improveResults.innerHTML = `
          <div class="warning-message">
            <h3>API Rate Limited</h3>
            <p>The OpenAI API is currently rate limited. Please try again later.</p>
            <button id="try-offline-improve" class="secondary-btn">Use Offline Mode</button>
          </div>
        `;
        
        document.getElementById('try-offline-improve').addEventListener('click', () => {
          offlineMode = true;
          chrome.storage.local.set({ offlineMode });
          updateApiStatus();
          showOfflineModeMessage(improveResults);
        });
        return;
      }
    }

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    
    // Display the improved text
    improveResults.innerHTML = `
      <div class="improved-text">
        <h3>Improved Version (${toneType}):</h3>
        <p>${content}</p>
        <button id="copy-improved" class="secondary-btn">Copy to Clipboard</button>
      </div>
    `;
    
    document.getElementById('copy-improved').addEventListener('click', () => {
      navigator.clipboard.writeText(content).then(() => {
        const copyBtn = document.getElementById('copy-improved');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy to Clipboard';
        }, 2000);
      });
    });
  } catch (error) {
    console.error("Error improving text:", error);
    
    // Check for network errors
    if (error.message.includes('Failed to fetch') || error.message.includes('Network error')) {
      improveResults.innerHTML = `
        <div class="error-message">
          <h3>Network Error</h3>
          <p>Unable to connect to the API. Check your internet connection.</p>
          <button id="try-offline-improve-net" class="secondary-btn">Use Offline Mode</button>
        </div>
      `;
      
      document.getElementById('try-offline-improve-net').addEventListener('click', () => {
        offlineMode = true;
        chrome.storage.local.set({ offlineMode });
        updateApiStatus();
        showOfflineModeMessage(improveResults);
      });
    } else {
      improveResults.innerHTML = `
        <div class="error-message">
          <h3>Error</h3>
          <p>${error.message}</p>
          <button id="retry-improve-btn" class="primary-btn">Retry</button>
        </div>
      `;
      
      document.getElementById('retry-improve-btn').addEventListener('click', () => {
        improveText(text, toneType);
      });
    }
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', init);
