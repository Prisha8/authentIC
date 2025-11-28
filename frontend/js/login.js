document.addEventListener('DOMContentLoaded', () => {
  // Personal form
  const personalForm = document.getElementById('personalForm');
  if(personalForm){
    personalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('pEmail').value.trim();
      const pw = document.getElementById('pPassword').value;
      if(!email || pw.length < 6){ alert('Please enter a valid email and password (min 6 chars).'); return; }
     // Demo behavior
      const btn = e.target.querySelector('.btn-primary');
  btn.textContent = 'Logging in...';
  btn.disabled = true;

  setTimeout(() => {
    window.location.href = 'query.html';
  }, 1200);
    });
    const pGoogle = document.getElementById('pGoogle');
    if(pGoogle) pGoogle.addEventListener('click', ()=> {
      // Mock Google login. Replace with real OAuth later.
      alert('Google Sign-In is a demo here. To enable real Google login, integrate OAuth (or Firebase Auth).');
    });
  }

  // Business form
  const businessForm = document.getElementById('businessForm');
  if(businessForm){
    businessForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('bEmail').value.trim();
      const company = document.getElementById('companyId').value.trim();
      const pw = document.getElementById('bPassword').value;
      if(!email || !company || pw.length < 6){ alert('Please fill all fields and ensure password is at least 6 characters.'); return; }
      // Demo behavior
      const btn = e.target.querySelector('.btn-primary');
  btn.textContent = 'Logging in...';
  btn.disabled = true;

  setTimeout(() => {
    window.location.href = 'query.html';
  }, 1200);
    });
    const bGoogle = document.getElementById('bGoogle');
    if(bGoogle) bGoogle.addEventListener('click', ()=> {
      alert('Google Sign-In is a demo here. To enable real Google login, integrate OAuth (or Firebase Auth).');
    });
  }
});
