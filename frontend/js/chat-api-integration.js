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
    
    // Helper: manage preview UI for attached image
    function clearImagePreview() {
      const imgInputEl = document.getElementById('imgInput');
      const imagePreview = document.getElementById('imagePreview');
      const previewImg = document.getElementById('previewImg');
      if (imgInputEl) imgInputEl.value = '';
      if (previewImg) previewImg.src = '';
      if (imagePreview) imagePreview.style.display = 'none';
    }

    function setupImagePreview() {
      const imgInputEl = document.getElementById('imgInput');
      const imagePreview = document.getElementById('imagePreview');
      const previewImg = document.getElementById('previewImg');
      const removePreview = document.getElementById('removePreview');

      if (!imgInputEl || !imagePreview || !previewImg || !removePreview) {
        console.log('[API Integration] Preview elements missing, skip preview setup');
        return;
      }

      imgInputEl.addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) {
          clearImagePreview();
          return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
          previewImg.src = e.target.result;
          imagePreview.style.display = 'block';
        };
        reader.readAsDataURL(file);
      });

      removePreview.addEventListener('click', (e) => {
        e.preventDefault();
        clearImagePreview();
      });
    }

    // Wait a bit longer to ensure chat.js has added its listener
    setTimeout(() => {
      console.log('[API Integration] Now overriding send button handler...');
      
      // Remove existing event listeners by cloning the button
      const newSendBtn = sendBtn.cloneNode(true);
      sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);
      console.log('[API Integration] Button cloned and replaced');
    
    // Add click handler to new button
    console.log('[API Integration] Adding click handler to button...');
    setupImagePreview();

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
    
    // Define processing steps (no emojis)
    const REAL_PROCESSING_STEPS = [
      { text: 'Identifying IC from image', key: 'identification' },
      { text: 'Searching for OEM datasheet', key: 'datasheet_search' },
      { text: 'Parsing datasheet and extracting diagrams', key: 'datasheet_parse' },
      { text: 'Estimating dimensions using computer vision', key: 'gemini_extraction' },
      { text: 'Analyzing physical dimensions', key: 'dimension_analysis' },
      { text: 'Performing visual analysis', key: 'visual_analysis' },
      { text: 'Computing final verdict', key: 'verdict' },
      { text: 'Generating detailed report', key: 'report' }
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
    
    // Get or create session ID for conversational agent
    function getSessionId() {
      let sessionId = localStorage.getItem('api_chat_session_id');
      if (!sessionId) {
        sessionId = 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('api_chat_session_id', sessionId);
      }
      return sessionId;
    }
    
    // Clear session (for new chat)
    function clearSession() {
      localStorage.removeItem('api_chat_session_id');
      localStorage.removeItem('api_chat_messages');
    }
    
    async function handleSendWithAPI() {
      console.log('========================================');
      console.log('[API Integration] handleSendWithAPI called');
      console.log('========================================');
      
      const promptEl = document.getElementById('prompt');
      const sendBtn = newSendBtn; // Use the cloned button
      const imgInput = document.getElementById('imgInput');
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
      
      if (!text && !attachedFile) {
        alert('Please write a prompt or attach an image.');
        return;
      }
      
      // Get the active chat from chat.js if available
      let chat = null;
      
      // Try to get active chat from chat.js
      if (typeof window.getActiveChat === 'function') {
        chat = window.getActiveChat();
        console.log('[API Integration] Using active chat from chat.js:', chat ? chat.id : 'none');
      }
      
      // If no active chat, create a temporary one (fallback for standalone mode)
      if (!chat) {
        console.log('[API Integration] No active chat found, creating temporary chat');
        chat = {
        id: 'api_chat_' + Date.now(),
        title: 'IC Detection',
        messages: []
      };
      
        // Only load from localStorage if this is text-only (continuation)
        if (!attachedFile) {
      const savedMessages = localStorage.getItem('api_chat_messages');
      if (savedMessages) {
        try {
          const parsed = JSON.parse(savedMessages);
          chat.messages = parsed.map(msg => {
            if (msg.img && msg.img.startsWith('blob:')) {
              delete msg.img;
            }
            return msg;
          });
        } catch (e) {
          console.warn('[API Integration] Could not parse saved messages');
        }
          }
        }
      } else {
        // Using active chat from chat.js - ensure messages array exists
        if (!chat.messages) {
          chat.messages = [];
        }
        console.log('[API Integration] Active chat has', chat.messages.length, 'messages');
      }
      
      // If user is asking a question during processing, handle it conversationally
      if (!attachedFile && text && chat.messages.some(m => m._processChain && !m._completed)) {
        // User is asking a question while detection is in progress
        const userMsg = {
          role: 'user',
          text: text,
          time: Date.now()
        };
        chat.messages.push(userMsg);
        saveMessagesToStorage(chat.messages);
        renderMessagesFallback(chat, messagesEl);
        
        // Show a conversational response
        const thinkingMsg = {
          role: 'bot',
          text: '💭 Let me check on the current analysis progress...',
          time: Date.now(),
          _thinking: true
        };
        chat.messages.push(thinkingMsg);
        saveMessagesToStorage(chat.messages);
        renderMessagesFallback(chat, messagesEl);
        
        // Get current process status and respond conversationally
        setTimeout(() => {
          const processChainMsg = chat.messages.find(m => m._processChain && !m._completed);
          if (processChainMsg && processChainMsg._steps) {
            const currentStep = Object.values(processChainMsg._steps).find(s => s.status === 'running');
            const completedSteps = Object.values(processChainMsg._steps).filter(s => s.status === 'completed');
            
            let response = '';
            if (currentStep) {
              response = `I'm currently **${currentStep.title.toLowerCase()}**. `;
              if (currentStep.message) {
                response += currentStep.message + ' ';
              }
              response += `I've completed ${completedSteps.length} steps so far. Would you like to know more about any specific step?`;
            } else {
              response = `I've completed ${completedSteps.length} steps. The analysis is progressing well! Is there anything specific you'd like to know?`;
            }
            
            const botResponse = {
              role: 'bot',
              text: response,
              time: Date.now()
            };
            
            // Remove thinking message
            const thinkingIdx = chat.messages.findIndex(m => m._thinking);
            if (thinkingIdx !== -1) {
              chat.messages.splice(thinkingIdx, 1);
            }
            
            chat.messages.push(botResponse);
            saveMessagesToStorage(chat.messages);
            renderMessagesFallback(chat, messagesEl);
          }
        }, 500);
        
        promptEl.value = '';
        return;
      }
      
      // Handle text-only queries with conversational agent (no image attached)
      if (!attachedFile && text) {
        const userMsg = {
          role: 'user',
          text: text,
          time: Date.now()
        };
        chat.messages.push(userMsg);
        saveMessagesToStorage(chat.messages);
        renderMessagesFallback(chat, messagesEl);
        
        // Show thinking indicator
        const thinkingMsg = {
          role: 'bot',
          text: '💭 Thinking...',
          time: Date.now(),
          _thinking: true
        };
        chat.messages.push(thinkingMsg);
        saveMessagesToStorage(chat.messages);
        renderMessagesFallback(chat, messagesEl);
        
        // Call conversational agent
        try {
          const sessionId = getSessionId();
          
          // Prepare chat history for agent - include analysis context
          const chatHistory = [];
          
          // Extract IC information from analysis results
          let icInfo = null;
          
          // First, try to get IC info from process chain steps
          const processChainMsg = chat.messages.find(m => m._processChain);
          if (processChainMsg && processChainMsg._steps) {
            const identifyStep = processChainMsg._steps.identify;
            if (identifyStep && identifyStep.output) {
              icInfo = identifyStep.output;
            }
          }
          
          // Also check final results messages for IC info
          const resultMessages = chat.messages.filter(m => m._sessionId);
          if (resultMessages.length > 0 && !icInfo) {
            // Try to extract from result message text (contains part number, manufacturer, etc.)
            const latestResult = resultMessages[resultMessages.length - 1];
            if (latestResult._icInfo) {
              icInfo = latestResult._icInfo;
            }
          }
          
          // Add IC context to chat history if available
          if (icInfo && (icInfo.part_number || icInfo.manufacturer)) {
            chatHistory.push({
              role: 'system',
              content: `IC Analysis Context: The user has analyzed an IC with the following details:\n` +
                       `- Part Number: ${icInfo.part_number || 'Unknown'}\n` +
                       `- Manufacturer: ${icInfo.manufacturer || 'Unknown'}\n` +
                       `- Package Type: ${icInfo.package_type || 'Unknown'}\n` +
                       `- Pin Count: ${icInfo.pin_count || 'Unknown'}\n` +
                       `\nYou should remember this IC information when answering questions about testing, circuits, manual verification steps, or any technical details about this specific IC.`
            });
          }
          
          // Add analysis results summary if available
          const summaryMessages = chat.messages.filter(m => m._sessionId && m._hasReport);
          if (summaryMessages.length > 0) {
            const latestSummary = summaryMessages[summaryMessages.length - 1];
            if (latestSummary.text) {
              chatHistory.push({
                role: 'system',
                content: `Analysis Results Summary:\n${latestSummary.text}\n\nRemember these analysis results when answering questions about the IC's authenticity, anomalies, or verification status.`
              });
            }
          }
          
          // Add regular chat messages (excluding UI-only messages)
          const regularMessages = chat.messages
            .filter(m => !m._thinking && !m._processChain && m.text) // Exclude UI-only messages but keep result summaries
            .map(m => ({
              role: m.role === 'user' ? 'user' : 'bot',
              content: m.text || ''
            }));
          
          chatHistory.push(...regularMessages);
          
          const response = await fetch('http://localhost:5001/api/chat', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              message: text,
              session_id: sessionId,
              chat_history: chatHistory
            })
          });
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const data = await response.json();
          
          // Remove thinking message
          const thinkingIdx = chat.messages.findIndex(m => m._thinking);
          if (thinkingIdx !== -1) {
            chat.messages.splice(thinkingIdx, 1);
          }
          
          // Add agent response
          const botResponse = {
            role: 'bot',
            text: data.response,
            time: Date.now()
          };
          chat.messages.push(botResponse);
          saveMessagesToStorage(chat.messages);
          renderMessagesFallback(chat, messagesEl);
          
          // If agent says we should trigger detection, do it
          if (data.should_trigger_detection && attachedFile) {
            // This shouldn't happen since we're in text-only branch, but handle it
            console.log('[API Integration] Agent requested detection but no image attached');
          }
          
        } catch (error) {
          console.error('[API Integration] Chat error:', error);
          
          // Remove thinking message
          const thinkingIdx = chat.messages.findIndex(m => m._thinking);
          if (thinkingIdx !== -1) {
            chat.messages.splice(thinkingIdx, 1);
          }
          
          // Show error
          const errorMsg = {
            role: 'bot',
            text: `❌ Sorry, I encountered an error: ${error.message}. Please try again.`,
            time: Date.now()
          };
          chat.messages.push(errorMsg);
          saveMessagesToStorage(chat.messages);
          renderMessagesFallback(chat, messagesEl);
        }
        
        promptEl.value = '';
        return;
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
      clearImagePreview();
      
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
      
      // Create process chain message
      const processChainMsg = {
        role: 'bot',
        text: '**Counterfeit IC Detection**\n\nStarting analysis...',
        time: Date.now(),
        _processChain: true,
        _sessionId: null,
        _steps: {}
      };
      chat.messages.push(processChainMsg);
      saveMessagesToStorage(chat.messages);
      renderMessagesFallback(chat, messagesEl);
      
      // Start API call
      try {
        console.log('[API Integration] Starting API call...');
        
        // Call API to start detection
        const result = await window.icDetectionAPI.detectIC(attachedFile);
        console.log('[API Integration] Detection started:', result);
        
        if (!result.session_id) {
          throw new Error('No session ID returned');
        }
        
        processChainMsg._sessionId = result.session_id;
        processChainMsg.text = '**Counterfeit IC Detection**\n\nDetection started. Waiting for updates...';
          saveMessagesToStorage(chat.messages);
        renderMessagesFallback(chat, messagesEl);
        
        // Start polling for progress immediately
        console.log('[API Integration] Starting progress polling...');
        pollProgress(result.session_id, processChainMsg, chat, messagesEl);
        
        
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
      
      // Filter out messages without content (cleanup)
      // Also filter out completed process chains - they're replaced by conversational summary
      const validMessages = chat.messages.filter(msg => {
        if (!msg.text && !msg.img && !msg._processChain && !msg._hasReport) {
          return false;
        }
        // Hide completed process chains - conversational summary replaces them
        if (msg._processChain && msg._completed) {
          return false;
        }
        return true;
      });
      
      for (const msg of validMessages) {
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
        
        // Handle process chain - Show vertical chain of thought with animations
        if (msg._processChain) {
          const chainContainer = document.createElement('div');
          chainContainer.className = 'process-chain';
          chainContainer.dataset.chainTime = msg.time; // Store time for navigation
          
          // Add toggle button if process is completed
          if (msg._completed) {
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'process-chain-toggle';
            toggleBtn.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
              <span>View Process Breakdown</span>
            `;
            toggleBtn.onclick = () => {
              chainContainer.classList.toggle('collapsed');
              toggleBtn.classList.toggle('collapsed');
            };
            chainContainer.appendChild(toggleBtn);
          }
          
          const chainContent = document.createElement('div');
          chainContent.className = 'process-chain-content';
          
          const stepOrder = ['identify', 'scrape', 'parse', 'dimension', 'visual', 'verdict', 'report'];
          const stepTitles = {
            'identify': 'Identifying IC from image',
            'scrape': 'Searching for OEM datasheet',
            'parse': 'Parsing datasheet and extracting diagrams',
            'dimension': 'Estimating dimensions using computer vision',
            'visual': 'Performing visual analysis',
            'verdict': 'Computing final verdict',
            'report': 'Generating detailed report'
          };
          
          // If completed, start collapsed
          if (msg._completed) {
            chainContainer.classList.add('collapsed');
          }
          
          // Only show completed and active steps (not pending)
          let visibleStepCount = 0;
          stepOrder.forEach((stepKey, idx) => {
            const step = msg._steps && msg._steps[stepKey] ? msg._steps[stepKey] : null;
            if (step && (step.status === 'completed' || step.status === 'running')) {
              visibleStepCount = idx + 1;
            }
          });
          
          // Show at least one step if process has started
          if (visibleStepCount === 0) {
            // Check if any step exists (even if status not set yet)
            const hasAnyStep = stepOrder.some(stepKey => msg._steps && msg._steps[stepKey]);
            if (hasAnyStep) {
              visibleStepCount = 1; // Show first step if process started
            }
          }
          
          // Don't show next pending step - only show when it becomes active
          
          stepOrder.forEach((stepKey, index) => {
            const step = msg._steps && msg._steps[stepKey] ? msg._steps[stepKey] : null;
            const stepDiv = document.createElement('div');
            stepDiv.className = 'chain-step';
            stepDiv.dataset.stepKey = stepKey;
            stepDiv.dataset.stepIndex = index;
            
            // Determine status
            let status = 'pending';
            if (step) {
              if (step.status === 'completed') status = 'completed';
              else if (step.status === 'running') status = 'active';
            }
            
            stepDiv.classList.add(status);
            
            // Step indicator
            const indicator = document.createElement('div');
            indicator.className = 'chain-step-indicator';
            if (status === 'completed') {
              indicator.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            } else if (status === 'active') {
              indicator.innerHTML = '<div class="chain-step-spinner"></div>';
            } else {
              indicator.innerHTML = '<div class="chain-step-dot"></div>';
            }
            
            // Step content
            const content = document.createElement('div');
            content.className = 'chain-step-content';
            
            const title = document.createElement('div');
            title.className = 'chain-step-title';
            title.textContent = stepTitles[stepKey] || stepKey;
            content.appendChild(title);
            
            // Show step message/output if available
            if (step && step.message) {
              const message = document.createElement('div');
              message.className = 'chain-step-message';
              message.textContent = step.message;
              content.appendChild(message);
            }
            
            // Add preview button if step has output (skip scrape step - no preview needed)
            if (stepKey !== 'scrape' && step && (step.output || step.data || step.visualization || step.message)) {
              const previewBtn = document.createElement('button');
              previewBtn.className = 'chain-step-preview';
              previewBtn.textContent = 'Preview';
              previewBtn.onclick = (e) => {
                e.stopPropagation();
                // Use output or data field
                const stepData = { ...step };
                if (stepData.data && !stepData.output) {
                  stepData.output = stepData.data;
                }
                showStepPreview(stepKey, stepData, stepTitles[stepKey]);
              };
              content.appendChild(previewBtn);
            }
            
            stepDiv.appendChild(indicator);
            stepDiv.appendChild(content);
            chainContent.appendChild(stepDiv);
            
            // Reveal steps sequentially - only show steps up to visibleStepCount
            if (index < visibleStepCount) {
              const delay = index * 300; // 300ms delay between each step
              setTimeout(() => {
                stepDiv.classList.add('chain-step-visible');
              }, delay);
            }
          });
          
          chainContainer.appendChild(chainContent);
          msgDiv.appendChild(chainContainer);
          chatCard.appendChild(msgDiv);
          continue;
        }
        
        // Add navigation arrow to switch to process chain view if available (at the top)
        if (msg._hasReport && msg._processChainId) {
          const navBtn = document.createElement('button');
          navBtn.className = 'process-chain-nav-btn';
          navBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
            <span>View Process Breakdown</span>
          `;
          navBtn.onclick = (e) => {
            e.stopPropagation();
            // Find and expand the process chain message by session ID
            const processChainMsg = chat.messages.find(m => m._processChain && m._sessionId === msg._sessionId);
            if (processChainMsg) {
              processChainMsg._collapsed = false;
              // Re-render messages to show expanded chain
              renderMessagesFallback(chat, messagesEl);
              // Scroll to process chain after a short delay to ensure it's rendered
              setTimeout(() => {
                const chainElement = document.querySelector(`[data-chain-time="${processChainMsg.time}"]`);
                if (chainElement) {
                  chainElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  // Also expand the chain content
                  chainElement.classList.remove('collapsed');
                }
              }, 200);
            }
          };
          msgDiv.appendChild(navBtn);
        }
        
        if (msg.text) {
          const textDiv = document.createElement('div');
          // Remove excessive blank lines (3+ consecutive newlines become 2, 2+ become 1)
          let cleanedText = msg.text
            .replace(/\n{3,}/g, '\n\n')  // Replace 3+ newlines with 2
            .replace(/\n{2,}/g, '\n\n')  // Ensure max 2 consecutive newlines
            .replace(/^\n+|\n+$/g, '')   // Remove leading/trailing newlines
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
          textDiv.innerHTML = cleanedText;
          textDiv.style.whiteSpace = 'pre-line';
          msgDiv.appendChild(textDiv);
        }
        
        if (msg._hasReport) {
          const btn = document.createElement('button');
          btn.className = 'download-report-btn';
          btn.textContent = '📄 Download Full Report (PDF)';
          btn.style.marginTop = '10px';
          btn.style.padding = '10px 20px';
          btn.style.backgroundColor = '#2196f3';
          btn.style.color = 'white';
          btn.style.border = 'none';
          btn.style.borderRadius = '4px';
          btn.style.cursor = 'pointer';
          btn.onclick = () => {
            if (msg._sessionId) {
              window.icDetectionAPI.downloadReport(msg._sessionId);
            }
          };
          msgDiv.appendChild(btn);
        }
        
        chatCard.appendChild(msgDiv);
      }
      
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
    
    // Poll progress updates
    async function pollProgress(sessionId, processChainMsg, chat, messagesEl) {
      console.log('[API Integration] Starting progress polling for session:', sessionId);
      const maxPolls = 300; // 5 minutes max (1s intervals)
      let pollCount = 0;
      
      const pollInterval = setInterval(async () => {
        pollCount++;
        console.log(`[API Integration] Polling progress (attempt ${pollCount}/${maxPolls})...`);
        
        if (pollCount > maxPolls) {
          clearInterval(pollInterval);
          processChainMsg.text = '⏱️ **Detection Timeout**\n\nAnalysis is taking longer than expected. Please check the backend logs.';
          saveMessagesToStorage(chat.messages);
          renderMessagesFallback(chat, messagesEl);
          return;
        }
        
        try {
          const progressUrl = `${window.icDetectionAPI.baseUrl}/progress/${sessionId}`;
          console.log('[API Integration] Fetching progress from:', progressUrl);
          const response = await fetch(progressUrl);
          
          if (!response.ok) {
            console.error('[API Integration] Progress response not OK:', response.status, response.statusText);
            const errorText = await response.text();
            let errorData;
            try {
              errorData = JSON.parse(errorText);
            } catch {
              errorData = { error: errorText };
            }
            console.error('[API Integration] Error response:', errorData);
            
            // If session not found (404), stop polling - session may have expired or server restarted
            if (response.status === 404 && errorData.error && errorData.error.includes('Session not found')) {
              console.warn('[API Integration] Session not found, stopping polling');
              clearInterval(pollInterval);
              // Show error message to user
              const errorMsg = {
                role: 'bot',
                text: '⚠️ **Session Error**\n\nThe detection session was not found. This may happen if the server was restarted. Please try uploading the image again.',
                time: Date.now()
              };
              chat.messages.push(errorMsg);
              renderMessagesFallback(chat, messagesEl);
              return;
            }
            
            // Continue polling on other HTTP errors (retry)
            return;
          }
          
          const data = await response.json();
          console.log('[API Integration] Progress data received:', data);
          
          if (data.error && data.error.includes('Session not found')) {
            console.warn('[API Integration] Session not found in response, stopping polling');
            clearInterval(pollInterval);
            return;
          }
          
          if (data.error) {
            clearInterval(pollInterval);
            processChainMsg.text = `❌ **Error**\n\n${data.error}`;
            saveMessagesToStorage(chat.messages);
            renderMessagesFallback(chat, messagesEl);
            return;
          }
          
            // Process updates
          if (data.updates && data.updates.length > 0) {
            console.log('[API Integration] Processing', data.updates.length, 'updates');
            data.updates.forEach(update => {
              console.log('[API Integration] Update:', update);
              if (update.type === 'step' && update.step) {
                // Map 'data' field to 'output' for consistency
                const stepUpdate = { ...update };
                if (stepUpdate.data && !stepUpdate.output) {
                  stepUpdate.output = stepUpdate.data;
                }
                processChainMsg._steps[update.step] = stepUpdate;
                console.log(`[API Integration] Updated step ${update.step}:`, stepUpdate);
              } else if (update.type === 'complete') {
                clearInterval(pollInterval);
                console.log('[API Integration] Detection complete, fetching final results...');
                // Get final results
                fetchFinalResults(sessionId, processChainMsg, chat, messagesEl);
                return;
              } else if (update.type === 'error') {
                clearInterval(pollInterval);
                processChainMsg.text = `❌ **Error**\n\n${update.message}`;
                saveMessagesToStorage(chat.messages);
                renderMessagesFallback(chat, messagesEl);
                return;
              }
            });
            
            // Update process chain display
            updateProcessChainDisplay(processChainMsg);
            saveMessagesToStorage(chat.messages);
            renderMessagesFallback(chat, messagesEl);
          } else {
            console.log('[API Integration] No updates in this poll');
          }
          
          // Check if completed
          if (data.session && data.session.status === 'completed') {
            clearInterval(pollInterval);
            console.log('[API Integration] Session completed, fetching final results...');
            // Only fetch if we haven't already added the summary
            const hasSummary = chat.messages.some(m => m._sessionId === sessionId && m._hasReport);
            if (!hasSummary) {
              fetchFinalResults(sessionId, processChainMsg, chat, messagesEl);
            }
            return;
          } else if (data.session && data.session.status === 'failed') {
            clearInterval(pollInterval);
            processChainMsg.text = `❌ **Detection Failed**\n\n${data.session.error || 'Unknown error'}`;
            saveMessagesToStorage(chat.messages);
            renderMessagesFallback(chat, messagesEl);
            return;
          }
          
        } catch (error) {
          console.error('[API Integration] Progress poll error:', error);
          // Continue polling on error (might be network issue)
        }
      }, 1000); // Poll every second
    }
    
    // Update process chain display (no longer needed - rendering handled in renderMessagesFallback)
    function updateProcessChainDisplay(processChainMsg) {
      // Process chain is now rendered directly in renderMessagesFallback
      // This function is kept for compatibility but does nothing
    }
    
    // Render JSON as HTML table if applicable
    function renderJSONAsTable(data) {
      if (!data || typeof data !== 'object') {
        return null;
      }
      
      // If it's an array of objects, render as table
      if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
        const table = document.createElement('table');
        table.className = 'json-table';
        
        // Get all unique keys from all objects
        const allKeys = new Set();
        data.forEach(item => {
          if (typeof item === 'object' && item !== null) {
            Object.keys(item).forEach(key => allKeys.add(key));
          }
        });
        
        // Create header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        Array.from(allKeys).forEach(key => {
          const th = document.createElement('th');
          th.textContent = key;
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Create body
        const tbody = document.createElement('tbody');
        data.forEach(item => {
          const row = document.createElement('tr');
          Array.from(allKeys).forEach(key => {
            const td = document.createElement('td');
            const value = item[key];
            if (value === null || value === undefined) {
              td.textContent = '-';
            } else if (typeof value === 'object') {
              td.textContent = JSON.stringify(value);
            } else {
              td.textContent = String(value);
            }
            row.appendChild(td);
          });
          tbody.appendChild(row);
        });
        table.appendChild(tbody);
        
        return table;
      }
      
      // If it's a single object, render as key-value table
      if (!Array.isArray(data) && typeof data === 'object') {
        const table = document.createElement('table');
        table.className = 'json-table';
        
        const tbody = document.createElement('tbody');
        Object.entries(data).forEach(([key, value]) => {
          const row = document.createElement('tr');
          
          const keyCell = document.createElement('td');
          keyCell.className = 'json-table-key';
          keyCell.textContent = key;
          row.appendChild(keyCell);
          
          const valueCell = document.createElement('td');
          valueCell.className = 'json-table-value';
          if (value === null || value === undefined) {
            valueCell.textContent = '-';
          } else if (typeof value === 'object') {
            valueCell.textContent = JSON.stringify(value, null, 2);
          } else {
            valueCell.textContent = String(value);
          }
          row.appendChild(valueCell);
          
          tbody.appendChild(row);
        });
        table.appendChild(tbody);
        
        return table;
      }
      
      return null;
    }
    
    // Helper to escape HTML
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    // Show step preview modal
    function showStepPreview(stepKey, step, stepTitle) {
      // Use output or data field - define this first!
      const stepOutput = step.output || step.data || {};
      
      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.className = 'step-preview-overlay';
      overlay.onclick = (e) => {
        if (e.target === overlay) {
          document.body.removeChild(overlay);
        }
      };
      
      const modal = document.createElement('div');
      modal.className = 'step-preview-modal';
      modal.onclick = (e) => e.stopPropagation();
      
      const header = document.createElement('div');
      header.className = 'step-preview-header';
      header.innerHTML = `
        <h3>${stepTitle}</h3>
        <button class="step-preview-close" onclick="this.closest('.step-preview-overlay').remove()">×</button>
      `;
      
      const body = document.createElement('div');
      body.className = 'step-preview-body';
      
      if (step.message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'step-preview-section';
        messageDiv.innerHTML = `<strong>Status:</strong><p>${step.message}</p>`;
        body.appendChild(messageDiv);
      }
      
      if (stepOutput && Object.keys(stepOutput).length > 0) {
        const outputDiv = document.createElement('div');
        outputDiv.className = 'step-preview-section';
        outputDiv.innerHTML = `<strong>Output:</strong>`;
        
        // Special handling for identify step - show decoded markings as tables
        if (stepKey === 'identify' && stepOutput.date_codes && Array.isArray(stepOutput.date_codes) && stepOutput.date_codes.length > 0) {
          const dateCodesDiv = document.createElement('div');
          dateCodesDiv.style.marginTop = '12px';
          dateCodesDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">Date Codes:</strong>';
          const dateTable = document.createElement('table');
          dateTable.className = 'json-table';
          const thead = document.createElement('thead');
          thead.innerHTML = '<tr><th>Raw Code</th><th>Decoded</th><th>Format</th><th>Location</th></tr>';
          dateTable.appendChild(thead);
          const tbody = document.createElement('tbody');
          stepOutput.date_codes.forEach(dc => {
            const row = document.createElement('tr');
            const dcObj = typeof dc === 'object' ? dc : { raw: dc };
            row.innerHTML = `
              <td>${escapeHtml(String(dcObj.raw || '-'))}</td>
              <td>${escapeHtml(String(dcObj.decoded || '-'))}</td>
              <td>${escapeHtml(String(dcObj.format || '-'))}</td>
              <td>${escapeHtml(String(dcObj.location || '-'))}</td>
            `;
            tbody.appendChild(row);
          });
          dateTable.appendChild(tbody);
          dateCodesDiv.appendChild(dateTable);
          outputDiv.appendChild(dateCodesDiv);
        }
        
        if (stepKey === 'identify' && stepOutput.lot_codes && Array.isArray(stepOutput.lot_codes) && stepOutput.lot_codes.length > 0) {
          const lotCodesDiv = document.createElement('div');
          lotCodesDiv.style.marginTop = '12px';
          lotCodesDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">Lot Codes:</strong>';
          const lotTable = document.createElement('table');
          lotTable.className = 'json-table';
          const thead = document.createElement('thead');
          thead.innerHTML = '<tr><th>Raw Code</th><th>Meaning</th><th>Location</th></tr>';
          lotTable.appendChild(thead);
          const tbody = document.createElement('tbody');
          stepOutput.lot_codes.forEach(lc => {
            const row = document.createElement('tr');
            const lcObj = typeof lc === 'object' ? lc : { raw: lc };
            row.innerHTML = `
              <td>${escapeHtml(String(lcObj.raw || '-'))}</td>
              <td>${escapeHtml(String(lcObj.meaning || '-'))}</td>
              <td>${escapeHtml(String(lcObj.location || '-'))}</td>
            `;
            tbody.appendChild(row);
          });
          lotTable.appendChild(tbody);
          lotCodesDiv.appendChild(lotTable);
          outputDiv.appendChild(lotCodesDiv);
        }
        
        if (stepKey === 'identify' && stepOutput.additional_markings && Array.isArray(stepOutput.additional_markings) && stepOutput.additional_markings.length > 0) {
          const markingsDiv = document.createElement('div');
          markingsDiv.style.marginTop = '12px';
          markingsDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">Additional Markings:</strong>';
          const markingsTable = document.createElement('table');
          markingsTable.className = 'json-table';
          const thead = document.createElement('thead');
          thead.innerHTML = '<tr><th>Text</th><th>Type</th><th>Decoded</th><th>Location</th></tr>';
          markingsTable.appendChild(thead);
          const tbody = document.createElement('tbody');
          stepOutput.additional_markings.forEach(m => {
            const row = document.createElement('tr');
            const marking = typeof m === 'string' ? { text: m } : (m || {});
            row.innerHTML = `
              <td>${escapeHtml(String(marking.text || '-'))}</td>
              <td>${escapeHtml(String(marking.type || '-'))}</td>
              <td>${escapeHtml(String(marking.decoded || '-'))}</td>
              <td>${escapeHtml(String(marking.location || '-'))}</td>
            `;
            tbody.appendChild(row);
          });
          markingsTable.appendChild(tbody);
          markingsDiv.appendChild(markingsTable);
          outputDiv.appendChild(markingsDiv);
        }
        
        // Handle dimension step - show brief summary, visualization shown separately
        if (stepKey === 'dimension' && stepOutput && Object.keys(stepOutput).length > 0) {
          const summaryDiv = document.createElement('div');
          summaryDiv.style.marginTop = '12px';
          if (stepOutput.measured_aspect_ratio) {
            summaryDiv.innerHTML = `<p><strong>Aspect Ratio:</strong> ${stepOutput.measured_aspect_ratio}</p>`;
            if (stepOutput.expected_aspect_ratio) {
              summaryDiv.innerHTML += `<p><strong>Expected:</strong> ${stepOutput.expected_aspect_ratio}</p>`;
            }
            if (stepOutput.dimension_score !== undefined) {
              summaryDiv.innerHTML += `<p><strong>Score:</strong> ${stepOutput.dimension_score}/100</p>`;
            }
            if (stepOutput.verdict) {
              summaryDiv.innerHTML += `<p><strong>Verdict:</strong> ${stepOutput.verdict}</p>`;
            }
          }
          outputDiv.appendChild(summaryDiv);
        }
        
        // Handle parse step - show diagram image and PDF download
        else if (stepKey === 'parse' && stepOutput) {
          if (stepOutput.mechanical_diagram) {
            const diagramDiv = document.createElement('div');
            diagramDiv.style.marginTop = '12px';
            diagramDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">Extracted Mechanical Diagram:</strong>';
            const img = document.createElement('img');
            // Convert relative path to absolute URL if needed
            const diagramPath = stepOutput.mechanical_diagram;
            img.src = diagramPath.startsWith('http') ? diagramPath : `http://localhost:5001/api/download?file=${encodeURIComponent(diagramPath)}`;
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.style.borderRadius = '6px';
            img.style.marginTop = '8px';
            img.style.border = '1px solid var(--border)';
            diagramDiv.appendChild(img);
            outputDiv.appendChild(diagramDiv);
          }
          
          if (stepOutput.datasheet_path) {
            const pdfDiv = document.createElement('div');
            pdfDiv.style.marginTop = '12px';
            pdfDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">OEM Datasheet PDF:</strong>';
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'chain-step-preview';
            downloadBtn.style.marginTop = '8px';
            downloadBtn.textContent = 'Download Datasheet PDF';
            downloadBtn.onclick = () => {
              // Convert relative path to absolute URL
              const pdfPath = stepOutput.datasheet_path;
              const pdfUrl = pdfPath.startsWith('http') ? pdfPath : `http://localhost:5001/api/download?file=${encodeURIComponent(pdfPath)}`;
              window.open(pdfUrl, '_blank');
            };
            pdfDiv.appendChild(downloadBtn);
            outputDiv.appendChild(pdfDiv);
          }
        }
        
        // For identify step, also show other fields as key-value table
        else if (stepKey === 'identify') {
          const otherFields = {};
          const excludeKeys = ['date_codes', 'lot_codes', 'additional_markings', 'country_codes', 'datasheet_search', 'confidence', 'reasoning'];
          Object.keys(stepOutput).forEach(key => {
            if (!excludeKeys.includes(key) && stepOutput[key] !== null && stepOutput[key] !== undefined) {
              otherFields[key] = stepOutput[key];
            }
          });
          
          if (Object.keys(otherFields).length > 0) {
            const otherFieldsDiv = document.createElement('div');
            otherFieldsDiv.style.marginTop = '12px';
            otherFieldsDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">Other Information:</strong>';
            const otherTable = renderJSONAsTable(otherFields);
            if (otherTable) {
              otherFieldsDiv.appendChild(otherTable);
              outputDiv.appendChild(otherFieldsDiv);
            }
          }
          
          // Show country codes if available
          if (stepOutput.country_codes && Array.isArray(stepOutput.country_codes) && stepOutput.country_codes.length > 0) {
            const countryDiv = document.createElement('div');
            countryDiv.style.marginTop = '12px';
            countryDiv.innerHTML = `<strong style="display:block;margin-bottom:8px;">Country Codes:</strong><p>${stepOutput.country_codes.join(', ')}</p>`;
            outputDiv.appendChild(countryDiv);
          }
        } else if (stepKey !== 'parse' && stepKey !== 'dimension' && stepKey !== 'identify' && stepOutput && Object.keys(stepOutput).length > 0) {
          // For other steps (not dimension, not parse), try to render as table if it's an object/array
          const outputTable = renderJSONAsTable(stepOutput);
          if (outputTable) {
            outputDiv.appendChild(outputTable);
          } else {
            const pre = document.createElement('pre');
            pre.style.whiteSpace = 'pre-wrap';
            pre.style.wordBreak = 'break-word';
            pre.textContent = JSON.stringify(stepOutput, null, 2);
            outputDiv.appendChild(pre);
          }
        }
        
        body.appendChild(outputDiv);
      }
      
      if (step.visualization) {
        const vizDiv = document.createElement('div');
        vizDiv.className = 'step-preview-section';
        vizDiv.innerHTML = `<strong>Visualization:</strong>`;
        const img = document.createElement('img');
        // Convert relative path to absolute URL if needed
        const vizPath = step.visualization;
        img.src = vizPath.startsWith('http') ? vizPath : `http://localhost:5001/api/download?file=${encodeURIComponent(vizPath)}`;
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.marginTop = '10px';
        img.style.borderRadius = '6px';
        img.style.border = '1px solid var(--border)';
        img.onerror = function() {
          this.style.display = 'none';
          const errorMsg = document.createElement('p');
          errorMsg.textContent = 'Image could not be loaded';
          errorMsg.style.color = 'var(--error)';
          vizDiv.appendChild(errorMsg);
        };
        vizDiv.appendChild(img);
        body.appendChild(vizDiv);
      }
      
      if (!step.message && (!stepOutput || Object.keys(stepOutput).length === 0) && !step.visualization) {
        const noDataDiv = document.createElement('div');
        noDataDiv.className = 'step-preview-section';
        noDataDiv.innerHTML = '<p>No additional details available for this step.</p>';
        body.appendChild(noDataDiv);
      }
      
      modal.appendChild(header);
      modal.appendChild(body);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    }
    
    // Fetch final results and add conversational summary (keep process chain visible but completed)
    async function fetchFinalResults(sessionId, processChainMsg, chat, messagesEl) {
      // Prevent duplicate calls - check if summary already exists
      if (chat.messages.some(m => m._sessionId === sessionId && m._hasReport)) {
        console.log('[API Integration] Summary already exists, skipping fetchFinalResults');
        return;
      }
      
      try {
        const response = await fetch(`${window.icDetectionAPI.baseUrl}/session/${sessionId}`);
        const data = await response.json();
        
        if (data.status === 'completed' && data.results) {
          // Mark process chain as completed (don't remove it)
          if (processChainMsg) {
            processChainMsg._completed = true;
            processChainMsg._collapsed = true; // Start collapsed
          }
          
          // Remove any existing summaries for this session to prevent duplicates
          chat.messages = chat.messages.filter(m => {
            return !(m._sessionId === sessionId && m._hasReport);
          });
          
          // Add single consolidated summary with download button for each result
          data.results.forEach((apiResult, idx) => {
            if (apiResult.chat_response && Array.isArray(apiResult.chat_response)) {
              // Find the summary message (backend returns a list with one summary message)
              const summaryMsg = apiResult.chat_response.find(m => m.type === 'summary');
              
              let summaryText = '';
              if (summaryMsg && summaryMsg.content) {
                // Use the summary content directly (backend already includes download text)
                summaryText = summaryMsg.content;
              } else if (apiResult.chat_response.length > 0) {
                // Fallback: use first message if no summary type found
                const firstMsg = apiResult.chat_response[0];
                summaryText = firstMsg.content || '';
                
                // Add download info if report is available and not already in text
                if (apiResult.report_path && !summaryText.includes('Download')) {
                  summaryText += '\n\n📄 **Download Report**\n\nA detailed PDF report with annotated images and comprehensive analysis is available for download below.';
                }
              }
              
              // Clean up excessive blank lines
              summaryText = summaryText
                .replace(/\n{3,}/g, '\n\n')  // Replace 3+ newlines with 2
                .replace(/^\n+|\n+$/g, '')  // Remove leading/trailing newlines
                .trim();
              
              // Create single consolidated message with both summary and download button
              const finalMsg = {
                role: 'bot',
                text: summaryText,
                time: Date.now(),
                _sessionId: sessionId,
                _resultIndex: idx,
                _hasReport: !!apiResult.report_path,  // Include download button flag
                _processChainId: processChainMsg ? processChainMsg.time : null,  // Link to process chain
                _icInfo: {  // Store IC info for agent context
                  part_number: apiResult.part_number,
                  manufacturer: apiResult.manufacturer,
                  package_type: apiResult.package_type,
                  pin_count: apiResult.pin_count || null
                }
              };
              chat.messages.push(finalMsg);
            } else if (apiResult.report_path) {
              // If no chat_response but report exists, create download-only message
              const downloadMsg = {
                role: 'bot',
                text: '📄 **Download Report**\n\nA detailed PDF report is available for download.',
                time: Date.now(),
                _hasReport: true,
                _sessionId: sessionId,
                _resultIndex: idx,
                _icInfo: {  // Store IC info for agent context
                  part_number: apiResult.part_number,
                  manufacturer: apiResult.manufacturer,
                  package_type: apiResult.package_type,
                  pin_count: apiResult.pin_count || null
                }
              };
              chat.messages.push(downloadMsg);
            }
          });
          
          saveMessagesToStorage(chat.messages);
          renderMessagesFallback(chat, messagesEl);
        }
      } catch (error) {
        console.error('[API Integration] Error fetching final results:', error);
        // Replace process chain with error message
        const processChainIdx = chat.messages.findIndex(m => m._processChain);
        if (processChainIdx !== -1) {
          chat.messages[processChainIdx] = {
            role: 'bot',
            text: '❌ **Error fetching results**\n\nPlease try again or check the backend logs.',
            time: Date.now()
          };
        }
        saveMessagesToStorage(chat.messages);
        renderMessagesFallback(chat, messagesEl);
      }
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
    
    // Keep chat memory - don't clear on page load
    // This allows users to continue conversations across page reloads
    console.log('[API Integration] Chat memory enabled - conversations will persist');
    
    // Only clear if explicitly requested (e.g., "new chat" button)
    // For now, we keep the memory to maintain conversation context
    
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

