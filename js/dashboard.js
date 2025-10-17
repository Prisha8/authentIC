// dashboard.js — simplified: animate bar fills only
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
});
