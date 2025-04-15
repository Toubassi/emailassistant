// Email Productivity assistant - Content Script
// This script monitors text input fields and provides real-time grammar and writing suggestions

// Configuration
const API_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-3.5-turbo";
const DEBOUNCE_DELAY = 2000; // Increased delay before sending text for analysis
const MIN_TEXT_LENGTH = 20; // Minimum text length to trigger analysis
const MAX_REQUESTS_PER_MINUTE = 3; // Rate limit for API requests
const RETRY_DELAY = 60000; // Delay before retrying after a rate limit error (1 minute)
const LOCAL_ANALYSIS_ENABLED = true; // Enable basic local analysis when API is unavailable

// State management
let apiKey = null;
let activeEditor = null;
let currentSuggestions = [];
let activeTooltip = null;
let statusIndicator = null;
let debounceTimer = null;
let observingEditors = new Set();
let lastRequestTime = 0;
let requestCount = 0;
let isRateLimited = false;
let rateLimitResetTimer = null;
let offlineMode = false;

// Initialize extension
function init() {
  // Get API key and settings from storage
  chrome.storage.local.get(["apiKey", "suggestionSettings", "offlineMode"], (result) => {
    apiKey = result.apiKey;
    offlineMode = result.offlineMode || false;
    
    if (!apiKey) {
      console.log("API key not found. Please set it in the extension options.");
      offlineMode = true;
    }
    
    // Start monitoring for text editors
    findAndAttachToEditors();
    
    // Set up mutation observer to detect new editors
    observeDOMForEditors();
  });
  
  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getStatistics") {
      // Count suggestions by type
      const statistics = {
        grammar: currentSuggestions.filter(s => s.type === 'GRAMMAR').length,
        clarity: currentSuggestions.filter(s => s.type === 'CLARITY').length,
        engagement: currentSuggestions.filter(s => s.type === 'ENGAGEMENT').length,
        delivery: currentSuggestions.filter(s => s.type === 'DELIVERY').length
      };
      
      sendResponse({ statistics });
    } else if (request.action === "setOfflineMode") {
      offlineMode = request.value;
      chrome.storage.local.set({ offlineMode });
      sendResponse({ success: true });
    }
    return true;
  });
}

// Find text editors in the page and attach listeners
function findAndAttachToEditors() {
  // Common selectors for text input areas
  const editorSelectors = [
    "[contenteditable=true]",
    "textarea",
    "[role=textbox]",
    "[aria-label='Message Body']",
    ".editable"
  ];
  
  const editors = document.querySelectorAll(editorSelectors.join(", "));
  
  editors.forEach(editor => {
    if (!observingEditors.has(editor)) {
      attachToEditor(editor);
      observingEditors.add(editor);
    }
  });
}

// Observe DOM for dynamically added editors
function observeDOMForEditors() {
  const observer = new MutationObserver((mutations) => {
    let shouldCheck = false;
    
    mutations.forEach(mutation => {
      if (mutation.addedNodes.length > 0) {
        shouldCheck = true;
      }
    });
    
    if (shouldCheck) {
      findAndAttachToEditors();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Attach event listeners to an editor
function attachToEditor(editor) {
  // Set relative positioning on parent for tooltip positioning
  if (editor.parentElement) {
    const computedStyle = window.getComputedStyle(editor.parentElement);
    if (computedStyle.position === 'static') {
      editor.parentElement.style.position = 'relative';
    }
  }
  
  // Add input event listener
  editor.addEventListener('input', (e) => {
    activeEditor = editor;
    
    // Clear previous timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    
    // Set new timer for analysis
    debounceTimer = setTimeout(() => {
      const text = getEditorText(editor);
      if (text && text.length >= MIN_TEXT_LENGTH) {
        if (offlineMode || isRateLimited) {
          performLocalAnalysis(text, editor);
        } else {
          analyzeText(text, editor);
        }
      }
    }, DEBOUNCE_DELAY);
  });
  
  // Add focus event listener
  editor.addEventListener('focus', () => {
    activeEditor = editor;
    
    // Create or show status indicator
    if (!statusIndicator || !document.body.contains(statusIndicator)) {
      createStatusIndicator(editor);
    } else {
      updateStatusIndicator();
    }
  });
  
  // Initial analysis if editor already has content
  const initialText = getEditorText(editor);
  if (initialText && initialText.length >= MIN_TEXT_LENGTH) {
    // Use a longer delay for initial analysis to prevent overwhelming the API
    setTimeout(() => {
      if (offlineMode || isRateLimited) {
        performLocalAnalysis(initialText, editor);
      } else {
        analyzeText(initialText, editor);
      }
    }, 3000);
  }
}

// Get text from editor (handles different editor types)
function getEditorText(editor) {
  if (editor.isContentEditable) {
    return editor.textContent;
  } else if (editor.value !== undefined) {
    return editor.value;
  }
  return '';
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

// Handle rate limiting
function handleRateLimit() {
  isRateLimited = true;
  
  // Show rate limit notification in status indicator
  if (statusIndicator) {
    statusIndicator.innerHTML = `
      <div class="gc-status-icon">⚠️</div>
      <div class="gc-status-text">API rate limited. Using basic checks.</div>
    `;
    statusIndicator.style.backgroundColor = '#fff3e0';
  }
  
  // Clear any existing reset timer
  if (rateLimitResetTimer) {
    clearTimeout(rateLimitResetTimer);
  }
  
  // Set timer to reset rate limit status
  rateLimitResetTimer = setTimeout(() => {
    isRateLimited = false;
    requestCount = 0;
    lastRequestTime = 0;
    
    // Update status indicator
    updateStatusIndicator();
    
    console.log("Rate limit reset. API requests resumed.");
  }, RETRY_DELAY);
}

// Perform basic local analysis without API
function performLocalAnalysis(text, editor) {
  // Clear previous suggestions
  clearSuggestions(editor);
  currentSuggestions = [];
  
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
  
  // Apply suggestions if any were found
  if (suggestions.length > 0) {
    currentSuggestions = suggestions;
    applySuggestions(editor, suggestions);
  }
  
  // Update status indicator
  updateStatusIndicator();
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

// Analyze text using OpenAI API
async function analyzeText(text, editor) {
  if (!apiKey) {
    console.log("API key not set. Please set it in the extension options.");
    performLocalAnalysis(text, editor);
    return;
  }
  
  // Check rate limiting
  if (!canMakeRequest()) {
    console.log("Rate limit reached. Using local analysis instead.");
    handleRateLimit();
    performLocalAnalysis(text, editor);
    return;
  }
  
  // Update status indicator to show loading state
  if (statusIndicator) {
    statusIndicator.innerHTML = `
      <div class="gc-status-icon">⏳</div>
      <div class="gc-status-text">Analyzing...</div>
    `;
    statusIndicator.style.backgroundColor = '#e3f2fd';
  }
  
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

    if (!response.ok) {
      // Handle rate limiting specifically
      if (response.status === 429) {
        console.log("API rate limited (429). Switching to local analysis.");
        handleRateLimit();
        performLocalAnalysis(text, editor);
        return;
      }
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    
    try {
      // Parse the JSON response
      const parsedContent = JSON.parse(content);
      
      if (parsedContent && parsedContent.suggestions) {
        // Clear previous suggestions
        clearSuggestions(editor);
        
        // Apply new suggestions
        currentSuggestions = parsedContent.suggestions;
        applySuggestions(editor, currentSuggestions);
        
        // Update status indicator
        updateStatusIndicator();
      } else {
        // If no suggestions or invalid format, fall back to local analysis
        performLocalAnalysis(text, editor);
      }
    } catch (parseError) {
      console.error("Failed to parse API response:", parseError);
      performLocalAnalysis(text, editor);
    }
  } catch (error) {
    console.error("Error analyzing text:", error);
    
    // Fall back to local analysis on error
    performLocalAnalysis(text, editor);
    
    // If it's a network error, set offline mode temporarily
    if (error.message.includes('Failed to fetch') || error.message.includes('Network error')) {
      offlineMode = true;
      setTimeout(() => {
        offlineMode = false;
      }, 60000); // Try again after a minute
    }
  }
}

// Apply suggestions to the editor
function applySuggestions(editor, suggestions) {
  if (!suggestions || suggestions.length === 0) return;
  
  if (editor.isContentEditable) {
    applyToContentEditable(editor, suggestions);
  } else if (editor.value !== undefined) {
    applyToTextarea(editor, suggestions);
  }
}

// Apply suggestions to contentEditable elements
function applyToContentEditable(editor, suggestions) {
  const text = editor.textContent;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  
  // Sort suggestions by their position in the text (to process from start to end)
  suggestions.sort((a, b) => {
    return text.indexOf(a.original) - text.indexOf(b.original);
  });
  
  suggestions.forEach(suggestion => {
    const index = text.indexOf(suggestion.original, lastIndex);
    if (index === -1) return; // Skip if not found
    
    // Add text before the suggestion
    if (index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.substring(lastIndex, index)));
    }
    
    // Create span for the suggestion with appropriate class
    const span = document.createElement('span');
    span.textContent = suggestion.original;
    span.className = getSuggestionClass(suggestion.type);
    span.dataset.suggestion = JSON.stringify(suggestion);
    span.addEventListener('click', handleSuggestionClick);
    
    fragment.appendChild(span);
    lastIndex = index + suggestion.original.length;
  });
  
  // Add remaining text
  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
  }
  
  // Replace editor content
  editor.innerHTML = '';
  editor.appendChild(fragment);
}

// Apply suggestions to textarea elements
function applyToTextarea(editor, suggestions) {
  // For textareas, we can't directly apply styling
  // Instead, we'll create an overlay with markers
  
  // First, ensure the editor has a positioned parent
  const editorRect = editor.getBoundingClientRect();
  const editorPosition = window.getComputedStyle(editor).position;
  
  if (editorPosition === 'static') {
    editor.style.position = 'relative';
  }
  
  // Create or get the overlay container
  let overlay = editor.nextElementSibling;
  if (!overlay || !overlay.classList.contains('gc-textarea-overlay')) {
    overlay = document.createElement('div');
    overlay.className = 'gc-textarea-overlay';
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '1';
    
    if (editor.nextSibling) {
      editor.parentNode.insertBefore(overlay, editor.nextSibling);
    } else {
      editor.parentNode.appendChild(overlay);
    }
  }
  
  // Clear existing markers
  overlay.innerHTML = '';
  
  // Add suggestion markers
  suggestions.forEach(suggestion => {
    // In a real implementation, we would calculate the exact position
    // of each suggestion in the textarea and place markers accordingly
    // This is complex and would require measuring text dimensions
    
    // For this example, we'll just add a status indicator instead
    createStatusIndicator(editor);
  });
}

// Get the appropriate CSS class for a suggestion type
function getSuggestionClass(type) {
  switch (type) {
    case 'GRAMMAR':
      return 'gc-grammar-error';
    case 'CLARITY':
      return 'gc-clarity-suggestion';
    case 'ENGAGEMENT':
      return 'gc-engagement-suggestion';
    case 'DELIVERY':
      return 'gc-delivery-suggestion';
    default:
      return 'gc-grammar-error';
  }
}

// Handle click on a suggestion
function handleSuggestionClick(e) {
  const span = e.currentTarget;
  const suggestion = JSON.parse(span.dataset.suggestion);
  
  // Remove any existing tooltip
  removeTooltip();
  
  // Create tooltip
  createTooltip(span, suggestion);
}

// Create tooltip for a suggestion
function createTooltip(element, suggestion) {
  const rect = element.getBoundingClientRect();
  const tooltip = document.createElement('div');
  tooltip.className = 'gc-tooltip';
  
  // Position the tooltip
  tooltip.style.left = `${rect.left}px`;
  tooltip.style.top = `${rect.bottom + window.scrollY + 10}px`;
  
  // Create tooltip content
  const typeClass = suggestion.type.toLowerCase();
  
  tooltip.innerHTML = `
    <div class="gc-tooltip-header">
      <div class="gc-tooltip-type ${typeClass}">${suggestion.type}</div>
    </div>
    <div class="gc-tooltip-content">
      <div class="gc-tooltip-original">${suggestion.original}</div>
      <div class="gc-tooltip-suggestion">${suggestion.suggestion}</div>
      <div class="gc-tooltip-explanation">${suggestion.explanation}</div>
    </div>
    <div class="gc-tooltip-actions">
      <button class="gc-tooltip-btn gc-tooltip-apply">Apply</button>
      <button class="gc-tooltip-btn gc-tooltip-dismiss">Dismiss</button>
    </div>
  `;
  
  // Add event listeners
  tooltip.querySelector('.gc-tooltip-apply').addEventListener('click', () => {
    applyCorrection(element, suggestion);
    removeTooltip();
  });
  
  tooltip.querySelector('.gc-tooltip-dismiss').addEventListener('click', () => {
    removeTooltip();
  });
  
  // Add tooltip to the document
  document.body.appendChild(tooltip);
  activeTooltip = tooltip;
  
  // Close tooltip when clicking outside
  document.addEventListener('click', handleOutsideClick);
}

// Handle clicks outside the tooltip
function handleOutsideClick(e) {
  if (activeTooltip && !activeTooltip.contains(e.target) && 
      e.target.className.indexOf('gc-') === -1) {
    removeTooltip();
  }
}

// Remove active tooltip
function removeTooltip() {
  if (activeTooltip) {
    activeTooltip.remove();
    activeTooltip = null;
    document.removeEventListener('click', handleOutsideClick);
  }
}

// Apply a correction
function applyCorrection(element, suggestion) {
  if (element.isContentEditable) {
    element.textContent = suggestion.suggestion;
    element.className = ''; // Remove suggestion styling
  } else if (activeEditor && activeEditor.value !== undefined) {
    // For textareas, we need to replace the text in the value
    const text = activeEditor.value;
    const index = text.indexOf(suggestion.original);
    if (index !== -1) {
      activeEditor.value = text.substring(0, index) + 
                          suggestion.suggestion + 
                          text.substring(index + suggestion.original.length);
    }
  }
  
  // Remove this suggestion from the current list
  currentSuggestions = currentSuggestions.filter(s => 
    s.original !== suggestion.original || s.suggestion !== suggestion.suggestion);
  
  // Update status indicator
  updateStatusIndicator();
}

// Clear all suggestions
function clearSuggestions(editor) {
  if (editor.isContentEditable) {
    // For contentEditable, we need to unwrap all suggestion spans
    const suggestionSpans = editor.querySelectorAll('[class^="gc-"]');
    suggestionSpans.forEach(span => {
      const text = span.textContent;
      const textNode = document.createTextNode(text);
      span.parentNode.replaceChild(textNode, span);
    });
  }
  
  currentSuggestions = [];
  updateStatusIndicator();
}

// Create status indicator
function createStatusIndicator(editor) {
  // Remove existing indicator if any
  if (statusIndicator && document.body.contains(statusIndicator)) {
    statusIndicator.remove();
  }
  
  // Create new indicator
  statusIndicator = document.createElement('div');
  statusIndicator.className = 'gc-status-indicator';
  
  // Position it near the editor
  if (editor.parentElement) {
    editor.parentElement.appendChild(statusIndicator);
  } else {
    document.body.appendChild(statusIndicator);
  }
  
  // Add click handler to show all suggestions
  statusIndicator.addEventListener('click', () => {
    if (isRateLimited) {
      alert("API rate limited. Using basic checks only. Full functionality will resume shortly.");
    } else if (offlineMode) {
      alert("Offline mode active. Using basic checks only.");
    } else if (currentSuggestions.length > 0) {
      alert(`${currentSuggestions.length} suggestions available. Click on underlined text to see suggestions.`);
    }
  });
  
  // Update the indicator content
  updateStatusIndicator();
}

// Update status indicator content
function updateStatusIndicator() {
  if (!statusIndicator || !document.body.contains(statusIndicator)) return;
  
  const count = currentSuggestions.length;
  
  if (isRateLimited) {
    statusIndicator.innerHTML = `
      <div class="gc-status-icon">⚠️</div>
      <div class="gc-status-text">Rate limited</div>
    `;
    statusIndicator.style.backgroundColor = '#fff3e0';
  } else if (offlineMode) {
    statusIndicator.innerHTML = `
      <div class="gc-status-icon">📴</div>
      <div class="gc-status-text">Offline mode</div>
    `;
    statusIndicator.style.backgroundColor = '#f5f5f5';
  } else if (count === 0) {
    statusIndicator.innerHTML = `
      <div class="gc-status-icon">✓</div>
      <div class="gc-status-text">Looking good!</div>
    `;
    statusIndicator.style.backgroundColor = '#e8f5e9';
  } else {
    statusIndicator.innerHTML = `
      <div class="gc-status-icon">!</div>
      <div class="gc-status-count">${count}</div>
      <div class="gc-status-text">suggestion${count !== 1 ? 's' : ''}</div>
    `;
    statusIndicator.style.backgroundColor = '#fff';
  }
}

// Initialize the extension
init();
