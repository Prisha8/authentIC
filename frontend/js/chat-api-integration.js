// API Integration for Chat Interface
// This replaces the hardcoded demo in chat.js with real API calls

console.log('===========================================');
console.log('[API Integration] Script loaded!');
console.log('===========================================');

// Override the handleSend function with API integration
(function() {
  console.log('[API Integration] Starting initialization...');
  
  // Wait for DOM and chat.js to load - with delay to ensure chat.js initializes first
  function initAPIIntegration() {
    console.log('[API Integration] Attempting to initialize...');
    
    // Check if required elements exist
    const sendBtn = document.getElementById('sendBtn');
    const promptEl = document.getElementById('prompt');
    const messagesEl = document.getElementById('messages');
    
    if (!sendBtn || !promptEl || !messagesEl) {
      console.log('[API Integration] DOM elements not ready yet, retrying in 500ms...');
      setTimeout(initAPIIntegration, 500);
      return;
    }
    
    console.log('[API Integration] DOM ready, setting up API integration...');
    console.log('[API Integration] Send button found:', sendBtn);
    console.log('[API Integration] Button ID:', sendBtn.id);
    console.log('[API Integration] Button text:', sendBtn.textContent);
    
    // Wait a bit longer to ensure chat.js has added its listener
    setTimeout(() => {
      console.log('[API Integration] Now overriding send button handler...');
      
      // Remove existing event listeners by cloning the button
      const newSendBtn = sendBtn.cloneNode(true);
      sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);
      console.log('[API Integration] Button cloned and replaced');
    
    // Add click handler to new button
    console.log('[API Integration] Adding click handler to button...');
    newSendBtn.addEventListener('click', async function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
      console.log('[API Integration] BUTTON CLICKED!!!');
      console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
      await handleSendWithAPI();
    });
    
    console.log('[API Integration] Button handler attached successfully');
    
    // Also handle Enter key on prompt
    promptEl.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        console.log('[API Integration] Enter key pressed!');
        await handleSendWithAPI();
      }
    });
    
    // Define processing steps
    const REAL_PROCESSING_STEPS = [
      { text: '🔍 Identifying IC from image...', key: 'identification' },
      { text: '📥 Searching for OEM datasheet...', key: 'datasheet_search' },
      { text: '📄 Parsing datasheet and extracting diagrams...', key: 'datasheet_parse' },
      { text: '🤖 Extracting dimensions using AI...', key: 'gemini_extraction' },
      { text: '📐 Analyzing physical dimensions...', key: 'dimension_analysis' },
      { text: '👁️ Performing visual analysis...', key: 'visual_analysis' },
      { text: '⚖️ Computing final verdict...', key: 'verdict' },
      { text: '📄 Generating detailed report...', key: 'report' }
    ];
    
    // Helper function to save messages without images (to avoid localStorage quota)
    function saveMessagesToStorage(messages) {
      const messagesToSave = messages.map(msg => {
        const { img, ...msgWithoutImg } = msg;
        return msgWithoutImg;
      });
      try {
        localStorage.setItem('api_chat_messages', JSON.stringify(messagesToSave));
      } catch (e) {
        console.warn('[API Integration] Could not save to localStorage (quota exceeded):', e);
        // Clear old messages and try again with only last 10
        localStorage.removeItem('api_chat_messages');
        try {
          localStorage.setItem('api_chat_messages', JSON.stringify(messagesToSave.slice(-10)));
        } catch (e2) {
          console.error('[API Integration] Still failed to save:', e2);
        }
      }
    }
    
    async function handleSendWithAPI() {
      console.log('========================================');
      console.log('[API Integration] handleSendWithAPI called');
      console.log('========================================');
      
      const promptEl = document.getElementById('prompt');
      const sendBtn = newSendBtn; // Use the cloned button
      const imgInput = document.getElementById('imgInput');
      const imagePreview = document.getElementById('imagePreview');
      const previewImg = document.getElementById('previewImg');
      const messagesEl = document.getElementById('messages');
      
      if (!promptEl || !sendBtn) {
        console.error('[API Integration] Required elements not found');
        return;
      }
      
      const text = promptEl.value.trim();
      
      // Get attached file
      let attachedFile = null;
      if (imgInput && imgInput.files && imgInput.files.length > 0) {
        attachedFile = imgInput.files[0];
      }
      
      console.log('[API Integration] Text:', text);
      console.log('[API Integration] Has file:', !!attachedFile);
      console.log('[API Integration] File input element:', imgInput);
      console.log('[API Integration] Files:', imgInput ? imgInput.files : 'no input');
      
      if (!text && !attachedFile) {
        alert('Please write a prompt or attach an image.');
        return;
      }
      
      // Create a simple chat object for message storage
      // We'll use localStorage to persist messages
      let chat = {
        id: 'api_chat_' + Date.now(),
        title: 'IC Detection',
        messages: []
      };
      
      // Try to load existing messages from localStorage
      const savedMessages = localStorage.getItem('api_chat_messages');
      if (savedMessages) {
        try {
          const parsed = JSON.parse(savedMessages);
          // Filter out any blob URLs (they don't work in Electron)
          chat.messages = parsed.map(msg => {
            if (msg.img && msg.img.startsWith('blob:')) {
              // Remove blob URLs - they're invalid
              delete msg.img;
            }
            return msg;
          });
        } catch (e) {
          console.warn('[API Integration] Could not parse saved messages');
        }
      }
      
      console.log('[API Integration] Using chat object:', chat.id);
      
      // Build user message
      const userMsg = {
        role: 'user',
        text: text || '(image attached)',
        time: Date.now(),
        img: null
      };
      
      let imageUrl = null;
      if (attachedFile) {
        // Convert to data URL for Electron compatibility
        const reader = new FileReader();
        await new Promise((resolve, reject) => {
          reader.onload = (e) => {
            userMsg.img = e.target.result; // data URL
            imageUrl = e.target.result;
            resolve();
          };
          reader.onerror = reject;
          reader.readAsDataURL(attachedFile);
        });
      }
      
      chat.messages.push(userMsg);
      
      // Save to localStorage (without images - they're too large)
      saveMessagesToStorage(chat.messages);
      
      // Clear input
      promptEl.value = '';
      if (imgInput) imgInput.value = '';
      if (imagePreview) imagePreview.style.display = 'none';
      if (previewImg) previewImg.src = '';
      
      // Always use fallback rendering
      renderMessagesFallback(chat, messagesEl);
      
      // Disable controls
      sendBtn.disabled = true;
      promptEl.disabled = true;
      
      // If no image, show error
      if (!attachedFile) {
        const errorMsg = {
          role: 'bot',
          text: '⚠️ Please attach an IC image to analyze.',
          time: Date.now()
        };
        chat.messages.push(errorMsg);
        saveMessagesToStorage(chat.messages);
        renderMessagesFallback(chat, messagesEl);
        sendBtn.disabled = false;
        promptEl.disabled = false;
        return;
      }
      
      // Show simple loading message (real-time, not fake progress)
      const thinkingMsg = {
        role: 'bot',
        text: '⏳ Analyzing IC image... This may take 30-60 seconds.',
        time: Date.now(),
        _thinking: true
      };
      chat.messages.push(thinkingMsg);
      localStorage.setItem('api_chat_messages', JSON.stringify(chat.messages));
      renderMessagesFallback(chat, messagesEl);
      
      // Start API call
      try {
        console.log('[API Integration] Starting API call...');
        console.log('[API Integration] File:', attachedFile.name, attachedFile.size, 'bytes');
        console.log('[API Integration] API URL:', window.icDetectionAPI.baseUrl);
        
        // Update loading message periodically to show it's still working (real-time feedback)
        let dotCount = 0;
        const loadingInterval = setInterval(() => {
          dotCount = (dotCount + 1) % 4;
          const dots = '.'.repeat(dotCount);
          thinkingMsg.text = `⏳ Analyzing IC image${dots} This may take 30-60 seconds.`;
          saveMessagesToStorage(chat.messages);
          renderMessagesFallback(chat, messagesEl);
        }, 500);
        
        // Call API (this will take 25-40 seconds - real processing)
        console.log('[API Integration] Calling detectIC...');
        const result = await window.icDetectionAPI.detectIC(attachedFile);
        console.log('[API Integration] API response received:', result);
        
        // Stop loading animation
        clearInterval(loadingInterval);
        
        // Remove thinking message
        const thinkingIdx = chat.messages.findIndex(m => m._thinking);
        if (thinkingIdx !== -1) {
          chat.messages.splice(thinkingIdx, 1);
        }
        
        console.log('[API Integration] API response:', result);
        
        // Display results as chat messages
        if (result.status === 'completed' && result.result) {
          const apiResult = result.result;
          
          // Format chat response messages
          if (apiResult.chat_response && Array.isArray(apiResult.chat_response)) {
            apiResult.chat_response.forEach(msg => {
              const formattedMsg = {
                role: 'bot',
                text: formatAPIMessage(msg),
                time: Date.now(),
                _messageType: msg.type
              };
              chat.messages.push(formattedMsg);
            });
          } else {
            // Fallback: create summary message
            const summaryMsg = {
              role: 'bot',
              text: formatSummaryMessage(apiResult),
              time: Date.now()
            };
            chat.messages.push(summaryMsg);
          }
          
          // Add download button
          const downloadMsg = {
            role: 'bot',
            text: '📄 **Download Detailed Report**\n\nA comprehensive PDF report with annotated images and analysis has been generated.',
            time: Date.now(),
            _hasReport: true,
            _sessionId: result.session_id
          };
          chat.messages.push(downloadMsg);
          
          // Save messages to localStorage
          saveMessagesToStorage(chat.messages);
          
        } else {
          // Error response
          const errorMsg = {
            role: 'bot',
            text: `❌ **Detection Failed**\n\n${result.error || 'Unknown error occurred'}`,
            time: Date.now()
          };
          chat.messages.push(errorMsg);
          saveMessagesToStorage(chat.messages);
        }
        
      } catch (error) {
        console.error('[API Integration] API call failed:', error);
        
        // Remove thinking message
        const thinkingIdx = chat.messages.findIndex(m => m._thinking);
        if (thinkingIdx !== -1) {
          chat.messages.splice(thinkingIdx, 1);
        }
        
        // Show error message
        const errorMsg = {
          role: 'bot',
          text: `❌ **Error**\n\n${error.message}\n\nPlease make sure the backend server is running on port 5001.`,
          time: Date.now()
        };
        chat.messages.push(errorMsg);
        saveMessagesToStorage(chat.messages);
      }
      
      // Save all messages to localStorage
      localStorage.setItem('api_chat_messages', JSON.stringify(chat.messages));
      
      // Re-enable controls
      sendBtn.disabled = false;
      promptEl.disabled = false;
      
      // Render final messages
      renderMessagesFallback(chat, messagesEl);
    }
    
    // Format API message for display
    function formatAPIMessage(msg) {
      const icons = {
        'step': '📋',
        'warning': '⚠️',
        'success': '✅',
        'verdict': '🎯',
        'action': '📄'
      };
      
      const icon = icons[msg.type] || '•';
      let formatted = `${icon} **${msg.title}**\n\n${msg.content}`;
      
      // Add color coding for verdict
      if (msg.type === 'verdict' && msg.color) {
        const colorEmoji = {
          'success': '✅',
          'warning': '⚠️',
          'danger': '❌',
          'info': 'ℹ️'
        };
        formatted = `${colorEmoji[msg.color] || ''} ${formatted}`;
      }
      
      return formatted;
    }
    
    // Fallback render function
    function renderMessagesFallback(chat, container) {
      if (!chat || !chat.messages || !container) return;
      
      container.innerHTML = '';
      const chatCard = document.createElement('div');
      chatCard.className = 'chat-card';
      
      chat.messages.forEach(msg => {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'msg ' + (msg.role === 'user' ? 'user' : 'bot');
        
        if (msg.img) {
          // Only render data URLs (blob URLs don't work in Electron)
          if (msg.img.startsWith('data:image/')) {
            const img = document.createElement('img');
            img.src = msg.img;
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.style.borderRadius = '8px';
            img.style.marginBottom = '10px';
            img.onerror = () => {
              console.error('[API Integration] Failed to load image');
              img.style.display = 'none';
            };
            msgDiv.appendChild(img);
          } else if (msg.img.startsWith('blob:')) {
            // Skip blob URLs - they're invalid
            console.warn('[API Integration] Skipping blob URL:', msg.img);
          }
        }
        
        if (msg.text) {
          const textDiv = document.createElement('div');
          textDiv.innerHTML = msg.text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
          textDiv.style.whiteSpace = 'pre-line';
          msgDiv.appendChild(textDiv);
        }
        
        if (msg._hasReport) {
          const btn = document.createElement('button');
          btn.className = 'download-report-btn';
          btn.textContent = '📄 Download Full Report (PDF)';
          btn.onclick = () => {
            if (msg._sessionId) {
              window.icDetectionAPI.downloadReport(msg._sessionId);
            }
          };
          msgDiv.appendChild(btn);
        }
        
        chatCard.appendChild(msgDiv);
      });
      
      container.appendChild(chatCard);
      container.scrollTop = container.scrollHeight;
    }
    
    // Format summary message (fallback)
    function formatSummaryMessage(result) {
      return `**Detection Complete**\n\n` +
             `**Verdict:** ${result.verdict}\n` +
             `**Score:** ${result.score}/100\n` +
             `**Part Number:** ${result.part_number}\n` +
             `**Manufacturer:** ${result.manufacturer}\n` +
             `**Package:** ${result.package_type}\n` +
             `**Anomalies:** ${result.anomalies_count}`;
    }
    
    // Override download report function
    window.generatePDFReport = function(message) {
      if (message._sessionId) {
        console.log('[API Integration] Downloading report for session:', message._sessionId);
        window.icDetectionAPI.downloadReport(message._sessionId);
      } else {
        console.error('[API Integration] No session ID found for report download');
        alert('Report not available');
      }
    };
    
    // Clear old messages with images/data URLs (they're too large for localStorage)
    const savedMessages = localStorage.getItem('api_chat_messages');
    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        const hasImages = parsed.some(msg => msg.img);
        if (hasImages) {
          console.log('[API Integration] Clearing old messages with images (too large for localStorage)');
          localStorage.removeItem('api_chat_messages');
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    console.log('[API Integration] Setup complete!');
    }, 1000); // Wait 1 second for chat.js to fully initialize
  }
  
  // Start initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAPIIntegration);
  } else {
    // DOM already loaded
    initAPIIntegration();
  }
})();

