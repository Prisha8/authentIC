// Dark Mode Toggle Functionality

// Initialize dark mode on page load
function initDarkMode() {
  const savedTheme = localStorage.getItem('authentIC_theme_v2') || 'dark';
  applyTheme(savedTheme);
  updateToggleIcon(savedTheme);
}

// Apply theme to document
function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark-mode');
  } else {
    document.documentElement.classList.remove('dark-mode');
  }
  localStorage.setItem('authentIC_theme_v2', theme);
}

// Update toggle icon based on current theme
function updateToggleIcon(theme) {
  const toggleBtn = document.getElementById('darkModeToggle');
  if (!toggleBtn) return;
  
  const icon = toggleBtn.querySelector('svg');
  if (!icon) return;
  
  if (theme === 'dark') {
    // Show sun icon (light mode icon)
    icon.innerHTML = `
      <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    `;
    toggleBtn.setAttribute('aria-label', 'Switch to light mode');
    toggleBtn.title = 'Switch to light mode';
  } else {
    // Show moon icon (dark mode icon)
    icon.innerHTML = `
      <path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    `;
    toggleBtn.setAttribute('aria-label', 'Switch to dark mode');
    toggleBtn.title = 'Switch to dark mode';
  }
}

// Toggle dark mode
function toggleDarkMode() {
  const currentTheme = localStorage.getItem('authentIC_theme_v2') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
  updateToggleIcon(newTheme);
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDarkMode);
} else {
  initDarkMode();
}

// Make toggleDarkMode available globally
window.toggleDarkMode = toggleDarkMode;

