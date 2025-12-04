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

// Wait for auth check before proceeding
checkAuth().then((isAuthenticated) => {
  if (!isAuthenticated) return;

  document.addEventListener('DOMContentLoaded', () => {
    // Setup logout handler
    setupLogout();
    
    // animate bar fills (reads inline style width)
    document.querySelectorAll('.bar-fill').forEach((el) => {
      const w = el.style.width || '0%';
      el.style.width = '0%';
      setTimeout(() => { el.style.width = w; }, 80);
    });
    
    // Handle new chat button navigation
    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) {
      newChatBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        // Add a parameter to indicate new chat request
        window.location.href = 'query.html?new=true';
      }, true);
    }
  });
});

// Setup handlers on page load (in case DOM is already loaded)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupLogout();
    setupLanguageDropdown();
  });
} else {
  setupLogout();
  setupLanguageDropdown();
}
