// rag-search.js - RAG search with lot selection UI (three-panel interface)
// Enhanced with conversational chat and improved reference display

// Prevent redeclaration if script is loaded multiple times
if (typeof window.RAG_SEARCH_LOADED === 'undefined') {
  window.RAG_SEARCH_LOADED = true;
  
  const API_BASE_URL = 'http://localhost:5001';
  let selectedLots = new Set();
  let allLots = [];
  let conversationHistory = []; // Store conversation for context

// Export for external access if needed
window.ragSearchState = {
  get selectedLots() { return selectedLots; },
  get conversationHistory() { return conversationHistory; },
  reset: function() {
    selectedLots.clear();
    conversationHistory = [];
  }
};

/**
 * Initialize RAG search (called when search overlay opens)
 */
async function initRAGSearch() {
  console.log('[RAG Search] Initializing RAG search...');
  
  try {
    await loadLots();
    console.log('[RAG Search] Loaded', allLots.length, 'lots');
    
    selectedLots.clear(); // Clear previous selections
    conversationHistory = []; // Reset conversation on init
    
    // Render all panels
    renderLotSelection();
    renderSearchInterface();
    renderReferences([]);
    
    // Setup event listeners for lot search input
    const lotSearchInput = document.getElementById('ragLotSearch');
    if (lotSearchInput) {
      // Remove any existing listeners by cloning and replacing
      const newInput = lotSearchInput.cloneNode(true);
      lotSearchInput.parentNode.replaceChild(newInput, lotSearchInput);
      
      // Add event listener
      newInput.addEventListener('input', handleLotSearch);
      newInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
        }
      });
    } else {
      console.warn('[RAG Search] Lot search input not found');
    }
    
    // Setup event delegation for lot selection items
    const lotSelectionPanel = document.getElementById('ragLotSelection');
    if (lotSelectionPanel) {
      // Remove existing listeners by removing and re-adding the event listener
      lotSelectionPanel.addEventListener('click', (e) => {
        const lotItem = e.target.closest('.rag-lot-item');
        if (lotItem) {
          const sessionId = lotItem.dataset.sessionId;
          if (sessionId) {
            toggleLotSelection(sessionId);
          }
        }
        
        // Handle checkbox clicks
        const checkbox = e.target.closest('input[type="checkbox"]');
        if (checkbox && checkbox.dataset.sessionId) {
          e.stopPropagation();
          toggleLotSelection(checkbox.dataset.sessionId);
        }
      });
    } else {
      console.warn('[RAG Search] Lot selection panel not found');
    }
    
    console.log('[RAG Search] Initialization complete');
  } catch (error) {
    console.error('[RAG Search] Error initializing:', error);
    // Still render empty state
    renderLotSelection();
    renderSearchInterface();
    renderReferences([]);
  }
}

/**
 * Load all lots for selection
 */
async function loadLots() {
  try {
    console.log('[RAG Search] Fetching lots from', `${API_BASE_URL}/api/history/lots`);
    const response = await fetch(`${API_BASE_URL}/api/history/lots`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('[RAG Search] Received response:', data);
    
    if (data.status === 'success') {
      allLots = data.lots || [];
      console.log('[RAG Search] Successfully loaded', allLots.length, 'lots');
    } else {
      console.error('[RAG Search] Failed to load lots:', data.error);
      allLots = [];
    }
  } catch (error) {
    console.error('[RAG Search] Error loading lots:', error);
    allLots = [];
    // Show error message in UI
    const lotSelectionPanel = document.getElementById('ragLotSelection');
    if (lotSelectionPanel) {
      lotSelectionPanel.innerHTML = `
        <div class="rag-empty">
          <p>Error loading lots: ${error.message}</p>
          <p style="font-size: 0.8rem; margin-top: 8px;">Please check if the API server is running at ${API_BASE_URL}</p>
        </div>
      `;
    }
  }
}

/**
 * Render lot selection panel (left)
 */
function renderLotSelection() {
  const lotSelectionPanel = document.getElementById('ragLotSelection');
  if (!lotSelectionPanel) {
    console.error('[RAG Search] Lot selection panel not found!');
    return;
  }
  
  console.log('[RAG Search] Rendering lot selection with', allLots.length, 'lots');
  
  if (allLots.length === 0) {
    lotSelectionPanel.innerHTML = `
      <div class="rag-lot-header">
        <h4>Select Knowledge Groups</h4>
        <p class="rag-lot-subtitle">You can select multiple knowledge groups for cross-search</p>
      </div>
      <div class="rag-empty">No processed lots available</div>
      <div class="rag-lot-footer">
        <div class="rag-usage-tips">
          <h5>Usage Tips</h5>
          <ul>
            <li>Multiple knowledge groups can be selected</li>
            <li>Get comprehensive answers with cross-search</li>
            <li>Specific questions improve accuracy</li>
            <li>Check references on the right side</li>
          </ul>
        </div>
      </div>
    `;
    return;
  }
  
  const searchInput = document.getElementById('ragLotSearch');
  const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
  
  const filteredLots = allLots.filter(lot => {
    const partNumber = (lot.part_number || '').toLowerCase();
    const manufacturer = (lot.manufacturer || '').toLowerCase();
    return partNumber.includes(searchTerm) || manufacturer.includes(searchTerm);
  });
  
  lotSelectionPanel.innerHTML = `
    <div class="rag-lot-header">
      <h4>Select Knowledge Groups</h4>
      <p class="rag-lot-subtitle">You can select multiple knowledge groups for cross-search</p>
    </div>
    <div class="rag-lot-list">
      ${filteredLots.map((lot, idx) => {
        const isSelected = selectedLots.has(lot.session_id);
        const processedDate = new Date(lot.processed_date).toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        });
        
        return `
          <div class="rag-lot-item ${isSelected ? 'selected' : ''}" data-session-id="${lot.session_id}">
            <input 
              type="checkbox" 
              ${isSelected ? 'checked' : ''} 
              data-session-id="${lot.session_id}"
            >
            <div class="rag-lot-info">
              <div class="rag-lot-name">${String.fromCharCode(9312 + idx)} ${escapeHtml(lot.part_number)}</div>
              <div class="rag-lot-meta">${escapeHtml(lot.manufacturer)} • ${processedDate}</div>
              <div class="rag-lot-docs">1 document</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
    <div class="rag-lot-footer">
      <div class="rag-usage-tips">
        <h5>Usage Tips</h5>
        <ul>
          <li>Multiple knowledge groups can be selected</li>
          <li>Get comprehensive answers with cross-search</li>
          <li>Specific questions improve accuracy</li>
          <li>Check references on the right side</li>
        </ul>
      </div>
    </div>
  `;
}

/**
 * Toggle lot selection
 */
function toggleLotSelection(sessionId) {
  if (selectedLots.has(sessionId)) {
    selectedLots.delete(sessionId);
  } else {
    selectedLots.add(sessionId);
  }
  renderLotSelection();
  updateSearchButton();
  // Clear conversation if selection changes
  if (conversationHistory.length > 0) {
    conversationHistory = [];
    renderSearchInterface();
  }
}

/**
 * Render search interface (center panel) - now conversational
 */
function renderSearchInterface() {
  const searchPanel = document.getElementById('ragSearchPanel');
  if (!searchPanel) {
    console.error('[RAG Search] Search panel not found!');
    return;
  }
  
  console.log('[RAG Search] Rendering search interface');
  
  const selectedCount = selectedLots.size;
  
  // Render conversation history
  let conversationHTML = '';
  if (conversationHistory.length > 0) {
    conversationHTML = '<div class="rag-conversation">';
    conversationHistory.forEach((msg, idx) => {
      if (msg.role === 'user') {
        conversationHTML += `
          <div class="rag-message rag-message-user">
            <div class="rag-message-content">
              ${escapeHtml(msg.content)}
            </div>
          </div>
        `;
      } else if (msg.role === 'assistant') {
        conversationHTML += `
          <div class="rag-message rag-message-assistant">
            <div class="rag-message-content">
              ${formatAnswerText(msg.content)}
            </div>
          </div>
        `;
      }
    });
    conversationHTML += '</div>';
  }
  
  searchPanel.innerHTML = `
    <div class="rag-search-header">
      <h4>Ask Questions</h4>
      <p class="rag-search-subtitle">Search across ${selectedCount} knowledge group${selectedCount !== 1 ? 's' : ''}</p>
    </div>
    ${conversationHTML}
    <div class="rag-search-input-container">
      <input 
        type="text" 
        id="ragQueryInput" 
        class="rag-query-input" 
        placeholder="Ask questions about the selected ${selectedCount} knowledge group${selectedCount !== 1 ? 's' : ''}..."
        ${selectedCount === 0 ? 'disabled' : ''}
      >
      <button 
        class="rag-search-btn" 
        id="ragSearchBtn"
        ${selectedCount === 0 ? 'disabled' : ''}
        title="Send"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
  `;
  
  // Setup event listeners for query input and button
  const queryInput = document.getElementById('ragQueryInput');
  const searchBtn = document.getElementById('ragSearchBtn');
  
  if (queryInput) {
    queryInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        performRAGSearch();
      }
    });
  }
  
  if (searchBtn) {
    searchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      performRAGSearch();
    });
  }
  
  // Scroll to bottom
  const conversationEl = searchPanel.querySelector('.rag-conversation');
  if (conversationEl) {
    conversationEl.scrollTop = conversationEl.scrollHeight;
  }
  
  updateSearchButton();
}

/**
 * Update search button state
 */
function updateSearchButton() {
  const searchBtn = document.querySelector('.rag-search-btn');
  const queryInput = document.getElementById('ragQueryInput');
  const selectedCount = selectedLots.size;
  
  if (searchBtn) {
    searchBtn.disabled = selectedCount === 0;
  }
  if (queryInput) {
    queryInput.disabled = selectedCount === 0;
    queryInput.placeholder = `Ask questions about the selected ${selectedCount} knowledge group${selectedCount !== 1 ? 's' : ''}...`;
  }
}

/**
 * Perform RAG search (conversational)
 */
async function performRAGSearch() {
  const queryInput = document.getElementById('ragQueryInput');
  const query = queryInput ? queryInput.value.trim() : '';
  
  if (!query) {
    return;
  }
  
  if (selectedLots.size === 0) {
    alert('Please select at least one knowledge group');
    return;
  }
  
  // Add user message to conversation
  conversationHistory.push({
    role: 'user',
    content: query
  });
  
  // Clear input
  if (queryInput) {
    queryInput.value = '';
  }
  
  // Re-render to show user message
  renderSearchInterface();
  
  // Show loading in answer area
  const searchPanel = document.getElementById('ragSearchPanel');
  if (searchPanel) {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'rag-message rag-message-assistant rag-loading';
    loadingDiv.innerHTML = '<div class="rag-message-content">Searching...</div>';
    searchPanel.querySelector('.rag-search-input-container').before(loadingDiv);
    searchPanel.scrollTop = searchPanel.scrollHeight;
  }
  
  // Render references as loading
  renderReferences([]);
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/history/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        lot_ids: Array.from(selectedLots),
        query: query,
        conversation_history: conversationHistory.slice(0, -1) // Exclude current query
      })
    });
    
    const data = await response.json();
    
    if (data.status === 'success') {
      // Add assistant response to conversation
      conversationHistory.push({
        role: 'assistant',
        content: data.answer,
        references: data.references || []
      });
      
      // Remove loading and render full conversation
      renderSearchInterface();
      renderReferences(data.references || []);
      
      // Focus input
      if (queryInput) {
        queryInput.focus();
      }
    } else {
      // Remove loading and show error
      conversationHistory.pop(); // Remove failed user message
      renderSearchInterface();
      const errorDiv = document.createElement('div');
      errorDiv.className = 'rag-error';
      errorDiv.textContent = `Error: ${data.error || 'Search failed'}`;
      if (searchPanel) {
        searchPanel.querySelector('.rag-search-input-container').before(errorDiv);
      }
    }
  } catch (error) {
    console.error('[RAG Search] Error performing search:', error);
    conversationHistory.pop(); // Remove failed user message
    renderSearchInterface();
    const errorDiv = document.createElement('div');
    errorDiv.className = 'rag-error';
    errorDiv.textContent = 'Error performing search. Please try again.';
    if (searchPanel) {
      searchPanel.querySelector('.rag-search-input-container').before(errorDiv);
    }
  }
}

/**
 * Format answer text (preserve line breaks, etc.)
 */
function formatAnswerText(text) {
  if (!text) return 'No answer available';
  
  // Convert markdown-style formatting to HTML
  let formatted = escapeHtml(text);
  // Preserve line breaks
  formatted = formatted.replace(/\n\n/g, '</p><p>');
  formatted = formatted.replace(/\n/g, '<br>');
  // Bold text
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Numbered lists
  formatted = formatted.replace(/^\d+\.\s+(.+)$/gm, '<strong>$1</strong>');
  
  return `<p>${formatted}</p>`;
}

/**
 * Render reference chunks (right panel) - enhanced with document ID, page, score
 */
function renderReferences(references) {
  const referencesPanel = document.getElementById('ragReferences');
  if (!referencesPanel) {
    console.error('[RAG Search] References panel not found!');
    return;
  }
  
  console.log('[RAG Search] Rendering references:', references.length);
  
  if (references.length === 0) {
    referencesPanel.innerHTML = `
      <div class="rag-references-header">
        <h4>Reference Chunks</h4>
        <p class="rag-references-subtitle">Document sections that served as the basis for the response</p>
      </div>
      <div class="rag-empty">No references available</div>
    `;
    return;
  }
  
  referencesPanel.innerHTML = `
    <div class="rag-references-header">
      <h4>Reference Chunks</h4>
      <p class="rag-references-subtitle">Document sections that served as the basis for the response</p>
    </div>
    <div class="rag-references-list">
      ${references.map((ref, idx) => {
        const docId = ref.document_id || `${ref.part_number}_${ref.lot_id?.substring(0, 8) || 'unknown'}`;
        const pageNum = ref.page !== null && ref.page !== undefined ? `Page ${ref.page}` : '';
        const score = ref.relevance_score !== undefined ? ref.relevance_score.toFixed(2) : '';
        const knowledgeGroup = ref.knowledge_group || `${ref.part_number} - ${ref.manufacturer}`;
        
        return `
          <div class="rag-reference-item">
            <div class="rag-reference-header">
              <div class="rag-reference-meta">
                <div class="rag-reference-doc-id">${escapeHtml(docId)}</div>
                ${pageNum ? `<div class="rag-reference-page">${pageNum}</div>` : ''}
                ${score ? `<div class="rag-reference-score">${score}</div>` : ''}
              </div>
              <div class="rag-reference-source">${escapeHtml(knowledgeGroup)}</div>
              <button class="rag-reference-copy" onclick="copyReference(${idx})" title="Copy">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
            <div class="rag-reference-snippet">
              ${escapeHtml(ref.snippet || 'No snippet available')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
  
  // Store references for copy function
  window.ragReferences = references;
}

/**
 * Copy reference to clipboard
 */
async function copyReference(index) {
  if (!window.ragReferences || !window.ragReferences[index]) return;
  
  const ref = window.ragReferences[index];
  const text = `${ref.document_id || ref.part_number}\n${ref.knowledge_group || ''}\nSection: ${ref.section}\n\n${ref.snippet}`;
  
  try {
    await navigator.clipboard.writeText(text);
    // Show feedback
    const btn = event?.target?.closest('.rag-reference-copy');
    if (btn) {
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      setTimeout(() => {
        btn.innerHTML = originalHTML;
      }, 1000);
    }
  } catch (error) {
    console.error('[RAG Search] Error copying reference:', error);
  }
}

/**
 * Handle lot search input
 */
function handleLotSearch() {
  renderLotSelection();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

  // Export functions for global use - do this at top level, not in IIFE
  // This ensures exports happen immediately when script loads
  if (typeof window !== 'undefined') {
    window.initRAGSearch = initRAGSearch;
    window.toggleLotSelection = toggleLotSelection;
    window.performRAGSearch = performRAGSearch;
    window.handleLotSearch = handleLotSearch;
    window.copyReference = copyReference;
    
    // Set ready flag
    window.ragSearchReady = true;
    
    // Log exports for debugging
    console.log('[RAG Search] ✓ Script loaded and functions exported to window');
    console.log('[RAG Search] initRAGSearch type:', typeof window.initRAGSearch);
    
    // Dispatch ready event
    if (typeof document !== 'undefined' && document.dispatchEvent) {
      try {
        document.dispatchEvent(new CustomEvent('ragSearchReady'));
      } catch (e) {
        console.warn('[RAG Search] Could not dispatch ready event:', e);
      }
    }
  }
} else {
  console.warn('[RAG Search] Script already loaded, skipping re-initialization');
}
