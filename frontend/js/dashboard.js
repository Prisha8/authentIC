// dashboard.js — simplified: animate bar fills only
// Check if user is logged in
const isLoggedIn = localStorage.getItem('authentIC_loggedIn');
if (isLoggedIn !== 'true') {
  window.location.href = 'login.html';
}

document.addEventListener('DOMContentLoaded', () => {
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
  
  // Handle logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('authentIC_loggedIn');
      localStorage.removeItem('authentIC_userType');
      window.location.href = 'login.html';
    });
  }
});
