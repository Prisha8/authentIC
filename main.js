const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
require('dotenv').config();

// Set app name (shown in dock tooltip and menus)
app.setName('authentIC');

let mainWindow;

// Set app icon for macOS dock
if (process.platform === 'darwin') {
  app.dock.setIcon(path.join(__dirname, 'frontend/assets/logo.png'));
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    icon: path.join(__dirname, 'frontend/assets/logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: false
    },
    backgroundColor: '#fafafa',
    title: 'authentIC',
    show: false
  });

  // Load the login page first (software-style entry point)
  mainWindow.loadFile('frontend/login.html');

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle OAuth redirects and navigation
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      // Check if this is an OAuth callback with access_token in hash
      if (navigationUrl.includes('#access_token') || navigationUrl.includes('#error')) {
        event.preventDefault();
        
        // Extract hash from URL
        const hashIndex = navigationUrl.indexOf('#');
        const hash = hashIndex !== -1 ? navigationUrl.substring(hashIndex) : '';
        
        // Route to query.html first (for personal users), it will redirect to dashboard if needed
        // Both pages have OAuth callback handlers that check user type
        mainWindow.loadFile('frontend/query.html').then(() => {
          // Inject the hash into the page so Supabase can process it
          setTimeout(() => {
            if (hash) {
              mainWindow.webContents.executeJavaScript(`
                window.location.hash = ${JSON.stringify(hash)};
              `);
            }
          }, 200);
        });
        return;
      }
      
      // Prevent navigation to localhost:3000 or other invalid URLs in Electron
      if (navigationUrl.startsWith('http://localhost:') || navigationUrl.startsWith('http://127.0.0.1:')) {
        event.preventDefault();
        console.log('[Electron] Blocked navigation to:', navigationUrl);
        // Check if it's an OAuth callback
        if (navigationUrl.includes('#access_token')) {
          const hashIndex = navigationUrl.indexOf('#');
          const hash = hashIndex !== -1 ? navigationUrl.substring(hashIndex) : '';
          // Route to query.html, it will handle user type routing
          mainWindow.loadFile('frontend/query.html').then(() => {
            setTimeout(() => {
              if (hash) {
                mainWindow.webContents.executeJavaScript(`
                  window.location.hash = ${JSON.stringify(hash)};
                `);
              }
            }, 200);
          });
        }
      }
    } catch (err) {
      console.error('[Electron] Navigation handler error:', err);
    }
  });

  // Handle new window opens (for OAuth popup/redirect)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow Supabase OAuth and Google OAuth to open in same window
    if (url.includes('supabase.co/auth') || url.includes('accounts.google.com') || url.includes('oauth')) {
      // Open in same window
      mainWindow.loadURL(url);
      return { action: 'deny' }; // Deny new window, we'll handle it above
    }
    return { action: 'deny' };
  });

  // Create custom menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Chat',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.loadFile('frontend/query.html');
          }
        },
        {
          label: 'Dashboard',
          accelerator: 'CmdOrCtrl+D',
          click: () => {
            mainWindow.loadFile('frontend/dashboard.html');
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About authentIC',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About authentIC',
              message: 'authentIC v1.0.0',
              detail: 'AI-powered IC authenticity detection system\n\n© 2025 authentIC - All Rights Reserved'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App ready
app.whenReady().then(createWindow);

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Activate (macOS)
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

