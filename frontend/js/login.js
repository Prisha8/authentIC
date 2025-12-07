// Supabase Authentication Integration
// Helper function to get redirect URL based on user type
function getRedirectUrl() {
  const userType = localStorage.getItem('authentIC_userType');
  return userType === 'personal' ? 'query.html' : 'dashboard.html';
}

// Check if user is already logged in
document.addEventListener('DOMContentLoaded', async () => {
  // Check if user is already logged in
  if (typeof supabase !== 'undefined') {
    // Check existing Supabase session
    const { data: { session } } = await supabase.auth.getSession();
    
    // Also check localStorage - if localStorage is cleared but session exists, 
    // it means user logged out, so clear the stale session
    const isLoggedIn = localStorage.getItem('authentIC_loggedIn');
    const userType = localStorage.getItem('authentIC_userType');
    
    if (session && isLoggedIn === 'true' && userType) {
      // Both session and localStorage indicate logged in - redirect
      window.location.href = getRedirectUrl();
      return;
    } else if (session && (!isLoggedIn || !userType)) {
      // Session exists but localStorage is cleared - user logged out, clear stale session
      console.log('[Login] Stale Supabase session detected, clearing...');
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.warn('[Login] Error clearing stale session:', err);
      }
      // Don't redirect - let user log in fresh
    } else if (!session && isLoggedIn === 'true') {
      // localStorage says logged in but no session - clear localStorage
      console.log('[Login] Stale localStorage detected, clearing...');
      localStorage.removeItem('authentIC_loggedIn');
      localStorage.removeItem('authentIC_userType');
      localStorage.removeItem('authentIC_companyId');
      localStorage.removeItem('authentIC_userId');
      localStorage.removeItem('authentIC_email');
      localStorage.removeItem('authentIC_sessionId');
      localStorage.removeItem('authentIC_pendingOAuth');
      // Don't redirect - let user log in fresh
    }
  } else {
    // Fallback to localStorage check for backward compatibility
    const isLoggedIn = localStorage.getItem('authentIC_loggedIn');
    if (isLoggedIn === 'true') {
      window.location.href = getRedirectUrl();
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
          // Redirect to chat interface for personal users
          window.location.href = 'query.html';
        }
      } catch (error) {
        console.error('Login error:', error);
        alert(error.message || 'Login failed. Please check your credentials.');
        btn.textContent = 'Login';
        btn.disabled = false;
      }
    });

    // Google OAuth login
    const pGoogle = document.getElementById('pGoogle');
    if (pGoogle) {
      pGoogle.addEventListener('click', async () => {
        if (typeof supabase === 'undefined') {
          alert('Supabase is not configured. Please set your SUPABASE_URL and SUPABASE_ANON_KEY in js/supabase-config.js');
          return;
        }

        try {
          pGoogle.disabled = true;
          pGoogle.textContent = 'Connecting...';
          
          // For Electron, use the current file path to construct redirect URL
          // Supabase will handle the OAuth callback and redirect back
          const currentPath = window.location.pathname;
          const redirectPath = currentPath.includes('personal_login.html') 
            ? currentPath.replace('personal_login.html', 'query.html')
            : 'query.html';
          const redirectUrl = window.location.protocol === 'file:'
            ? `${window.location.origin}${redirectPath}`
            : `${window.location.origin}/${redirectPath}`;
          
          // Store user type before redirect
          localStorage.setItem('authentIC_userType', 'personal');
          localStorage.setItem('authentIC_pendingOAuth', 'true');
          
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: redirectUrl,
              queryParams: {
                access_type: 'offline',
                prompt: 'consent',
              }
            }
          });
          
          if (error) {
            throw error;
          }

          if (error) {
            throw error;
          }
          
          // Note: If you get redirect_uri_mismatch error, you need to:
          // 1. Go to Google Cloud Console (https://console.cloud.google.com/)
          // 2. Select your project
          // 3. Go to APIs & Services > Credentials
          // 4. Edit your OAuth 2.0 Client ID
          // 5. Add authorized redirect URI: https://[your-supabase-project].supabase.co/auth/v1/callback
          // The exact URI is shown in the error message
        } catch (error) {
          console.error('Google OAuth error:', error);
          alert('Google login failed: ' + (error.message || 'Unknown error'));
          pGoogle.disabled = false;
          pGoogle.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" style="margin-right:10px" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span data-i18n="login.personal.google">Login with Google</span>
          `;
        }
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

    // Google OAuth login for business
    const bGoogle = document.getElementById('bGoogle');
    if (bGoogle) {
      bGoogle.addEventListener('click', async () => {
        if (typeof supabase === 'undefined') {
          alert('Supabase is not configured. Please set your SUPABASE_URL and SUPABASE_ANON_KEY in js/supabase-config.js');
          return;
        }

        try {
          bGoogle.disabled = true;
          bGoogle.textContent = 'Connecting...';
          
          // For Electron, use the current file path to construct redirect URL
          const currentPath = window.location.pathname;
          const redirectPath = currentPath.includes('business_login.html') 
            ? currentPath.replace('business_login.html', 'dashboard.html')
            : 'dashboard.html';
          const redirectUrl = window.location.protocol === 'file:'
            ? `${window.location.origin}${redirectPath}`
            : `${window.location.origin}/${redirectPath}`;
          
          // Store user type before redirect
          localStorage.setItem('authentIC_userType', 'business');
          localStorage.setItem('authentIC_pendingOAuth', 'true');
          
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: redirectUrl,
              queryParams: {
                access_type: 'offline',
                prompt: 'consent',
              }
            }
          });
          
          if (error) {
            throw error;
          }
        } catch (error) {
          console.error('Google OAuth error:', error);
          alert('Google login failed: ' + (error.message || 'Unknown error'));
          bGoogle.disabled = false;
          bGoogle.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" style="margin-right:10px" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span data-i18n="login.business.google">Login with Google</span>
          `;
        }
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
