// dashboard.js — simplified: animate bar fills only
// Check if user is logged in using Supabase

// Load Supabase config first
async function checkAuth() {
  // Check Supabase session if available
  if (typeof supabase !== 'undefined') {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  } else {
    // Fallback to localStorage check
    const isLoggedIn = localStorage.getItem('authentIC_loggedIn');
    if (isLoggedIn !== 'true') {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  }
}

// Setup logout handler immediately (before auth check)
function setupLogout() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        console.log('Logout clicked');
        // Sign out from Supabase if available
        if (typeof supabase !== 'undefined') {
          await supabase.auth.signOut();
        }
        // Clear localStorage
        localStorage.removeItem('authentIC_loggedIn');
        localStorage.removeItem('authentIC_userType');
        localStorage.removeItem('authentIC_companyId');
        // Redirect to login
        window.location.href = 'login.html';
      } catch (error) {
        console.error('Logout error:', error);
        // Still redirect even if there's an error
        localStorage.clear();
        window.location.href = 'login.html';
      }
    });
  }
}

// Setup search overlay functionality
function setupSearchOverlay() {
  const searchChatsBtn = document.getElementById('searchChatsBtn');
  const searchOverlay = document.getElementById('searchOverlay');
  const closeSearchBtn = document.getElementById('closeSearchBtn');
  const searchChatInput = document.getElementById('searchChatInput');
  const searchResults = document.getElementById('searchResults');

  if (!searchChatsBtn || !searchOverlay || !closeSearchBtn || !searchChatInput || !searchResults) {
    console.log('[Dashboard] Search overlay elements not found');
    return;
  }

  // Open search overlay
  searchChatsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    console.log('[Dashboard] Opening search overlay');
    searchOverlay.style.display = 'flex';
    setTimeout(() => {
      searchChatInput.focus();
    }, 100);
    // Load all chats for search
    performSearch('');
  });

  // Close search overlay
  function closeSearchOverlay() {
    searchOverlay.style.display = 'none';
    searchChatInput.value = '';
    searchResults.innerHTML = '';
  }

  closeSearchBtn.addEventListener('click', closeSearchOverlay);

  // Close on overlay background click
  searchOverlay.addEventListener('click', (e) => {
    if (e.target === searchOverlay) {
      closeSearchOverlay();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchOverlay.style.display === 'flex') {
      closeSearchOverlay();
    }
  });

  // Perform search as user types
  searchChatInput.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    performSearch(query);
  });

  // Perform search function
  async function performSearch(query) {
    console.log('[Dashboard] Performing search with query:', query);
    
    try {
      // Get all chats from Supabase
      let allChats = [];
      
      if (typeof chatService !== 'undefined') {
        try {
          allChats = await chatService.getUserChats();
          console.log('[Dashboard] Loaded', allChats.length, 'chats from Supabase');
        } catch (error) {
          console.error('[Dashboard] Error loading chats from Supabase:', error);
        }
      }

      // Filter chats based on query
      const filteredChats = query === '' 
        ? allChats 
        : allChats.filter(chat => 
            chat.title.toLowerCase().includes(query)
          );

      // Render results
      renderSearchResults(filteredChats);
    } catch (error) {
      console.error('[Dashboard] Error performing search:', error);
      searchResults.innerHTML = '<div class="search-result-item"><div class="search-result-item-title">Error loading chats</div></div>';
    }
  }

  // Render search results
  function renderSearchResults(chats) {
    if (chats.length === 0) {
      searchResults.innerHTML = '<div class="search-result-item"><div class="search-result-item-title" style="color: var(--muted);">No chats found</div></div>';
      return;
    }

    searchResults.innerHTML = chats.map(chat => {
      const time = chatService && chat.updated_at 
        ? chatService.formatTime(chat.updated_at)
        : 'Recently';
      
      return `
        <div class="search-result-item" data-chat-id="${chat.id}" onclick="window.location.href='query.html?chatId=${chat.id}'">
          <div class="search-result-item-title">${escapeHtml(chat.title || 'Untitled Chat')}</div>
          <div class="search-result-item-time">${time}</div>
        </div>
      `;
    }).join('');
  }

  // Helper function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Setup language dropdown immediately (doesn't need auth)
function setupLanguageDropdown() {
  const langBtn = document.getElementById('langBtn');
  const langMenu = document.getElementById('langMenu');
  const langDisplay = document.getElementById('langDisplay');
  
  if (!langBtn || !langMenu || !langDisplay) {
    console.log('Language dropdown elements not found');
    return;
  }
  
  // Load saved language preference (default to English)
  const savedLang = localStorage.getItem('authentIC_language') || 'en';
  const savedLangOption = document.querySelector(`.lang-option[data-lang="${savedLang}"]`);
  if (savedLangOption) {
    langDisplay.textContent = savedLangOption.dataset.code;
    document.querySelectorAll('.lang-option').forEach(opt => opt.classList.remove('active'));
    savedLangOption.classList.add('active');
    // Translate page if function is available and language is not English
    if (savedLang !== 'en') {
      setTimeout(() => {
        if (typeof window.translatePage === 'function') {
          window.translatePage(savedLang);
        }
      }, 100);
    }
  }

  // Toggle dropdown
  langBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Language button clicked');
    const isShowing = langMenu.classList.contains('show');
    console.log('Currently showing:', isShowing);
    
    // Close all other dropdowns first (if any)
    document.querySelectorAll('.lang-menu').forEach(menu => {
      if (menu !== langMenu) menu.classList.remove('show');
    });
    
    // Toggle this menu
    langMenu.classList.toggle('show');
    console.log('Menu classes after toggle:', langMenu.className);
    console.log('Menu display style:', window.getComputedStyle(langMenu).display);
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!langBtn.contains(e.target) && !langMenu.contains(e.target)) {
      langMenu.classList.remove('show');
    }
  });

  // Handle language selection
  document.querySelectorAll('.lang-option').forEach(option => {
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      const lang = option.dataset.lang;
      const code = option.dataset.code;
      
      // Update display
      langDisplay.textContent = code;
      
      // Update active state
      document.querySelectorAll('.lang-option').forEach(opt => opt.classList.remove('active'));
      option.classList.add('active');
      
      // Save preference
      localStorage.setItem('authentIC_language', lang);
      
      // Close dropdown
      langMenu.classList.remove('show');
      
      // Translate the page immediately
      if (typeof window.translatePage === 'function') {
        window.translatePage(lang).catch(err => {
          console.error('Translation error:', err);
        });
      } else {
        console.error('translatePage function not found');
        document.documentElement.lang = lang;
      }
      
      // Show confirmation (optional)
      console.log(`Language changed to: ${option.textContent}`);
    });
  });
}

// Load chats from Supabase and render in sidebar
async function loadAndRenderChats() {
  console.log('[Dashboard] Loading chats for sidebar...');
  const chatList = document.getElementById('chatList');
  if (!chatList) {
    console.error('[Dashboard] Chat list element not found!');
    return;
  }

  try {
    if (typeof window.chatService !== 'undefined') {
      console.log('[Dashboard] ChatService available, fetching chats...');
      const chatService = window.chatService;
      const chats = await chatService.getUserChats();
      console.log('[Dashboard] Received', chats.length, 'chats from Supabase');
      
      // Clear existing static chats
      chatList.innerHTML = '';
      
      // Render chats dynamically
      chats.forEach((chat, index) => {
        console.log(`[Dashboard] Rendering chat ${index + 1}:`, chat.id, chat.title);
        const li = document.createElement('li');
        li.className = 'chat-item';
        li.dataset.chatId = chat.id;
        
        // Format time
        const timeDisplay = chatService.formatTime(chat.updated_at);
        
        // Extract IC name from title if possible (e.g., "IC Check — Texas Instruments")
        const titleParts = chat.title.split(' — ');
        const displayTitle = titleParts.length > 1 ? titleParts[1] : chat.title;
        
        li.innerHTML = `
          <div><h5>IC Check — ${escapeHtml(displayTitle)}</h5></div>
          <div class="time">${timeDisplay}</div>
        `;
        
        // Click handler to navigate to chat
        li.addEventListener('click', () => {
          console.log('[Dashboard] User action: Clicked chat:', chat.id);
          window.location.href = `query.html?chatId=${chat.id}`;
        });
        
        chatList.appendChild(li);
      });
      
      // Show message if no chats
      if (chats.length === 0) {
        console.log('[Dashboard] No chats found, showing empty state');
        chatList.innerHTML = '<li class="chat-item" style="opacity:0.6;padding:12px;"><div>No chats yet. Start a new chat!</div></li>';
      } else {
        console.log('[Dashboard] Successfully rendered', chats.length, 'chats in sidebar');
      }
    } else {
      console.warn('[Dashboard] ChatService not available');
      console.warn('[Dashboard] Make sure chat-service.js is loaded before dashboard.js');
    }
  } catch (error) {
    console.error('[Dashboard] Error loading chats:', error);
    console.error('[Dashboard] Error details:', error.message);
    // Keep static chats as fallback
  }
}

// Helper to escape HTML
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Wait for auth check before proceeding
checkAuth().then((isAuthenticated) => {
  if (!isAuthenticated) return;

  document.addEventListener('DOMContentLoaded', async () => {
    // Setup logout handler
    setupLogout();
    
    // Load and render chats from Supabase
    await loadAndRenderChats();
    
    // animate bar fills (reads inline style width)
    document.querySelectorAll('.bar-fill').forEach((el) => {
      const w = el.style.width || '0%';
      el.style.width = '0%';
      setTimeout(() => { el.style.width = w; }, 80);
    });
    
    // Handle new chat button navigation
    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) {
      console.log('[Dashboard] Setting up New Chat button handler');
      newChatBtn.addEventListener('click', function(e) {
        console.log('[Dashboard] User action: New Chat button clicked');
        e.preventDefault();
        e.stopPropagation();
        // Add a parameter to indicate new chat request
        console.log('[Dashboard] Navigating to query.html?new=true');
        window.location.href = 'query.html?new=true';
      }, true);
      console.log('[Dashboard] New Chat button handler set up');
    } else {
      console.error('[Dashboard] New Chat button not found!');
    }
  });
});

// Setup handlers on page load (in case DOM is already loaded)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupLogout();
    setupLanguageDropdown();
    setupSearchOverlay();
  });
} else {
  setupLogout();
  setupLanguageDropdown();
  setupSearchOverlay();
}
