// Preload script to expose Supabase credentials to renderer process
const { contextBridge } = require('electron');

// Expose Supabase environment variables to the renderer process
contextBridge.exposeInMainWorld('electronEnv', {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
});

