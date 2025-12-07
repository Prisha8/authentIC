// chat.js — chat UI + collapsible sidebar + Save Chat behavior
// Check if user is logged in using Supabase

// Setup logout handler immediately (before auth check)
// Only set up if dashboard.js hasn't already done it
function setupLogout() {
  // Check if handler already attached by dashboard.js
  if (window.logoutHandlerAttached) {
    console.log('[Chat] Logout handler already attached by dashboard.js, skipping');
    return;
  }
  
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    // Only attach if not already attached
    if (logoutBtn.dataset.handlerAttached === 'true') {
      console.log('[Chat] Logout handler already attached, skipping');
      return;
    }
    
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        console.log('[Chat] Logout clicked');
        // Sign out from Supabase if available
        if (typeof supabase !== 'undefined' && supabase && supabase.auth) {
          try {
            await supabase.auth.signOut();
          } catch (err) {
            console.warn('[Chat] Supabase sign out error:', err);
          }
        }
        // Clear localStorage
        localStorage.removeItem('authentIC_loggedIn');
        localStorage.removeItem('authentIC_userType');
        localStorage.removeItem('authentIC_companyId');
        localStorage.removeItem('authentIC_userId');
        localStorage.removeItem('authentIC_email');
        localStorage.removeItem('authentIC_pendingOAuth');
        // Redirect to login
        window.location.href = 'login.html';
      } catch (error) {
        console.error('[Chat] Logout error:', error);
        // Still redirect even if there's an error
        localStorage.clear();
        window.location.href = 'login.html';
      }
    }, true); // Use capture phase
    
    logoutBtn.dataset.handlerAttached = 'true';
    window.logoutHandlerAttached = true;
    console.log('[Chat] Logout handler attached');
  } else {
    console.warn('[Chat] Logout button not found');
  }
}

// Load Supabase config first
async function checkAuth() {
  // Check user type - redirect business users to dashboard
  const userType = localStorage.getItem('authentIC_userType');
  if (userType === 'business') {
    window.location.href = 'dashboard.html';
    return false;
  }
  
  // Check Supabase session if available
  if (typeof supabase !== 'undefined') {
    // Check for OAuth callback in URL hash first
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
      // OAuth callback - wait a moment for Supabase to process
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    const { data: { session }, error } = await supabase.auth.getSession();
    if (!session) {
      // Check if we're waiting for OAuth (don't redirect immediately)
      const pendingOAuth = localStorage.getItem('authentIC_pendingOAuth');
      if (!pendingOAuth) {
        window.location.href = 'login.html';
        return false;
      }
      // OAuth pending - wait a bit more
      await new Promise(resolve => setTimeout(resolve, 1000));
      const { data: { session: retrySession } } = await supabase.auth.getSession();
      if (!retrySession) {
        window.location.href = 'login.html';
        return false;
      }
    }
    
    // Check user type again after session is established
    const currentUserType = localStorage.getItem('authentIC_userType');
    if (currentUserType === 'business') {
      window.location.href = 'dashboard.html';
      return false;
    }
    
    return true;
  } else {
    // Fallback to localStorage check
    const isLoggedIn = localStorage.getItem('authentIC_loggedIn');
    if (isLoggedIn !== 'true') {
      window.location.href = 'login.html';
      return false;
    }
    
    // Check user type for fallback too
    const currentUserType = localStorage.getItem('authentIC_userType');
    if (currentUserType === 'business') {
      window.location.href = 'dashboard.html';
      return false;
    }
    
    return true;
  }
}

// Setup logout handler immediately (before auth check)
// Try to set it up right away if DOM is ready, otherwise wait for DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupLogout);
} else {
  setupLogout();
}

// Also set up after a short delay to ensure button exists
setTimeout(setupLogout, 100);

// Initialize sidebar visibility immediately (don't wait for auth)
// This ensures the sidebar is visible even if there are auth delays
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.classList.remove('collapsed');
      console.log('[Chat] Sidebar initialized and made visible');
    }
  });
} else {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.classList.remove('collapsed');
    console.log('[Chat] Sidebar initialized and made visible');
  }
}

// Wait for auth check before proceeding
checkAuth().then((isAuthenticated) => {
  if (!isAuthenticated) {
    console.log('[Chat] User not authenticated, skipping chat initialization');
    return;
  }

  console.log('[Chat] User authenticated, initializing chat system...');

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Chat] DOM Content Loaded');
  // Elements
  const sidebar = document.getElementById('sidebar');
  const toggleSidebar = document.getElementById('toggleSidebar');
  const newChatBtn = document.getElementById('newChatBtn');
  const chatList = document.getElementById('chatList');
  const messagesEl = document.getElementById('messages');
  const sendBtn = document.getElementById('sendBtn');
  const promptEl = document.getElementById('prompt');
  const imgInput = document.getElementById('imgInput');

  // Debug: Check if button exists
  console.log('[Chat] Button elements check:');
  console.log('[Chat] - newChatBtn:', newChatBtn ? 'FOUND' : 'NOT FOUND');
  console.log('[Chat] - chatList:', chatList ? 'FOUND' : 'NOT FOUND');
  console.log('[Chat] - messagesEl:', messagesEl ? 'FOUND' : 'NOT FOUND');
  
  if (!newChatBtn) {
    console.error('[Chat] CRITICAL: New Chat button not found in DOM!');
    console.error('[Chat] Available buttons:', document.querySelectorAll('button').length);
    console.error('[Chat] Button with id newChatBtn:', document.querySelector('#newChatBtn'));
  }

  // Ensure menu-item titles are set for tooltip in collapsed mode
  document.querySelectorAll('.menu-item').forEach(mi => {
    const txt = mi.querySelector('span') ? mi.querySelector('span').textContent.trim() : mi.getAttribute('data-title') || '';
    if (txt && !mi.getAttribute('data-title')) mi.setAttribute('data-title', txt);
    if (!mi.getAttribute('title')) mi.setAttribute('title', txt);
  });

  // Sidebar toggle
  if (toggleSidebar && sidebar) {
    toggleSidebar.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      // update aria-expanded for accessibility
      const expanded = !sidebar.classList.contains('collapsed');
      toggleSidebar.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  }

  // Chat storage
  let chats = [];
  let activeChatId = null;
  let attachedFile = null;
  let chatService = null;
  
  // Expose functions for API integration to access active chat
  window.getActiveChatId = () => activeChatId;
  window.getActiveChat = () => {
    return chats.find(c => c.id === activeChatId);
  };
  window.getChatById = (id) => {
    return chats.find(c => c.id === id);
  };

  // Initialize chat service
  console.log('[Chat] Initializing chat service...');
  try {
    if (typeof window.chatService !== 'undefined') {
      chatService = window.chatService;
      console.log('[Chat] ChatService initialized successfully');
    } else {
      console.warn('[Chat] ChatService not available, using local storage fallback');
      console.warn('[Chat] Make sure chat-service.js is loaded before chat.js');
    }
  } catch (error) {
    console.error('[Chat] Error initializing chat service:', error);
  }

  // Helpers
  function formatTime(date = new Date()){
    return date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  }

  async function createChat(title){
    console.log('[Chat] User action: Creating new chat with title:', title);
    const titleText = title || `Chat ${chats.length + 1}`;
    
    // Clear conversational agent session for fresh start
    if (window.clearSession) {
      window.clearSession();
      console.log('[Chat] Cleared conversational agent session');
    }
    
    // Clear any local storage chat messages for fresh start
    localStorage.removeItem('api_chat_messages');
    console.log('[Chat] Cleared local storage chat messages');
    
    // If chatService is available, create chat in Supabase
    if (chatService) {
      console.log('[Chat] Using Supabase to create chat');
      try {
        const newChat = await chatService.createChat(titleText);
        console.log('[Chat] Chat created in Supabase:', newChat);
        
        const chat = {
          id: newChat.id,
          title: newChat.title,
          messages: [], // Ensure messages array is empty
          created_at: newChat.created_at,
          updated_at: newChat.updated_at
        };
        chats.unshift(chat);
        console.log('[Chat] Chat added to local array, total chats:', chats.length);
        
        // Immediately render the updated chat list
        renderChatList();
        console.log('[Chat] Chat list rendered after creation');
        
        // Set the new chat as active - this will clear the messages display
        activeChatId = chat.id;
        await setActiveChat(chat.id);
        renderMessages(); // This should show empty state
        
        console.log('[Chat] Chat creation completed successfully');
        return chat;
      } catch (error) {
        console.error('[Chat] Error creating chat in Supabase:', error);
        console.error('[Chat] Error details:', error.message, error);
        alert('Failed to create chat: ' + (error.message || 'Unknown error'));
        // Fallback to local storage
      }
    } else {
      console.log('[Chat] ChatService not available, using local storage fallback');
    }
    
    // Fallback: local storage
    console.log('[Chat] Creating local chat (fallback)');
    const id = 'c' + Date.now();
    const chat = { id, title: titleText, messages: [] };
    chats.unshift(chat);
    renderChatList();
    setActiveChat(chat.id);
    renderMessages();
    console.log('[Chat] Local chat created:', chat.id);
    return chat;
  }
  
  // Make createChat available globally for inline handler
  window.createChat = createChat;

  function renderChatList(){
    // Re-find chatList element to ensure we have the latest reference
    const currentChatList = document.getElementById('chatList');
    if(!currentChatList) {
      console.warn('[Chat] Chat list element not found, retrying...');
      setTimeout(() => {
        const retryList = document.getElementById('chatList');
        if (retryList) {
          chatList = retryList;
          renderChatList();
        }
      }, 200);
      return;
    }
    // Update reference
    chatList = currentChatList;
    
    console.log('[Chat] Rendering chat list with', chats.length, 'chats');
    chatList.innerHTML = '';
    
    if (chats.length === 0) {
      console.log('[Chat] No chats to display');
      return;
    }
    
    chats.forEach((c, index) => {
      const li = document.createElement('li');
      li.className = 'chat-item' + (c.id === activeChatId ? ' active' : '');
      li.dataset.id = c.id;
      
      // Format time from updated_at or last message time
      let timeDisplay = '';
      if (c.updated_at) {
        timeDisplay = chatService ? chatService.formatTime(c.updated_at) : formatTime(new Date(c.updated_at));
      } else if (c.messages && c.messages.length > 0) {
        timeDisplay = formatTime(new Date(c.messages[c.messages.length-1].time || c.messages[c.messages.length-1].created_at));
      } else {
        timeDisplay = 'Now';
      }
      
      // Format title - extract IC name if possible
      let displayTitle = c.title;
      if (c.title.includes(' — ')) {
        const parts = c.title.split(' — ');
        displayTitle = parts.length > 1 ? parts[1] : c.title;
      }
      
      li.innerHTML = `<div><h5>${escapeHtml(displayTitle)}</h5></div><div class="time">${timeDisplay}</div>`;
      li.addEventListener('click', async () => {
        console.log('[Chat] Chat clicked:', c.id);
        await setActiveChat(c.id);
      });
      chatList.appendChild(li);
      console.log(`[Chat] Rendered chat ${index + 1}:`, c.id, c.title, 'Time:', timeDisplay);
    });
    
    const finalCount = chatList.children.length;
    console.log('[Chat] Chat list rendering completed. Total items in DOM:', finalCount);
    
    if (finalCount !== chats.length) {
      console.warn('[Chat] WARNING: Mismatch between chats array and rendered items!');
      console.warn('[Chat] Chats array:', chats.length, 'Rendered:', finalCount);
    }
  }

  async function setActiveChat(id){
    console.log('[Chat] User action: Setting active chat to:', id);
    activeChatId = id;
    document.querySelectorAll('#chatList .chat-item').forEach(it => it.classList.toggle('active', it.dataset.id === id));
    
    // Load messages from Supabase if chatService is available
    if (chatService) {
      console.log('[Chat] Loading messages from Supabase for chat:', id);
      try {
        const messages = await chatService.getChatMessages(id);
        console.log('[Chat] Loaded', messages.length, 'messages from Supabase');
        
        const chat = chats.find(c => c.id === id);
        if (chat) {
          // Convert Supabase messages to chat format
          chat.messages = messages.map(msg => ({
            role: msg.role,
            text: msg.content,
            img: msg.image_url,
            time: new Date(msg.created_at).getTime(),
            created_at: msg.created_at,
            _thinking: msg.content === '' && msg.role === 'assistant', // Handle thinking messages
            _hasReport: msg.content && msg.content.includes('**Final Report Prepared**')
          }));
          console.log('[Chat] Messages converted and stored in chat object');
        } else {
          console.warn('[Chat] Chat not found in local array:', id);
        }
      } catch (error) {
        console.error('[Chat] Error loading messages:', error);
        console.error('[Chat] Error details:', error.message);
      }
    } else {
      console.log('[Chat] ChatService not available, using local messages');
    }
    
    // Clear any localStorage chat messages when switching chats (to prevent cross-chat contamination)
    const currentChat = chats.find(c => c.id === id);
    if (currentChat && currentChat.messages.length === 0) {
      localStorage.removeItem('api_chat_messages');
      console.log('[Chat] Cleared localStorage messages for new/empty chat');
    }
    
    renderMessages();
    console.log('[Chat] Active chat set and messages rendered');
  }

  function renderMessages(){
    messagesEl.innerHTML = '';
    const chat = chats.find(c => c.id === activeChatId);
    const emptyHtml = `<div class="empty-state"><p>Start a new detection by attaching an image and writing a prompt below.</p></div>`;
    if(!chat || !chat.messages.length){
      messagesEl.innerHTML = emptyHtml;
      return;
    }

    // create container for messages inside
    const container = document.createElement('div');
    container.className = 'chat-card';
    // append messages
    chat.messages.forEach(m => {
      if(m._thinking && m._steps){
        // Render thinking steps - only show active and completed ones
        const stepsDiv = document.createElement('div');
        stepsDiv.className = 'thinking-steps';
        
        m._steps.forEach(step => {
          // Only render steps that are active or completed
          if(step.status !== 'pending'){
            const stepDiv = document.createElement('div');
            stepDiv.className = 'step ' + step.status;
            
            const icon = document.createElement('div');
            icon.className = 'step-icon';
            if(step.status === 'completed'){
              icon.innerHTML = '✓';
            } else if(step.status === 'active'){
              icon.innerHTML = '⋯';
            }
            
            const text = document.createElement('span');
            text.textContent = step.text;
            
            stepDiv.appendChild(icon);
            stepDiv.appendChild(text);
            stepsDiv.appendChild(stepDiv);
          }
        });
        
        container.appendChild(stepsDiv);
      } else {
        // Regular message
      const div = document.createElement('div');
      div.className = 'msg ' + (m.role === 'user' ? 'user' : 'bot');
      if(m.img){
        const im = document.createElement('img');
        im.src = m.img;
        div.appendChild(im);
      }
        if(m.text){
      const p = document.createElement('div');
          // Check if text is already HTML (from formatSummaryAsTable)
          if (m.text.includes('<table') || m.text.includes('<div style=')) {
            // Already formatted as HTML table
            p.innerHTML = m.text;
          } else {
            // Clean up excessive blank lines first
            let cleanedText = m.text
              .replace(/\n{3,}/g, '\n\n')  // Replace 3+ newlines with 2
              .replace(/^\n+|\n+$/g, ''); // Remove leading/trailing newlines
            
            // Simple markdown-style formatting
            let formattedText = cleanedText
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
              .replace(/^• (.+)$/gm, '<div style="padding-left:1em">• $1</div>') // Bullet points
              .replace(/^(\d+)\. (.+)$/gm, '<div style="padding-left:1em">$1. $2</div>') // Numbered lists
              .replace(/^✓ (.+)$/gm, '<div style="color:#10b981;padding-left:1em">✓ $1</div>') // Green checkmarks
              .replace(/^⚠ (.+)$/gm, '<div style="color:#f59e0b;padding-left:1em">⚠ $1</div>'); // Orange warnings
            
            p.innerHTML = formattedText;
            p.style.whiteSpace = 'pre-line';
            p.style.lineHeight = '1.6';
          }
      div.appendChild(p);
        }
        
        // Add download button if report is available
        if(m._hasReport){
          const downloadBtn = document.createElement('button');
          downloadBtn.className = 'download-report-btn';
          downloadBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download Full Report (PDF)
          `;
          downloadBtn.onclick = () => generatePDFReport(m);
          div.appendChild(downloadBtn);
        }
        
      container.appendChild(div);
      }
    });
    messagesEl.appendChild(container);
    
    // Auto-scroll to bottom with smooth behavior
    setTimeout(() => {
      messagesEl.scrollTo({
        top: messagesEl.scrollHeight,
        behavior: 'smooth'
      });
    }, 50);
  }

  // new chat - Set up handler immediately
  function setupNewChatButton() {
    const btn = document.getElementById('newChatBtn');
    if (!btn) {
      console.error('[Chat] New Chat button not found! Retrying...');
      // Retry after a short delay
      setTimeout(setupNewChatButton, 100);
      return;
    }
    
    console.log('[Chat] Setting up New Chat button handler');
    console.log('[Chat] Button element:', btn);
    console.log('[Chat] Button text:', btn.textContent);
    
    // Remove any existing listeners (if any)
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    
    // Add event listener
    newBtn.addEventListener('click', async (e) => {
      console.log('[Chat] ====== NEW CHAT BUTTON CLICKED ======');
      console.log('[Chat] Event:', e);
      console.log('[Chat] Current URL:', window.location.href);
      
      e.preventDefault();
      e.stopPropagation();
      
      // Navigate to query page if not already there
      if (!window.location.pathname.includes('query.html')) {
        console.log('[Chat] Navigating to query.html?new=true');
        window.location.href = 'query.html?new=true';
      } else {
        // If already on query page, create new chat
        console.log('[Chat] Already on query page, creating new chat');
        try {
          await createChat('New Detection');
          console.log('[Chat] New chat created successfully');
        } catch (error) {
          console.error('[Chat] Failed to create new chat:', error);
          console.error('[Chat] Error stack:', error.stack);
          alert('Failed to create new chat: ' + (error.message || 'Unknown error'));
        }
      }
    });
    
    console.log('[Chat] New Chat button handler set up successfully');
    console.log('[Chat] Button clickable:', !newBtn.disabled);
  }
  
  // Set up immediately
  setupNewChatButton();

  // attach image with preview
  const imagePreview = document.getElementById('imagePreview');
  const previewImg = document.getElementById('previewImg');
  const removePreview = document.getElementById('removePreview');
  
  if(imgInput){
    imgInput.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if(!f) { 
        attachedFile = null;
        if(imagePreview) imagePreview.style.display = 'none';
        return;
      }
      attachedFile = f;
      
      // Show preview
      const reader = new FileReader();
      reader.onload = (e) => {
        if(previewImg) previewImg.src = e.target.result;
        if(imagePreview) imagePreview.style.display = 'block';
      };
      reader.readAsDataURL(f);
    });
  }
  
  // Remove preview button
  if(removePreview){
    removePreview.addEventListener('click', () => {
      attachedFile = null;
      if(imgInput) imgInput.value = '';
      if(imagePreview) imagePreview.style.display = 'none';
      if(previewImg) previewImg.src = '';
    });
  }

  // Chain of thought steps - hardcoded for demo with realistic delays (in ms)
  const PROCESSING_STEPS = [
    { text: 'Enhancing IC image and removing glare.', delay: 800 },
    { text: 'Extracting serials, markings, and logo regions.', delay: 1200 },
    { text: 'Manufacturer identified — matching OEM reference.', delay: 600 },
    { text: 'Fetching OEM datasheet and verified IC record.', delay: 1400 },
    { text: 'Cross-verifying dimensions, pin layout, and markings.', delay: 1000 },
    { text: 'Analyzing surface texture and print integrity.', delay: 900 },
    { text: 'Detecting possible wear, sanding, or bent pins.', delay: 700 },
    { text: 'Computing authenticity and fault confidence score.', delay: 1100 },
    { text: 'Generating visual report and summary verdict.', delay: 800 }
  ];

  // send/detect
  async function handleSend(){
  console.log('[Chat] User action: Send message clicked');
  const text = promptEl.value.trim();
  console.log('[Chat] Message text:', text, 'Has file:', !!attachedFile);
  
  if(!text && !attachedFile){
    console.log('[Chat] Validation failed: No text or file');
    alert('Please write a prompt or attach an image.');
    return;
  }
  
  // create a chat if none exists
  if(!activeChatId) {
    console.log('[Chat] No active chat, creating new one');
    await createChat('New Detection');
  }
  
  const chat = chats.find(c => c.id === activeChatId);
  if (!chat) {
    console.error('[Chat] Active chat not found!');
    return;
  }
  
  console.log('[Chat] Sending message to chat:', activeChatId);

  // build user message and attach image if present
  const userMsg = { role:'user', text: text || '(image only)', time: Date.now(), img: null };
  let imageUrl = null;
  
  // Handle image upload to Supabase storage if available
  if(attachedFile) {
    // For now, use object URL. In production, upload to Supabase Storage
    userMsg.img = URL.createObjectURL(attachedFile);
    imageUrl = userMsg.img; // Store as base64 or upload to storage
    
    // TODO: Upload image to Supabase Storage and get URL
    // const imageUrl = await uploadImageToSupabase(attachedFile);
  }
  
  chat.messages.push(userMsg);
  
  // Save message to Supabase
  if (chatService) {
    console.log('[Chat] Saving user message to Supabase');
    try {
      await chatService.saveMessage(activeChatId, 'user', userMsg.text, imageUrl);
      console.log('[Chat] User message saved successfully');
    } catch (error) {
      console.error('[Chat] Error saving user message:', error);
      console.error('[Chat] Error details:', error.message);
    }
  } else {
    console.log('[Chat] ChatService not available, skipping Supabase save');
  }

  // clear input and reset attach
  promptEl.value = '';
  attachedFile = null;
  if(imgInput) imgInput.value = '';
  if(imagePreview) imagePreview.style.display = 'none';
  if(previewImg) previewImg.src = '';

  renderMessages();
  renderChatList();

  // disable controls while "processing"
  if(sendBtn) sendBtn.disabled = true;
  if(promptEl) promptEl.disabled = true;

  // small initial delay before showing the thinking steps
  const preDelay = 300;
  setTimeout(() => {
    // Create a thinking steps message
    const thinkingMsg = { 
      role:'bot', 
      text: '', 
      time: Date.now(), 
      _thinking: true,
      _steps: PROCESSING_STEPS.map((step, idx) => ({
        text: step.text,
        delay: step.delay,
        status: 'pending', // pending, active, completed
        index: idx
      }))
    };
    chat.messages.push(thinkingMsg);
    renderMessages();

    // Process steps one by one with variable delays
    let currentStep = 0;
    
    function processNextStep() {
      if (currentStep < PROCESSING_STEPS.length) {
        // Mark previous step as completed
        if (currentStep > 0) {
          thinkingMsg._steps[currentStep - 1].status = 'completed';
        }
        // Mark current step as active
        thinkingMsg._steps[currentStep].status = 'active';
      renderMessages();
        
        const currentDelay = thinkingMsg._steps[currentStep].delay;
        currentStep++;
        
        // Schedule next step with its specific delay
        setTimeout(processNextStep, currentDelay);
      } else {
        // All steps completed
        // Mark last step as completed
        thinkingMsg._steps[PROCESSING_STEPS.length - 1].status = 'completed';
        renderMessages();

        // Note: Actual detection is handled by API integration
        // This thinking message is just a visual indicator
        // The API integration will replace this with real results
        
        // Re-enable controls (API integration will handle the actual response)
        if(sendBtn) sendBtn.disabled = false;
        if(promptEl) promptEl.disabled = false;
      }
    }

    // Start processing
    processNextStep();

  }, preDelay);
}




  if(sendBtn) sendBtn.addEventListener('click', handleSend);
  if(promptEl) promptEl.addEventListener('keydown', (e)=> {
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); handleSend(); }
  });

  // Note: Save Chat button removed - chats are automatically saved to Supabase
  // Chat titles are set automatically based on the first message or can be updated programmatically

  // Setup language dropdown
  setupLanguageDropdown();

  // Setup search overlay
  setupSearchOverlay();

  // basic esc to close collapsed sidebar on mobile: clicking outside closes (optional)
  document.addEventListener('click', (e) => {
    if(window.innerWidth < 900 && sidebar && !sidebar.contains(e.target) && !sidebar.classList.contains('collapsed')) {
      sidebar.classList.add('collapsed');
    }
  });
  
  // Ensure logout handler is attached (already set up earlier, but ensure it's there)
  setupLogout();

  // helper to escape html
  function escapeHtml(str){
    return String(str).replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
  }

  // Generate and download PDF report
  function generatePDFReport(message){
    const reportContent = `authentIC - IC Authenticity Report
Generated: ${new Date().toLocaleString()}
Report ID: ${message._reportId || 'N/A'}

========================================

${message.text.replace(/\*\*/g, '').replace(/•/g, '-').replace(/✓/g, '[PASS]').replace(/⚠/g, '[WARNING]')}

========================================

TECHNICAL DETAILS
- Analysis Engine: authentIC v2.1
- Model Version: MultiModal-IC-Detector-2024
- Processing Time: ${(Math.random() * 3 + 1).toFixed(2)}s
- Confidence Threshold: 85%
- Golden IC Database Version: 2024.10

INCLUDED ASSETS
- SR-enhanced marking crop (SR_marking_crop.png)
- Logo match overlay (logo_overlay.png)
- Pin index & pitch map (pin_overlay.png)
- Texture anomaly heatmap (texture_heatmap.png)
- Extracted datasheet snippet (datasheet_excerpt.pdf)

For support or questions, contact: support@authentic-ic.ai

This report is generated for demonstration purposes.
© 2025 authentIC - All Rights Reserved`;

    // Create blob and download
    const blob = new Blob([reportContent], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `authentIC_Report_${message._reportId || Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Load chats from Supabase on page load
  async function loadChats() {
    console.log('[Chat] Loading chats on page load...');
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatId');
    const isNewChatRequest = urlParams.get('new') === 'true';
    
    console.log('[Chat] URL params - chatId:', chatId, 'new:', isNewChatRequest);
    
    if (chatService) {
      console.log('[Chat] Using Supabase to load chats');
      try {
        const supabaseChats = await chatService.getUserChats();
        console.log('[Chat] Received', supabaseChats.length, 'chats from Supabase');
        
        chats = supabaseChats.map(chat => ({
          id: chat.id,
          title: chat.title,
          messages: [], // Messages will be loaded when chat is selected
          created_at: chat.created_at,
          updated_at: chat.updated_at
        }));
        
        console.log('[Chat] Chats processed and stored locally');
        
        if (isNewChatRequest) {
          console.log('[Chat] New chat requested, creating...');
          const newChat = await createChat('New Detection');
          console.log('[Chat] New chat created:', newChat);
          // Reload chats from Supabase to ensure sidebar is updated
          const updatedChats = await chatService.getUserChats();
          chats = updatedChats.map(chat => ({
            id: chat.id,
            title: chat.title,
            messages: [],
            created_at: chat.created_at,
            updated_at: chat.updated_at
          }));
          console.log('[Chat] Re-rendering chat list with', chats.length, 'chats');
          renderChatList();
          
          // Verify chat list was rendered
          setTimeout(() => {
            const renderedItems = document.querySelectorAll('#chatList .chat-item');
            console.log('[Chat] Verification: Chat list rendered with', renderedItems.length, 'items');
            console.log('[Chat] Expected', chats.length, 'chats');
            if (renderedItems.length !== chats.length) {
              console.warn('[Chat] Mismatch! Re-rendering...');
              renderChatList();
            }
          }, 200);
          
          // Set the newly created chat as active
          if (newChat && newChat.id) {
            console.log('[Chat] Setting newly created chat as active:', newChat.id);
            await setActiveChat(newChat.id);
          }
          
          window.history.replaceState({}, '', 'query.html');
          console.log('[Chat] New chat flow completed successfully');
        } else if (chatId) {
          // Load specific chat
          console.log('[Chat] Loading specific chat:', chatId);
          await setActiveChat(chatId);
          window.history.replaceState({}, '', 'query.html');
        } else {
          // Load first chat if available
          if (chats.length > 0) {
            console.log('[Chat] Loading first chat:', chats[0].id);
            await setActiveChat(chats[0].id);
          } else {
            console.log('[Chat] No chats found, creating default chat');
            await createChat('IC Check 1');
          }
        }
        
        renderChatList();
        console.log('[Chat] Chat list rendered');
      } catch (error) {
        console.error('[Chat] Error loading chats:', error);
        console.error('[Chat] Error details:', error.message);
        // Fallback: create default chat
        if (chats.length === 0) {
          console.log('[Chat] Fallback: Creating default chat');
          await createChat('IC Check 1');
        }
      }
    } else {
      console.log('[Chat] ChatService not available, using fallback');
      // Fallback: check URL params
      if (isNewChatRequest) {
        console.log('[Chat] Creating new chat (fallback)');
        await createChat('New Detection');
        window.history.replaceState({}, '', 'query.html');
      } else if (chats.length === 0) {
        console.log('[Chat] Creating default chat (fallback)');
        await createChat('IC Check 1');
      }
    }
    
    console.log('[Chat] Chat loading completed');
  }

  // Initialize: Load chats
  console.log('[Chat] Starting chat initialization...');
  loadChats().then(() => {
    console.log('[Chat] Chat initialization completed');
  }).catch(err => {
    console.error('[Chat] Error initializing chats:', err);
  });
  
  // Final check: Verify button handler is attached
  const finalCheckBtn = document.getElementById('newChatBtn');
  if (finalCheckBtn) {
    console.log('[Chat] Final check: Button exists');
  } else {
    console.error('[Chat] Final check: Button STILL not found!');
  }
});
}); // End of checkAuth promise

// Also set up button handler outside of DOMContentLoaded as fallback
// This ensures it works even if DOMContentLoaded already fired
(function() {
  console.log('[Chat] Setting up fallback button handler...');
  function setupFallback() {
    const btn = document.getElementById('newChatBtn');
    if (btn && !btn.dataset.handlerAttached) {
      console.log('[Chat] Fallback: Attaching handler to button');
      btn.dataset.handlerAttached = 'true';
      btn.addEventListener('click', async function(e) {
        console.log('[Chat] FALLBACK HANDLER: New Chat clicked!');
        e.preventDefault();
        e.stopPropagation();
        
        if (!window.location.pathname.includes('query.html')) {
          window.location.href = 'query.html?new=true';
        } else {
          // Trigger page reload with new=true to create chat
          console.log('[Chat] Fallback: Reloading with new=true');
          window.location.href = 'query.html?new=true';
        }
      });
    } else if (!btn) {
      setTimeout(setupFallback, 100);
    }
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupFallback);
  } else {
    setupFallback();
  }
})();

// Global function for inline onclick handler (fallback)
window.handleNewChatClick = async function(e) {
  console.log('[Chat] ========== INLINE HANDLER TRIGGERED ==========');
  console.log('[Chat] INLINE HANDLER: New Chat button clicked!');
  console.log('[Chat] Event:', e);
  console.log('[Chat] Current URL:', window.location.href);
  
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  // Check user type - business users should not access chat interface
  const userType = localStorage.getItem('authentIC_userType');
  if (userType === 'business') {
    console.log('[Chat] Business user detected, redirecting to dashboard');
    window.location.href = 'dashboard.html';
    return;
  }
  
  // Check if we're on query page
  if (!window.location.pathname.includes('query.html')) {
    console.log('[Chat] Not on query page, navigating to query.html?new=true');
    window.location.href = 'query.html?new=true';
    return;
  }
  
  // If already on query page, try to create chat
  console.log('[Chat] Already on query page, attempting to create chat');
  console.log('[Chat] Checking if createChat is available:', typeof window.createChat);
  
  // Wait a bit for createChat to be available if it's not yet
  let attempts = 0;
  while (typeof window.createChat !== 'function' && attempts < 10) {
    console.log('[Chat] Waiting for createChat to be available, attempt:', attempts + 1);
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }
  
  try {
    // Check if createChat is available in window scope
    if (typeof window.createChat === 'function') {
      console.log('[Chat] Calling window.createChat...');
      await window.createChat('New Detection');
      console.log('[Chat] Chat created via inline handler');
    } else {
      // Reload with new=true parameter
      console.log('[Chat] createChat not available after waiting, reloading with new=true');
      window.location.href = 'query.html?new=true';
    }
  } catch (error) {
    console.error('[Chat] Error in inline handler:', error);
    console.error('[Chat] Error stack:', error.stack);
    // Fallback: reload with new=true
    alert('Creating new chat...');
    window.location.href = 'query.html?new=true';
  }
};

// Setup language dropdown (same as dashboard)
function setupLanguageDropdown() {
  const langBtn = document.getElementById('langBtn');
  const langMenu = document.getElementById('langMenu');
  const langDisplay = document.getElementById('langDisplay');
  
  if (!langBtn || !langMenu || !langDisplay) {
    console.log('[Chat] Language dropdown elements not found');
    return;
  }
  
  // Load saved language preference (default to English)
  const savedLang = localStorage.getItem('authentIC_language') || 'en';
  const savedLangOption = document.querySelector(`.lang-option[data-lang="${savedLang}"]`);
  if (savedLangOption) {
    langDisplay.textContent = savedLangOption.dataset.code;
    document.querySelectorAll('.lang-option').forEach(opt => opt.classList.remove('active'));
    savedLangOption.classList.add('active');
    // Translate page if function is available and language is not English
    if (savedLang !== 'en') {
      setTimeout(() => {
        if (typeof window.translatePage === 'function') {
          window.translatePage(savedLang);
        }
      }, 100);
    }
  }

  // Toggle dropdown
  langBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[Chat] Language button clicked');
    
    // Close all other dropdowns first (if any)
    document.querySelectorAll('.lang-menu').forEach(menu => {
      if (menu !== langMenu) menu.classList.remove('show');
    });
    
    // Toggle this menu
    langMenu.classList.toggle('show');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!langBtn.contains(e.target) && !langMenu.contains(e.target)) {
      langMenu.classList.remove('show');
    }
  });

  // Handle language selection
  document.querySelectorAll('.lang-option').forEach(option => {
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      const lang = option.dataset.lang;
      const code = option.dataset.code;
      
      // Update display
      langDisplay.textContent = code;
      
      // Update active state
      document.querySelectorAll('.lang-option').forEach(opt => opt.classList.remove('active'));
      option.classList.add('active');
      
      // Save preference
      localStorage.setItem('authentIC_language', lang);
      
      // Close dropdown
      langMenu.classList.remove('show');
      
      // Translate the page immediately
      if (typeof window.translatePage === 'function') {
        window.translatePage(lang).catch(err => {
          console.error('[Chat] Translation error:', err);
        });
      } else {
        console.error('[Chat] translatePage function not found');
        document.documentElement.lang = lang;
      }
      
      // Show confirmation (optional)
      console.log(`[Chat] Language changed to: ${option.textContent}`);
    });
  });
}

// Setup search overlay functionality
function setupSearchOverlay() {
  const searchChatsBtn = document.getElementById('searchChatsBtn');
  const searchOverlay = document.getElementById('searchOverlay');
  const closeSearchBtn = document.getElementById('closeSearchBtn');
  const searchChatInput = document.getElementById('searchChatInput');
  const searchResults = document.getElementById('searchResults');

  if (!searchChatsBtn || !searchOverlay || !closeSearchBtn || !searchChatInput || !searchResults) {
    console.log('[Chat] Search overlay elements not found');
    return;
  }

  // Open search overlay
  searchChatsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    console.log('[Chat] Opening search overlay');
    searchOverlay.style.display = 'flex';
    setTimeout(() => {
      searchChatInput.focus();
    }, 100);
    // Load all chats for search
    performSearch('');
  });

  // Close search overlay
  function closeSearchOverlay() {
    searchOverlay.style.display = 'none';
    searchChatInput.value = '';
    searchResults.innerHTML = '';
  }

  closeSearchBtn.addEventListener('click', closeSearchOverlay);

  // Close on overlay background click
  searchOverlay.addEventListener('click', (e) => {
    if (e.target === searchOverlay) {
      closeSearchOverlay();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchOverlay.style.display === 'flex') {
      closeSearchOverlay();
    }
  });

  // Perform search as user types
  searchChatInput.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    performSearch(query);
  });

  // Perform search function
  async function performSearch(query) {
    console.log('[Chat] Performing search with query:', query);
    
    try {
      // Get all chats from Supabase or local storage
      let allChats = [];
      
      if (typeof chatService !== 'undefined') {
        try {
          allChats = await chatService.getUserChats();
          console.log('[Chat] Loaded', allChats.length, 'chats from Supabase');
        } catch (error) {
          console.error('[Chat] Error loading chats from Supabase:', error);
          // Fallback to local chats array if available
          if (typeof chats !== 'undefined') {
            allChats = chats;
          }
        }
      } else if (typeof chats !== 'undefined') {
        allChats = chats;
      }

      // Filter chats based on query
      const filteredChats = query === '' 
        ? allChats 
        : allChats.filter(chat => 
            chat.title.toLowerCase().includes(query)
          );

      // Render results
      renderSearchResults(filteredChats);
    } catch (error) {
      console.error('[Chat] Error performing search:', error);
      searchResults.innerHTML = '<div class="search-result-item"><div class="search-result-item-title">Error loading chats</div></div>';
    }
  }

  // Render search results
  function renderSearchResults(chats) {
    if (chats.length === 0) {
      searchResults.innerHTML = '<div class="search-result-item"><div class="search-result-item-title" style="color: var(--muted);">No chats found</div></div>';
      return;
    }

    searchResults.innerHTML = chats.map(chat => {
      const time = chatService && chat.updated_at 
        ? chatService.formatTime(chat.updated_at)
        : chat.time 
        ? new Date(chat.time).toLocaleDateString()
        : 'Recently';
      
      return `
        <div class="search-result-item" data-chat-id="${chat.id}" onclick="window.location.href='query.html?chatId=${chat.id}'">
          <div class="search-result-item-title">${escapeHtml(chat.title || 'Untitled Chat')}</div>
          <div class="search-result-item-time">${time}</div>
        </div>
      `;
    }).join('');
  }

  // Helper function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
