// Supabase Configuration
// Credentials are loaded from environment variables via preload script
// Set SUPABASE_URL and SUPABASE_ANON_KEY in .env file

// Get credentials from environment (via electronEnv from preload.js)
const SUPABASE_URL = window.electronEnv?.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.electronEnv?.SUPABASE_ANON_KEY;

// Validate that credentials are provided
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERROR: Supabase credentials not found!');
  console.error('Please set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file');
  throw new Error('Supabase configuration missing. Please check your .env file.');
}

// Initialize Supabase client
let supabase;
if (typeof window !== 'undefined' && window.supabase) {
  const { createClient } = window.supabase;
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('Supabase client initialized');
} else {
  console.error('ERROR: Supabase client not loaded. Make sure to include the Supabase script before this file.');
}

