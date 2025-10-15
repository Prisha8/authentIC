// dashboard.js — simplified: animate bar fills only
document.addEventListener('DOMContentLoaded', () => {
  // animate bar fills (reads inline style width)
  document.querySelectorAll('.bar-fill').forEach((el) => {
    const w = el.style.width || '0%';
    el.style.width = '0%';
    setTimeout(() => { el.style.width = w; }, 80);
  });
});
