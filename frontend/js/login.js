// Supabase Authentication Integration
// Check if user is already logged in
document.addEventListener('DOMContentLoaded', async () => {
  // Check if user is already logged in
  if (typeof supabase !== 'undefined') {
    // Check existing Supabase session
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      window.location.href = 'dashboard.html';
      return;
    }
  } else {
    // Fallback to localStorage check for backward compatibility
    const isLoggedIn = localStorage.getItem('authentIC_loggedIn');
    if (isLoggedIn === 'true') {
      window.location.href = 'dashboard.html';
      return;
    }
  }

  // Personal form
  const personalForm = document.getElementById('personalForm');
  if (personalForm) {
    personalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('pEmail').value.trim();
      const pw = document.getElementById('pPassword').value;
      
      if (!email || pw.length < 6) {
        alert('Please enter a valid email and password (min 6 chars).');
        return;
      }

      if (typeof supabase === 'undefined') {
        alert('Supabase is not configured. Please set your SUPABASE_URL and SUPABASE_ANON_KEY in js/supabase-config.js');
        return;
      }

      const btn = e.target.querySelector('.btn-primary');
      btn.textContent = 'Logging in...';
      btn.disabled = true;

      try {
        // Sign in with Supabase
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email,
          password: pw,
        });

        if (error) {
          throw error;
        }

        if (data.session) {
          // Store user type
          localStorage.setItem('authentIC_userType', 'personal');
          // Redirect to dashboard
          window.location.href = 'dashboard.html';
        }
      } catch (error) {
        console.error('Login error:', error);
        alert(error.message || 'Login failed. Please check your credentials.');
        btn.textContent = 'Login';
        btn.disabled = false;
      }
    });

    // Google OAuth login - disabled for now
    const pGoogle = document.getElementById('pGoogle');
    if (pGoogle) {
      pGoogle.addEventListener('click', () => {
        alert('Google OAuth is currently disabled. Please use email/password login.');
      });
    }

    // Signup link handler
    const pSignupLink = document.getElementById('pSignupLink');
    if (pSignupLink) {
      pSignupLink.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = document.getElementById('pEmail').value.trim();
        const pw = document.getElementById('pPassword').value;
        
        if (!email || pw.length < 6) {
          alert('Please enter a valid email and password (min 6 chars) to sign up.');
          return;
        }

        if (typeof supabase === 'undefined') {
          alert('Supabase is not configured. Please set your SUPABASE_URL and SUPABASE_ANON_KEY in js/supabase-config.js');
          return;
        }

        try {
          const { data, error } = await supabase.auth.signUp({
            email: email,
            password: pw,
          });

          if (error) {
            throw error;
          }

          alert('Sign up successful! Please check your email to verify your account, then you can log in.');
        } catch (error) {
          console.error('Signup error:', error);
          alert('Sign up failed: ' + (error.message || 'Unknown error'));
        }
      });
    }
  }

  // Business form
  const businessForm = document.getElementById('businessForm');
  if (businessForm) {
    businessForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('bEmail').value.trim();
      const company = document.getElementById('companyId').value.trim();
      const pw = document.getElementById('bPassword').value;
      
      if (!email || !company || pw.length < 6) {
        alert('Please fill all fields and ensure password is at least 6 characters.');
        return;
      }

      if (typeof supabase === 'undefined') {
        alert('Supabase is not configured. Please set your SUPABASE_URL and SUPABASE_ANON_KEY in js/supabase-config.js');
        return;
      }

      const btn = e.target.querySelector('.btn-primary');
      btn.textContent = 'Logging in...';
      btn.disabled = true;

      try {
        // Sign in with Supabase
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email,
          password: pw,
        });

        if (error) {
          throw error;
        }

        if (data.session) {
          // Store company info and user type
          localStorage.setItem('authentIC_userType', 'business');
          localStorage.setItem('authentIC_companyId', company);
          // Redirect to dashboard
          window.location.href = 'dashboard.html';
        }
      } catch (error) {
        console.error('Login error:', error);
        alert(error.message || 'Login failed. Please check your credentials.');
        btn.textContent = 'Login';
        btn.disabled = false;
      }
    });

    // Google OAuth login for business - disabled for now
    const bGoogle = document.getElementById('bGoogle');
    if (bGoogle) {
      bGoogle.addEventListener('click', () => {
        alert('Google OAuth is currently disabled. Please use email/password login.');
      });
    }

    // Signup link handler for business
    const bSignupLink = document.getElementById('bSignupLink');
    if (bSignupLink) {
      bSignupLink.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = document.getElementById('bEmail').value.trim();
        const company = document.getElementById('companyId').value.trim();
        const pw = document.getElementById('bPassword').value;
        
        if (!email || !company || pw.length < 6) {
          alert('Please fill all fields and ensure password is at least 6 characters to sign up.');
          return;
        }

        if (typeof supabase === 'undefined') {
          alert('Supabase is not configured. Please set your SUPABASE_URL and SUPABASE_ANON_KEY in js/supabase-config.js');
          return;
        }

        try {
          const { data, error } = await supabase.auth.signUp({
            email: email,
            password: pw,
            options: {
              data: {
                company_id: company,
                user_type: 'business'
              }
            }
          });

          if (error) {
            throw error;
          }

          alert('Sign up successful! Please check your email to verify your account, then you can log in.');
        } catch (error) {
          console.error('Signup error:', error);
          alert('Sign up failed: ' + (error.message || 'Unknown error'));
        }
      });
    }
  }
});
