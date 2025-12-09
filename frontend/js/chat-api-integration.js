// API Integration for Chat Interface
// This replaces the hardcoded demo in chat.js with real API calls

console.log('===========================================');
console.log('[API Integration] Script loaded!');
console.log('===========================================');

// Helper function to build download URL with user_type
function buildDownloadUrl(filePath) {
  const userType = localStorage.getItem('authentIC_userType') || 'business';
  return `http://localhost:5001/api/download?file=${encodeURIComponent(filePath)}&user_type=${userType}`;
}

// Override the handleSend function with API integration
(function() {
  console.log('[API Integration] Starting initialization...');
  
  /**
   * Format summary text as a table instead of emoji/heading format
   */
  function formatSummaryAsTable(text, apiResult) {
    if (!text) return text;
    
    // Extract key information from text and apiResult
    const tableRows = [];
    
    // Extract IC Identification
    const partMatch = text.match(/\*\*([^*]+)\*\*.*?from \*\*([^*]+)\*\*/);
    if (partMatch || apiResult.part_number) {
      tableRows.push({
        label: 'IC Identification',
        value: apiResult.part_number ? `${apiResult.part_number} (${apiResult.manufacturer || 'Unknown'})` : (partMatch ? `${partMatch[1]} (${partMatch[2]})` : 'Unknown')
      });
    }
    
    // Extract Package Info
    if (apiResult.package_type || apiResult.pin_count) {
      const packageInfo = [];
      if (apiResult.package_type) packageInfo.push(apiResult.package_type);
      if (apiResult.pin_count) packageInfo.push(`${apiResult.pin_count} pins`);
      if (packageInfo.length > 0) {
        tableRows.push({
          label: 'Package',
          value: packageInfo.join(', ')
        });
      }
    }
    
    // Extract Dimension Analysis
    const dimMatch = text.match(/📐.*?Dimension Analysis[:\*]*\s*(.+?)(?=\n\n|👁️|⚠️|✅|📄|$)/s);
    if (dimMatch) {
      const dimText = dimMatch[1].replace(/\*\*/g, '').trim();
      if (dimText) {
        tableRows.push({
          label: 'Dimension Analysis',
          value: dimText
        });
      }
    }
    
    // Extract Visual Analysis
    const visualMatch = text.match(/👁️.*?Visual Analysis[:\*]*\s*(.+?)(?=\n\n|⚠️|✅|📄|$)/s);
    if (visualMatch) {
      const visualText = visualMatch[1].replace(/\*\*/g, '').trim();
      if (visualText) {
        tableRows.push({
          label: 'Visual Analysis',
          value: visualText
        });
      }
    }
    
    // Extract Anomalies
    const anomalyMatch = text.match(/⚠️.*?detected.*?(\d+).*?anomal/i);
    if (anomalyMatch || (apiResult.anomalies && apiResult.anomalies.length > 0)) {
      const count = anomalyMatch ? parseInt(anomalyMatch[1]) : (apiResult.anomalies ? apiResult.anomalies.length : 0);
      if (count > 0) {
        tableRows.push({
          label: 'Anomalies Detected',
          value: `${count} anomaly${count !== 1 ? 'ies' : 'y'}`
        });
      }
    } else if (text.includes('No Anomalies') || text.includes('✅')) {
      tableRows.push({
        label: 'Anomalies Detected',
        value: 'None'
      });
    }
    
    // Extract Final Verdict
    const verdictMatch = text.match(/(✅|❌|⚠️|❓).*?Final Verdict[:\*]*\s*([^\n]+)/);
    if (verdictMatch || apiResult.verdict) {
      const verdict = apiResult.verdict || verdictMatch[2].replace(/\*\*/g, '').trim();
      tableRows.push({
        label: 'Verdict',
        value: verdict
      });
    }
    
    // Extract Authenticity Score
    const scoreMatch = text.match(/Authenticity Score[:\*]*\s*([0-9.]+)\/100/);
    if (scoreMatch || apiResult.authenticity_score !== undefined) {
      const score = apiResult.authenticity_score !== undefined ? apiResult.authenticity_score.toFixed(1) : scoreMatch[1];
      tableRows.push({
        label: 'Authenticity Score',
        value: `${score}/100`
      });
    }
    
    // Build HTML table
    if (tableRows.length > 0) {
      let tableHTML = '<table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:0.95em;">';
      tableRows.forEach(row => {
        tableHTML += `
          <tr style="border-bottom:1px solid var(--border, #e5e7eb);">
            <td style="padding:10px 12px;font-weight:600;color:var(--text-primary, #111827);width:35%;vertical-align:top;">${row.label}</td>
            <td style="padding:10px 12px;color:var(--text-secondary, #6b7280);vertical-align:top;">${row.value}</td>
          </tr>
        `;
      });
      tableHTML += '</table>';
      
      // Preserve all LLM synthesized content - format it nicely
      // Remove emojis but keep all text content
      let summaryText = text
        .replace(/📐|👁️|⚠️|✅|❌|❓|📄/g, '') // Remove emojis
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') // Convert markdown bold
        .split('\n\n')
        .filter(p => {
          const para = p.trim();
          // Skip empty, download lines, and table headers
          return para.length > 0 && 
                 !para.includes('Download Report') && 
                 !para.includes('Download Full Report') &&
                 !para.match(/^(IC Identification|Package|Dimension Analysis|Visual Analysis|Anomalies Detected|Verdict|Authenticity Score)[:]/i);
        })
        .map(para => {
          const trimmed = para.trim();
          if (trimmed.length < 10) return '';
          return `<p style="margin-top:8px;line-height:1.6;color:var(--text-secondary, #6b7280);">${trimmed}</p>`;
        })
        .filter(html => html.length > 0)
        .join('');
      
      // Combine table and summary text
      if (summaryText) {
        return tableHTML + '<div style="margin-top:20px;border-top:1px solid var(--border, #e5e7eb);padding-top:16px;">' + summaryText + '</div>';
      }
      return tableHTML;
    }
    
    // Fallback: return original text if parsing fails
    return text;
  }
  
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
      { text: 'Estimating dimensions using computer vision', key: 'vlm_extraction' },
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
          
          // Get user type
          const userType = localStorage.getItem('authentIC_userType') || 'business';
          
          const response = await fetch('http://localhost:5001/api/chat', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User-Type': userType
            },
            body: JSON.stringify({
              message: text,
              session_id: sessionId,
              chat_history: chatHistory,
              user_type: userType
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
        _steps: {},
        _showProcessChain: true, // keep chain visible by default
        _collapsed: false
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
      
      // First, deduplicate messages with same sessionId, resultIndex, and _hasReport
      const seenSummaryKeys = new Set();
      const deduplicatedMessages = chat.messages.filter(msg => {
        if (msg._sessionId && msg._hasReport) {
          const key = `${msg._sessionId}_${msg._resultIndex || 0}`;
          if (seenSummaryKeys.has(key)) {
            console.log(`[API Integration] Filtering duplicate summary message during render: ${key}`);
            return false; // Duplicate
          }
          seenSummaryKeys.add(key);
        }
        return true;
      });
      
      // Filter out messages without content (cleanup)
      // Also filter out completed process chains - they're replaced by conversational summary
      const validMessages = deduplicatedMessages.filter(msg => {
        if (!msg.text && !msg.img && !msg._processChain && !msg._hasReport) {
          return false;
        }
        // For completed process chains, check if they should be shown or hidden
        // (controlled by toggle state - default hidden, shown when arrow is clicked)
        if (msg._processChain && msg._completed) {
          // Default to visible unless explicitly hidden
          if (typeof msg._showProcessChain === 'undefined') {
            msg._showProcessChain = true;
          }
          return msg._showProcessChain !== false;
        }
        return true;
      });
      
      for (const msg of validMessages) {
        // Skip summary message if process chain is being shown
        if (msg._hasReport && msg._processChainId) {
          const processChainMsg = chat.messages.find(m => m._processChain && m._sessionId === msg._sessionId);
          if (processChainMsg && processChainMsg._showProcessChain === true) {
            continue; // Skip summary, show process chain instead
          }
        }
        
        const msgDiv = document.createElement('div');
        msgDiv.className = 'msg ' + (msg.role === 'user' ? 'user' : 'bot');
        msgDiv.dataset.msgTime = msg.time; // Store time for navigation
        
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
          // Default to showing the chain when completed unless user collapsed it
          if (msg._completed && typeof msg._showProcessChain === 'undefined') {
            msg._showProcessChain = true;
          }
          const isCollapsed = msg._collapsed === true;
          
          const chainContainer = document.createElement('div');
          chainContainer.className = 'process-chain';
          chainContainer.dataset.chainTime = msg.time; // Store time for navigation
          
          // Add toggle button if process is completed
          if (msg._completed) {
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'process-chain-toggle';
            if (isCollapsed) {
              toggleBtn.classList.add('collapsed');
            }
            toggleBtn.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
              <span>View Process Breakdown</span>
            `;
            toggleBtn.onclick = () => {
              chainContainer.classList.toggle('collapsed');
              toggleBtn.classList.toggle('collapsed');
              msg._collapsed = chainContainer.classList.contains('collapsed');
            };
            chainContainer.appendChild(toggleBtn);
          }
          
          const chainContent = document.createElement('div');
          chainContent.className = 'process-chain-content';
          
          const stepOrder = ['identify', 'scrape', 'parse', 'pin_counter', 'dimension', 'visual', 'verdict', 'report'];
          const stepTitles = {
            'identify': 'Identifying IC from image',
            'scrape': 'Searching for OEM datasheet',
            'parse': 'Parsing datasheet and extracting diagrams',
            'pin_counter': 'Counting pins with YOLO',
            'dimension': 'Estimating dimensions using computer vision',
            'visual': 'Performing visual analysis',
            'verdict': 'Computing final verdict',
            'report': 'Generating detailed report'
          };
          
          // If completed, respect stored collapsed state (default open)
          if (msg._completed && isCollapsed) {
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
          
          // Add navigation controls below the container (for process chain view)
          if (msg._completed) {
            const navContainer = document.createElement('div');
            navContainer.className = 'view-navigator';
            
            // 1/2 = Process Chain, 2/2 = Summary
            const currentView = 1; // We're on the process chain view
            
            // Previous button (disabled - already on view 1)
            const prevBtn = document.createElement('button');
            prevBtn.className = 'nav-btn nav-prev';
            prevBtn.disabled = true;
            prevBtn.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            `;
            
            // View indicator
            const indicator = document.createElement('div');
            indicator.className = 'nav-indicator';
            indicator.textContent = '1/2';
            
            // Next button (go to Summary - view 2)
            const nextBtn = document.createElement('button');
            nextBtn.className = 'nav-btn nav-next';
            nextBtn.disabled = false;
            nextBtn.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            `;
            nextBtn.onclick = (e) => {
              e.stopPropagation();
              msg._showProcessChain = false;
              renderMessagesFallback(chat, messagesEl);
              setTimeout(() => {
                const summaryMsg = chat.messages.find(m => m._hasReport && m._sessionId === msg._sessionId);
                if (summaryMsg) {
                  const summaryElement = document.querySelector(`[data-msg-time="${summaryMsg.time}"]`);
                  if (summaryElement) {
                    summaryElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }
              }, 100);
            };
            
            navContainer.appendChild(prevBtn);
            navContainer.appendChild(indicator);
            navContainer.appendChild(nextBtn);
            chatCard.appendChild(navContainer);
          }
          
          continue;
        }
        
        // Navigation will be added below the container, not inside
        
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
          btn.onclick = async (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (msg._sessionId) {
              try {
                console.log('[API Integration] Downloading report for session:', msg._sessionId, 'index:', msg._resultIndex || 0);
                // Use the downloadReport method which opens the URL
                const reportUrl = window.icDetectionAPI.getReportURL(msg._sessionId);
                console.log('[API Integration] Report URL:', reportUrl);
                // Open in new tab/window
                const newWindow = window.open(reportUrl, '_blank');
                if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
                  // If popup blocked, try direct download via link
                  const link = document.createElement('a');
                  link.href = reportUrl;
                  link.download = `detection_report_${msg._sessionId}.pdf`;
                  link.target = '_blank';
                  document.body.appendChild(link);
                  link.click();
                  setTimeout(() => {
                    document.body.removeChild(link);
                  }, 100);
                }
              } catch (error) {
                console.error('[API Integration] Download error:', error);
                alert('Failed to download report. Please try again.');
              }
            } else {
              alert('Report not available - no session ID found');
            }
          };
          msgDiv.appendChild(btn);
        }
        
        chatCard.appendChild(msgDiv);
        
        // Add navigation controls below the container (for summary view - navigate back to process chain)
        if (msg._hasReport && msg._processChainId) {
          const navContainer = document.createElement('div');
          navContainer.className = 'view-navigator';
          
          // Check current state - 1/2 = Process Chain, 2/2 = Summary
          const processChainMsg = chat.messages.find(m => m._processChain && m._sessionId === msg._sessionId);
          const isShowingChain = processChainMsg && processChainMsg._showProcessChain === true;
          const currentView = isShowingChain ? 1 : 2; // 1 = Process Chain, 2 = Summary
          
          // Previous button (go to Process Chain - view 1)
          const prevBtn = document.createElement('button');
          prevBtn.className = 'nav-btn nav-prev';
          prevBtn.disabled = currentView === 1;
          prevBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          `;
          prevBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (processChainMsg && currentView !== 1) {
              processChainMsg._showProcessChain = true;
              renderMessagesFallback(chat, messagesEl);
              setTimeout(() => {
                const chainElement = document.querySelector(`[data-chain-time="${processChainMsg.time}"]`);
                if (chainElement) {
                  chainElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  chainElement.classList.remove('collapsed');
                }
              }, 100);
            }
          };
          
          // View indicator
          const indicator = document.createElement('div');
          indicator.className = 'nav-indicator';
          indicator.textContent = `${currentView}/2`;
          
          // Next button (go to Summary - view 2, disabled when on summary)
          const nextBtn = document.createElement('button');
          nextBtn.className = 'nav-btn nav-next';
          nextBtn.disabled = currentView === 2;
          nextBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          `;
          nextBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (processChainMsg && currentView !== 2) {
              processChainMsg._showProcessChain = false;
              renderMessagesFallback(chat, messagesEl);
              setTimeout(() => {
                const summaryElement = document.querySelector(`[data-msg-time="${msg.time}"]`);
                if (summaryElement) {
                  summaryElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }, 100);
            }
          };
          
          navContainer.appendChild(prevBtn);
          navContainer.appendChild(indicator);
          navContainer.appendChild(nextBtn);
          chatCard.appendChild(navContainer);
        }
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
                console.log('[API Integration] Detection complete, checking for existing summaries...');
                // Check if summary already exists before fetching
                const existingSummaries = chat.messages.filter(m => m._sessionId === sessionId && m._hasReport);
                if (existingSummaries.length === 0) {
                  console.log('[API Integration] No summaries found, fetching final results...');
                  fetchFinalResults(sessionId, processChainMsg, chat, messagesEl);
                } else {
                  console.log(`[API Integration] Found ${existingSummaries.length} existing summary(ies), skipping fetchFinalResults`);
                }
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
      // Get sessionId from step if available, or try to find from active chat
      let sessionId = step._sessionId || null;
      if (!sessionId && typeof window !== 'undefined' && window.activeChat) {
        // Try to get from active chat's messages
        const processChainMsg = window.activeChat.messages?.find(m => m._processChain && m._sessionId);
        if (processChainMsg) {
          sessionId = processChainMsg._sessionId;
        }
      }
      
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

        const userType = localStorage.getItem('authentIC_userType') || 'business';
        const renderImage = (label, path) => {
          if (!path) return null;
          const container = document.createElement('div');
          container.style.marginTop = '10px';
          container.innerHTML = `<strong style="display:block;margin-bottom:6px;">${label}</strong>`;
          const img = document.createElement('img');
          const cleanPath = path.replace(/^.*api_results[\/\\]/, '').replace(/^[\/\\]/, '');
          img.src = path.startsWith('http')
            ? path
            : `http://localhost:5001/api/download?file=${encodeURIComponent(cleanPath)}&user_type=${userType}`;
          img.style.maxWidth = '100%';
          img.style.height = 'auto';
          img.style.borderRadius = '6px';
          img.style.border = '1px solid var(--border)';
          container.appendChild(img);
          return container;
        };

        if (stepKey === 'pin_counter') {
          const summary = document.createElement('div');
          summary.style.marginTop = '10px';
          const classificationStats = stepOutput.classification_stats || {};
          summary.innerHTML = `
            <p><strong>Pins Detected (conf > 0.5):</strong> ${stepOutput.pins_detected ?? 'N/A'}</p>
            <p><strong>Notches Detected (conf > 0.5):</strong> ${stepOutput.notches_detected ?? 'N/A'}</p>
            <div style="margin-top: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px;">
              <p style="margin: 4px 0;"><strong>Classification:</strong></p>
              <p style="margin: 4px 0; color: #22c55e;"><strong>Authentic (conf ≥ 0.8):</strong> ${classificationStats.authentic || 0}</p>
              <p style="margin: 4px 0; color: #f59e0b;"><strong>Suspicious (0.5 ≤ conf < 0.8):</strong> ${classificationStats.suspicious || 0}</p>
              <p style="margin: 4px 0; color: #ef4444;"><strong>Counterfeit (conf < 0.5):</strong> ${classificationStats.counterfeit || 0} (filtered out)</p>
            </div>
          `;
          outputDiv.appendChild(summary);

          const block = renderImage('Pin Counter Visualization', step.visualization || stepOutput.visualization || stepOutput.overlay_path);
          if (block) outputDiv.appendChild(block);
        }
        
        // Special handling for preprocess step - show only OCR visualization, no raw data table
        if (stepKey === 'preprocess') {
          // Show OCR visualization if available
          const ocrViz = step.visualization || stepOutput.ocr_visualization_url || stepOutput.ocr_visualization_path;
          if (ocrViz) {
            const ocrBlock = renderImage('OCR Text Detection Visualization', ocrViz);
            if (ocrBlock) {
              outputDiv.appendChild(ocrBlock);
            }
          }
        }
        
        // Special handling for histogram_filter step - show dashboard and all strips
        if (stepKey === 'histogram_filter') {
          const histData = stepOutput.data || stepOutput;
          const dashboardPath = histData.dashboard_url || histData.dashboard_path || step.visualization;
          const stripPaths = histData.strip_urls || histData.strip_paths || [];
          
          // Show dashboard
          if (dashboardPath) {
            const dashboardBlock = renderImage('Histogram Filter Dashboard (All 11 Filters)', dashboardPath);
            if (dashboardBlock) {
              const dashboardInfo = document.createElement('p');
              dashboardInfo.style.marginTop = '8px';
              dashboardInfo.style.color = '#666';
              dashboardInfo.style.fontSize = '0.9em';
              dashboardInfo.textContent = 'This dashboard combines all 11 filter outputs in a single view for analysis.';
              dashboardBlock.appendChild(dashboardInfo);
              outputDiv.appendChild(dashboardBlock);
            }
          }
          
          // Show individual strips
          if (stripPaths && stripPaths.length > 0) {
            const stripsSection = document.createElement('div');
            stripsSection.style.marginTop = '20px';
            stripsSection.innerHTML = '<strong style="display:block;margin-bottom:12px;">Individual Filter Strips (For QA Review):</strong>';
            
            const stepLabels = {
              '01_resize': '1. Resize',
              '02_grayscale': '2. Grayscale',
              '03_gamma': '3. Gamma Correction',
              '04_hist_equalization': '4. Histogram Equalization',
              '05_clahe': '5. CLAHE (Surface Texture)',
              '06_gaussian_blur': '6. Gaussian Blur',
              '07_edge_map': '7. Edge Map (Cracks/Damage)',
              '08_color_jitter': '8. Color Jitter',
              '09_gaussian_noise': '9. Gaussian Noise',
              '10_otsu_threshold': '10. Otsu Threshold (Contamination)',
              '11_normalize_tensor': '11. Normalize Tensor'
            };
            
            const stripsContainer = document.createElement('div');
            stripsContainer.style.display = 'grid';
            stripsContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(350px, 1fr))';
            stripsContainer.style.gap = '15px';
            stripsContainer.style.maxHeight = '600px';
            stripsContainer.style.overflowY = 'auto';
            stripsContainer.style.padding = '10px';
            stripsContainer.style.border = '1px solid var(--border)';
            stripsContainer.style.borderRadius = '6px';
            
            stripPaths.forEach(stripPath => {
              const stepName = stripPath.split('/').pop().replace('_strip.png', '');
              const label = stepLabels[stepName] || stepName.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
              const stripBlock = renderImage(label, stripPath);
              if (stripBlock) {
                stripBlock.style.marginTop = '0';
                stripsContainer.appendChild(stripBlock);
              }
            });
            
            stripsSection.appendChild(stripsContainer);
            outputDiv.appendChild(stripsSection);
          }
        }
        
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
        
        // Handle dimension step - show brief summary and SAM 2.1 visualization
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
            if (stepOutput.mask_coverage !== undefined && stepOutput.mask_coverage !== null) {
              summaryDiv.innerHTML += `<p><strong>Mask Coverage:</strong> ${(stepOutput.mask_coverage * 100).toFixed(1)}%</p>`;
            }
          }
          outputDiv.appendChild(summaryDiv);
          
          // Show visualization if available in step.visualization
          const samViz = step.sam_visualization || step.visualization || stepOutput.sam_visualization || stepOutput.visualization;
          if (samViz) {
            const vizDiv = document.createElement('div');
            vizDiv.style.marginTop = '12px';
            vizDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">SAM 2.1 Visualization:</strong>';
            const img = document.createElement('img');
            let imgUrl;
            const vizPath = samViz;
            if (vizPath.startsWith('http')) {
              imgUrl = vizPath;
            } else {
              // Clean path - remove api_results prefix if present
              const cleanPath = vizPath.replace(/^.*api_results[\/\\]/, '').replace(/^[\/\\]/, '');
              imgUrl = buildDownloadUrl(cleanPath);
            }
            img.src = imgUrl;
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.style.borderRadius = '6px';
            img.style.marginTop = '8px';
            img.style.border = '1px solid var(--border)';
            img.onerror = function() {
              console.error('[API Integration] Failed to load dimension visualization:', vizPath, 'tried URL:', imgUrl);
              // Try alternative path formats
              const filename = vizPath.split(/[\/\\]/).pop();
                const altUrl = buildDownloadUrl(filename);
              console.log('[API Integration] Trying alternative dimension viz path:', altUrl);
              this.src = altUrl;
              this.onerror = () => {
                this.style.display = 'none';
                const errorMsg = document.createElement('div');
                errorMsg.style.color = 'var(--muted, #6b7280)';
                errorMsg.style.padding = '8px';
                errorMsg.style.fontSize = '0.9em';
                errorMsg.textContent = 'Dimension visualization not available';
                vizDiv.appendChild(errorMsg);
              };
            };
            vizDiv.appendChild(img);
            outputDiv.appendChild(vizDiv);
          }
        }
        
        // Handle parse step - show diagram image, dimensions table, and PDF download
        else if (stepKey === 'parse' && stepOutput) {
          // Create a container for diagram and dimensions side-by-side
          const contentContainer = document.createElement('div');
          contentContainer.style.display = 'flex';
          contentContainer.style.gap = '20px';
          contentContainer.style.marginTop = '12px';
          contentContainer.style.flexWrap = 'wrap';
          
          // Left side: Mechanical Diagram (Outline Dimension Visual)
          if (stepOutput.mechanical_diagram) {
            const diagramDiv = document.createElement('div');
            diagramDiv.style.flex = '1';
            diagramDiv.style.minWidth = '300px';
            diagramDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">Extracted Outline Dimension Diagram:</strong>';
            const img = document.createElement('img');
            // Convert path to use /api/download endpoint
            const diagramPath = stepOutput.mechanical_diagram;
            let imgUrl;
            if (diagramPath.startsWith('http')) {
              imgUrl = diagramPath;
            } else {
              // Extract relative path from api_results
              let cleanPath = diagramPath;
              // Handle absolute paths
              if (diagramPath.includes('api_results')) {
                cleanPath = diagramPath.split('api_results')[1].replace(/^[\/\\]/, '');
              } else if (diagramPath.includes('diagrams')) {
                // Extract filename if full path
                const filename = diagramPath.split(/[\/\\]/).pop();
                cleanPath = `diagrams/${filename}`;
              } else {
                // Try to extract from path
                const parts = diagramPath.split(/[\/\\]/);
                const filename = parts.pop();
                // Check if it's a diagram file
                if (filename.includes('mechanical') || filename.includes('diagram')) {
                  cleanPath = `diagrams/${filename}`;
                } else {
                  cleanPath = filename;
                }
              }
              imgUrl = buildDownloadUrl(cleanPath);
            }
            img.src = imgUrl;
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.style.borderRadius = '6px';
            img.style.marginTop = '8px';
            img.style.border = '1px solid var(--border)';
            img.onerror = function() {
              console.error('[API Integration] Failed to load diagram image:', diagramPath, 'tried URL:', imgUrl);
              // Try alternative - extract filename and try with diagrams/ prefix
              if (!diagramPath.startsWith('http')) {
                const filename = diagramPath.split(/[\/\\]/).pop().split('?')[0];
                const altUrl = buildDownloadUrl(`diagrams/${filename}`);
                console.log('[API Integration] Trying alternative diagram path:', altUrl);
                this.src = altUrl;
                this.onerror = () => {
                  // Try just filename
                  const filenameOnly = buildDownloadUrl(filename);
                  console.log('[API Integration] Trying filename only:', filenameOnly);
                  this.src = filenameOnly;
                  this.onerror = () => {
                    console.error('[API Integration] All diagram image load attempts failed');
                    this.style.display = 'none';
                    const errorMsg = document.createElement('div');
                    errorMsg.style.color = 'var(--muted, #6b7280)';
                    errorMsg.style.padding = '8px';
                    errorMsg.style.fontSize = '0.9em';
                    errorMsg.textContent = 'Diagram image not available';
                    diagramDiv.appendChild(errorMsg);
                  };
                };
              } else {
                this.style.display = 'none';
              }
            };
            diagramDiv.appendChild(img);
            contentContainer.appendChild(diagramDiv);
          }
          
          // Right side: Dimensions Table and Download
          const rightSideDiv = document.createElement('div');
          rightSideDiv.style.flex = '1';
          rightSideDiv.style.minWidth = '300px';
          
          // Extract dimensions from parsed_specs or stepOutput
          const packageDims = stepOutput.package_dimensions || 
                             (stepOutput.parsed_specs && stepOutput.parsed_specs.package_dimensions) ||
                             {};
          
          // Dimensions Table
          if (packageDims && Object.keys(packageDims).length > 0) {
            const dimsDiv = document.createElement('div');
            dimsDiv.style.marginBottom = '20px';
            dimsDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">Extracted Dimensions:</strong>';
            
            const dimsTable = document.createElement('table');
            dimsTable.className = 'json-table';
            dimsTable.style.width = '100%';
            dimsTable.style.marginTop = '8px';
            
            const tbody = document.createElement('tbody');
            
            // Add dimension rows
            const dimFields = [
              { key: 'body_length_mm', label: 'Body Length' },
              { key: 'length_mm', label: 'Length' },
              { key: 'body_width_mm', label: 'Body Width' },
              { key: 'width_mm', label: 'Width' },
              { key: 'height_mm', label: 'Height/Thickness' },
              { key: 'pin_count', label: 'Pin Count' },
              { key: 'pin_pitch_mm', label: 'Pin Pitch' },
              { key: 'package_type', label: 'Package Type' }
            ];
            
            dimFields.forEach(field => {
              const value = packageDims[field.key];
              if (value !== null && value !== undefined && value !== '') {
                const row = document.createElement('tr');
                const labelCell = document.createElement('td');
                labelCell.className = 'json-table-key';
                labelCell.style.fontWeight = '600';
                labelCell.textContent = field.label;
                row.appendChild(labelCell);
                
                const valueCell = document.createElement('td');
                valueCell.className = 'json-table-value';
                if (typeof value === 'number' && (field.key.includes('mm') || field.key === 'pin_pitch_mm')) {
                  valueCell.textContent = `${value} mm`;
                } else {
                  valueCell.textContent = String(value);
                }
                row.appendChild(valueCell);
                
                tbody.appendChild(row);
              }
            });
            
            if (tbody.children.length > 0) {
              dimsTable.appendChild(tbody);
              dimsDiv.appendChild(dimsTable);
              rightSideDiv.appendChild(dimsDiv);
            }
          }
          
          // OEM Datasheet Download
          if (stepOutput.datasheet_path) {
            const pdfDiv = document.createElement('div');
            pdfDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">OEM Datasheet PDF:</strong>';
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'chain-step-preview';
            downloadBtn.style.marginTop = '8px';
            downloadBtn.style.width = '100%';
            downloadBtn.textContent = '📄 Download Datasheet PDF';
            downloadBtn.onclick = () => {
              // Convert path to use /api/download endpoint
              const pdfPath = stepOutput.datasheet_path;
              let pdfUrl;
              let cleanPath = '';
              if (pdfPath.startsWith('http')) {
                pdfUrl = pdfPath;
              } else {
                // Extract relative path from api_results
                cleanPath = pdfPath;
                // Handle absolute paths - extract relative to api_results
                // First, normalize the path separators
                const normalizedPath = pdfPath.replace(/\\/g, '/');
                
                if (normalizedPath.includes('api_results')) {
                  // Extract everything after api_results
                  const parts = normalizedPath.split('api_results');
                  cleanPath = parts[parts.length - 1].replace(/^\/+/, '');
                } else if (normalizedPath.includes('datasheets')) {
                  // Extract relative path from datasheets folder
                  const datasheetIndex = normalizedPath.indexOf('datasheets');
                  cleanPath = normalizedPath.substring(datasheetIndex);
                } else {
                  // Try to find datasheets in path or use filename
                  const filename = normalizedPath.split('/').pop();
                  if (normalizedPath.toLowerCase().includes('datasheet') || normalizedPath.toLowerCase().endsWith('.pdf')) {
                    cleanPath = `datasheets/${filename}`;
                  } else {
                    cleanPath = filename;
                  }
                }
                pdfUrl = buildDownloadUrl(cleanPath);
              }
              console.log('[API Integration] Downloading datasheet from:', pdfUrl, '(original path:', pdfPath, ', clean path:', cleanPath, ')');
              // Open in new window - browser will handle download
              window.open(pdfUrl, '_blank');
            };
            pdfDiv.appendChild(downloadBtn);
            rightSideDiv.appendChild(pdfDiv);
          }
          
          // Add right side to container if it has content
          if (rightSideDiv.children.length > 0) {
            contentContainer.appendChild(rightSideDiv);
          }
          
          // Add container to output if it has content
          if (contentContainer.children.length > 0) {
            outputDiv.appendChild(contentContainer);
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
        } else if (stepKey === 'visual' && stepOutput) {
          // Special handling for visual step - show anomalies count and list
          if (stepOutput.anomalies_count !== undefined) {
            const anomaliesCountDiv = document.createElement('div');
            anomaliesCountDiv.style.marginTop = '12px';
            anomaliesCountDiv.style.marginBottom = '12px';
            anomaliesCountDiv.innerHTML = `<strong style="display:block;margin-bottom:8px;">Anomalies Detected: ${stepOutput.anomalies_count}</strong>`;
            outputDiv.appendChild(anomaliesCountDiv);
          }
          
          // List all anomalies
          const anomalies = stepOutput.anomalies || (stepOutput.visual_comparison && stepOutput.visual_comparison.anomalies) || [];
          if (anomalies.length > 0) {
            const anomaliesDiv = document.createElement('div');
            anomaliesDiv.style.marginTop = '12px';
            anomaliesDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">Anomalies List:</strong>';
            
            const anomaliesList = document.createElement('div');
            anomaliesList.style.display = 'flex';
            anomaliesList.style.flexDirection = 'column';
            anomaliesList.style.gap = '8px';
            
            anomalies.forEach((anomaly, idx) => {
              const anomalyCard = document.createElement('div');
              anomalyCard.style.padding = '10px';
              anomalyCard.style.border = '1px solid var(--border)';
              anomalyCard.style.borderRadius = '6px';
              anomalyCard.style.backgroundColor = 'var(--bg-secondary, #f9fafb)';
              
              const severity = anomaly.severity || 'medium';
              const severityColors = {
                'high': '#ef4444',
                'medium': '#f59e0b',
                'low': '#eab308'
              };
              anomalyCard.style.borderLeft = `4px solid ${severityColors[severity] || severityColors.medium}`;
              
              const header = document.createElement('div');
              header.style.display = 'flex';
              header.style.justifyContent = 'space-between';
              header.style.alignItems = 'center';
              header.style.marginBottom = '6px';
              
              const typeSpan = document.createElement('span');
              typeSpan.style.fontWeight = '600';
              typeSpan.textContent = `#${idx + 1}: ${(anomaly.type || 'Unknown').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`;
              header.appendChild(typeSpan);
              
              const severityBadge = document.createElement('span');
              severityBadge.style.padding = '2px 8px';
              severityBadge.style.borderRadius = '4px';
              severityBadge.style.fontSize = '0.85em';
              severityBadge.style.fontWeight = '600';
              severityBadge.style.textTransform = 'uppercase';
              severityBadge.style.backgroundColor = severityColors[severity] || severityColors.medium;
              severityBadge.style.color = 'white';
              severityBadge.textContent = severity;
              header.appendChild(severityBadge);
              
              anomalyCard.appendChild(header);
              
              const desc = document.createElement('p');
              desc.style.margin = '0';
              desc.style.color = 'var(--text-secondary, #6b7280)';
              desc.style.fontSize = '0.9em';
              desc.textContent = anomaly.description || 'No description available';
              anomalyCard.appendChild(desc);
              
              anomaliesList.appendChild(anomalyCard);
            });
            
            anomaliesDiv.appendChild(anomaliesList);
            outputDiv.appendChild(anomaliesDiv);
          } else if (stepOutput.anomalies_count === 0) {
            const noAnomaliesDiv = document.createElement('div');
            noAnomaliesDiv.style.marginTop = '12px';
            noAnomaliesDiv.style.padding = '10px';
            noAnomaliesDiv.style.borderRadius = '6px';
            noAnomaliesDiv.style.backgroundColor = '#d1fae5';
            noAnomaliesDiv.style.color = '#065f46';
            noAnomaliesDiv.innerHTML = '<strong>✓ No anomalies detected</strong>';
            outputDiv.appendChild(noAnomaliesDiv);
          }
          
          // Show attribute scores if available
          const attributeScores = stepOutput.visual_comparison?.attribute_scores || stepOutput.attribute_scores || {};
          if (Object.keys(attributeScores).length > 0) {
            const scoresDiv = document.createElement('div');
            scoresDiv.style.marginTop = '12px';
            scoresDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">Visual Attribute Scores:</strong>';
            
            const scoresTable = document.createElement('table');
            scoresTable.className = 'json-table';
            scoresTable.style.width = '100%';
            scoresTable.style.marginTop = '8px';
            
            const thead = document.createElement('thead');
            thead.innerHTML = '<tr><th>Attribute</th><th>Score</th><th>Weight</th></tr>';
            scoresTable.appendChild(thead);
            
            const tbody = document.createElement('tbody');
            
            const attributeLabels = {
              'pin_count_match': 'Pin Count Match',
              'text_quality': 'Text Quality',
              'notch_pin_mapping': 'Notch/Pin Mapping',
              'surface_uniformity': 'Surface Uniformity',
              'package_type_match': 'Package Type Match',
              'pin_pitch_match': 'Pin Pitch Match',
              'marking_placement': 'Marking Placement',
              'overall_visual_assessment': 'Overall Visual Assessment'
            };
            
            const attributeWeights = {
              'pin_count_match': '10%',
              'text_quality': '10%',
              'notch_pin_mapping': '8%',
              'surface_uniformity': '8%',
              'package_type_match': '7%',
              'pin_pitch_match': '4%',
              'marking_placement': '3%',
              'overall_visual_assessment': 'N/A'
            };
            
            // Sort attributes by weight (descending)
            const sortedAttrs = Object.keys(attributeScores).sort((a, b) => {
              const weightA = parseFloat(attributeWeights[a] || '0') || 0;
              const weightB = parseFloat(attributeWeights[b] || '0') || 0;
              return weightB - weightA;
            });
            
            sortedAttrs.forEach(attr => {
              const score = attributeScores[attr];
              if (score !== null && score !== undefined) {
                const row = document.createElement('tr');
                
                const labelCell = document.createElement('td');
                labelCell.style.fontWeight = '600';
                labelCell.textContent = attributeLabels[attr] || attr.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                row.appendChild(labelCell);
                
                const scoreCell = document.createElement('td');
                const scoreValue = parseFloat(score);
                scoreCell.textContent = `${scoreValue.toFixed(1)}/100`;
                
                // Color code based on score
                if (scoreValue >= 80) {
                  scoreCell.style.color = '#10b981'; // green
                } else if (scoreValue >= 60) {
                  scoreCell.style.color = '#f59e0b'; // yellow
                } else {
                  scoreCell.style.color = '#ef4444'; // red
                }
                scoreCell.style.fontWeight = '600';
                row.appendChild(scoreCell);
                
                const weightCell = document.createElement('td');
                weightCell.textContent = attributeWeights[attr] || '-';
                weightCell.style.color = 'var(--text-secondary, #6b7280)';
                row.appendChild(weightCell);
                
                tbody.appendChild(row);
              }
            });
            
            scoresTable.appendChild(tbody);
            scoresDiv.appendChild(scoresTable);
            outputDiv.appendChild(scoresDiv);
          }
          
          // Show observations if available
          const observations = stepOutput.visual_comparison?.observations || [];
          if (observations.length > 0) {
            const obsDiv = document.createElement('div');
            obsDiv.style.marginTop = '12px';
            obsDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">Observations:</strong>';
            const obsList = document.createElement('ul');
            obsList.style.margin = '0';
            obsList.style.paddingLeft = '20px';
            observations.forEach(obs => {
              const li = document.createElement('li');
              li.style.marginBottom = '4px';
              li.textContent = obs;
              obsList.appendChild(li);
            });
            obsDiv.appendChild(obsList);
            outputDiv.appendChild(obsDiv);
          }
          
          // Add annotation button for visual step
          if (sessionId) {
            const annotateDiv = document.createElement('div');
            annotateDiv.style.marginTop = '16px';
            annotateDiv.style.paddingTop = '16px';
            annotateDiv.style.borderTop = '1px solid var(--border)';
            
            const annotateBtn = document.createElement('button');
            annotateBtn.className = 'annotation-toggle-btn';
            annotateBtn.textContent = '📝 Annotate Image';
            annotateBtn.onclick = () => {
              // Find the primary IC image in the modal
              const modal = annotateBtn.closest('.step-preview-modal');
              const img = modal?.querySelector('img[src*="api/download"]') || modal?.querySelector('img');
              
              if (!img) {
                alert('Image not found. Please ensure the IC image is displayed.');
                return;
              }
              
              // Initialize annotation tool
              if (!window.currentAnnotationTool) {
                const imgContainer = img.parentElement;
                if (!imgContainer) {
                  alert('Could not find image container');
                  return;
                }
                
                // Create container ID if it doesn't exist
                if (!imgContainer.id) {
                  imgContainer.id = 'annotation-container-' + Date.now();
                }
                
                window.currentAnnotationTool = new AnnotationTool(img, imgContainer.id);
              }
              
              // Toggle annotation mode
              if (window.currentAnnotationTool.enabled) {
                window.currentAnnotationTool.disable();
                annotateBtn.textContent = '📝 Annotate Image';
                annotateBtn.classList.remove('active');
              } else {
                window.currentAnnotationTool.enable();
                window.currentAnnotationTool.loadAnnotations(sessionId, img.src);
                annotateBtn.textContent = '✓ Stop Annotating';
                annotateBtn.classList.add('active');
              }
            };
            
            annotateDiv.appendChild(annotateBtn);
            outputDiv.appendChild(annotateDiv);
          }
        } else if (stepKey === 'verdict' && stepOutput) {
          // Special handling for verdict step - show weighted scores breakdown
          if (stepOutput.weighted_scores_breakdown) {
            const scoresDiv = document.createElement('div');
            scoresDiv.style.marginTop = '12px';
            scoresDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">Weighted Scores Breakdown:</strong>';
            
            const scoresTable = document.createElement('table');
            scoresTable.className = 'json-table';
            scoresTable.style.width = '100%';
            scoresTable.style.marginTop = '8px';
            
            const thead = document.createElement('thead');
            thead.innerHTML = '<tr><th>Tool</th><th>Score</th><th>Weight</th><th>Weighted Contribution</th></tr>';
            scoresTable.appendChild(thead);
            
            const tbody = document.createElement('tbody');
            const breakdown = stepOutput.weighted_scores_breakdown;
            
            if (breakdown.dimension_analysis) {
              const row = document.createElement('tr');
              row.innerHTML = `
                <td>${breakdown.dimension_analysis.tool || 'SAM 2.1 Dimension Estimator'}</td>
                <td>${breakdown.dimension_analysis.score.toFixed(1)}/100</td>
                <td>${(breakdown.dimension_analysis.weight * 100).toFixed(0)}%</td>
                <td>${breakdown.dimension_analysis.weighted_contribution.toFixed(1)}</td>
              `;
              tbody.appendChild(row);
            }
            
            if (breakdown.visual_analysis) {
              // Overall visual analysis row
              const visualRow = document.createElement('tr');
              visualRow.innerHTML = `
                <td><strong>Visual Analysis (Overall)</strong></td>
                <td><strong>${breakdown.visual_analysis.overall_score.toFixed(1)}/100</strong></td>
                <td><strong>${(breakdown.visual_analysis.weight * 100).toFixed(0)}%</strong></td>
                <td><strong>${breakdown.visual_analysis.weighted_contribution.toFixed(1)}</strong></td>
              `;
              tbody.appendChild(visualRow);
              
              // Individual attribute breakdown (if available)
              if (breakdown.visual_analysis.attribute_breakdown) {
                const attrBreakdown = breakdown.visual_analysis.attribute_breakdown;
                const attrLabels = {
                  'pin_count_match': '  └ Pin Count Match',
                  'text_quality': '  └ Text Quality',
                  'notch_pin_mapping': '  └ Notch/Pin Mapping',
                  'surface_uniformity': '  └ Surface Uniformity',
                  'package_type_match': '  └ Package Type Match',
                  'pin_pitch_match': '  └ Pin Pitch Match',
                  'marking_placement': '  └ Marking Placement'
                };
                
                Object.keys(attrBreakdown).forEach(attr => {
                  const attrData = attrBreakdown[attr];
                  const attrRow = document.createElement('tr');
                  attrRow.style.color = 'var(--text-secondary, #6b7280)';
                  attrRow.style.fontSize = '0.9em';
                  attrRow.innerHTML = `
                    <td>${attrLabels[attr] || `  └ ${attr.replace(/_/g, ' ')}`}</td>
                    <td>${attrData.score.toFixed(1)}/100</td>
                    <td>${(attrData.weight * 100).toFixed(0)}%</td>
                    <td>${attrData.weighted_contribution.toFixed(1)}</td>
                  `;
                  tbody.appendChild(attrRow);
                });
              }
            }
            
            if (breakdown.anomaly_penalty) {
              const row = document.createElement('tr');
              row.style.color = '#ef4444';
              row.innerHTML = `
                <td>${breakdown.anomaly_penalty.tool}</td>
                <td>-${breakdown.anomaly_penalty.penalty.toFixed(1)}</td>
                <td>-</td>
                <td>-${breakdown.anomaly_penalty.penalty.toFixed(1)} (${breakdown.anomaly_penalty.anomaly_count} anomalies, ${breakdown.anomaly_penalty.high_severity_count} high)</td>
              `;
              tbody.appendChild(row);
            }
            
            const finalRow = document.createElement('tr');
            finalRow.style.fontWeight = 'bold';
            finalRow.style.borderTop = '2px solid var(--border)';
            finalRow.innerHTML = `
              <td><strong>Final Score</strong></td>
              <td><strong>${breakdown.final_score.toFixed(1)}/100</strong></td>
              <td>-</td>
              <td><strong>Base: ${breakdown.base_score.toFixed(1)} - Penalty: ${breakdown.anomaly_penalty?.penalty.toFixed(1) || 0}</strong></td>
            `;
            tbody.appendChild(finalRow);
            
            scoresTable.appendChild(tbody);
            scoresDiv.appendChild(scoresTable);
            outputDiv.appendChild(scoresDiv);
          }
        } else if (stepKey !== 'parse' && stepKey !== 'dimension' && stepKey !== 'identify' && stepKey !== 'preprocess' && stepKey !== 'histogram_filter' && stepKey !== 'pin_counter' && stepKey !== 'visual' && stepKey !== 'verdict' && stepOutput && Object.keys(stepOutput).length > 0) {
          // For other steps (not dimension, not parse, not preprocess, not histogram_filter, not pin_counter, not visual, not verdict), try to render as table if it's an object/array
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
      
      // Show visualization if available (but skip for dimension step - already shown above)
      if (step.visualization && stepKey !== 'dimension') {
        const vizDiv = document.createElement('div');
        vizDiv.className = 'step-preview-section';
        vizDiv.innerHTML = `<strong>Visualization:</strong>`;
        const img = document.createElement('img');
        // Convert relative path to absolute URL if needed
        const vizPath = step.visualization;
        
        // Handle different URL formats
        let imgSrc;
        if (vizPath.startsWith('http')) {
          // Already a full URL
          imgSrc = vizPath;
        } else if (vizPath.includes('/api/download') || vizPath.includes('api/download')) {
          // Already formatted as /api/download URL
          imgSrc = vizPath.startsWith('http') ? vizPath : `http://localhost:5001${vizPath}`;
        } else {
          // Clean path - remove api_results prefix if present
          const cleanPath = vizPath.replace(/^.*api_results[\/\\]/, '').replace(/^[\/\\]/, '');
          imgSrc = buildDownloadUrl(cleanPath);
        }
        
        img.src = imgSrc;
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.marginTop = '10px';
        img.style.borderRadius = '6px';
        img.style.border = '1px solid var(--border)';
        img.onerror = function() {
          console.error('[API Integration] Failed to load visualization:', imgSrc, 'Original path:', vizPath);
          // Try alternative - extract just the filename
          const filename = vizPath.split(/[\/\\]/).pop().split('?')[0];
                const altUrl = buildDownloadUrl(filename);
          console.log('[API Integration] Trying alternative viz path:', altUrl);
          this.src = altUrl;
          this.onerror = () => {
            this.style.display = 'none';
            const errorMsg = document.createElement('p');
            errorMsg.textContent = 'Image could not be loaded';
            errorMsg.style.color = 'var(--error)';
            vizDiv.appendChild(errorMsg);
          };
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
      // Prevent duplicate calls - check if summary already exists with more robust check
      const existingSummaries = chat.messages.filter(m => m._sessionId === sessionId && m._hasReport);
      if (existingSummaries.length > 0) {
        console.log(`[API Integration] Summary already exists (${existingSummaries.length} found), skipping fetchFinalResults`);
        console.log('[API Integration] Existing summaries:', existingSummaries.map(m => ({ time: m.time, resultIndex: m._resultIndex })));
        return;
      }
      
      // Also check if we're already fetching (prevent concurrent calls)
      if (fetchFinalResults._fetching && fetchFinalResults._fetching.has(sessionId)) {
        console.log('[API Integration] Already fetching results for this session, skipping');
        return;
      }
      
      // Mark as fetching
      if (!fetchFinalResults._fetching) {
        fetchFinalResults._fetching = new Set();
      }
      fetchFinalResults._fetching.add(sessionId);
      
      try {
        const response = await fetch(`${window.icDetectionAPI.baseUrl}/session/${sessionId}`);
        const data = await response.json();
        
        if (data.status === 'completed' && data.results) {
          // Mark process chain as completed (don't remove it)
          if (processChainMsg) {
            processChainMsg._completed = true;
            // Preserve user choice; default to expanded on completion
            if (typeof processChainMsg._collapsed === 'undefined') {
              processChainMsg._collapsed = false;
            }
            if (typeof processChainMsg._showProcessChain === 'undefined') {
              processChainMsg._showProcessChain = true;
            }
          }
          
          // Remove any existing summaries for this session to prevent duplicates
          // Use a more robust deduplication approach
          const seenSummaryKeys = new Set();
          const beforeCount = chat.messages.length;
          chat.messages = chat.messages.filter(m => {
            if (m._sessionId === sessionId && m._hasReport) {
              // Create a unique key for this summary
              const key = `${m._sessionId}_${m._resultIndex || 0}`;
              if (seenSummaryKeys.has(key)) {
                console.log(`[API Integration] Removing duplicate summary with key: ${key}`);
                return false; // Duplicate
              }
              seenSummaryKeys.add(key);
            }
            return true;
          });
          const removedCount = beforeCount - chat.messages.length;
          if (removedCount > 0) {
            console.log(`[API Integration] Removed ${removedCount} duplicate summary message(s)`);
          }
          
          // Track which result indices we're adding to prevent duplicates
          const addedResultIndices = new Set();
          
          // Add single consolidated summary with download button for each result
          data.results.forEach((apiResult, idx) => {
            // Skip if we already have a summary for this result index
            if (addedResultIndices.has(idx)) {
              console.log(`[API Integration] Skipping duplicate result index ${idx}`);
              return;
            }
            
            // Check if a summary already exists for this result index
            const existingSummary = chat.messages.find(m => 
              m._sessionId === sessionId && 
              m._resultIndex === idx && 
              m._hasReport
            );
            if (existingSummary) {
              console.log(`[API Integration] Summary already exists for result index ${idx}, skipping`);
              addedResultIndices.add(idx);
              return;
            }
            
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
              
              // Format summary as table instead of emoji/heading format
              summaryText = formatSummaryAsTable(summaryText, apiResult);
              
              // Create single consolidated message with both summary and download button
              const finalMsg = {
                role: 'bot',
                text: summaryText,
                time: Date.now() + idx, // Add small offset to ensure unique timestamps
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
              addedResultIndices.add(idx);
              console.log(`[API Integration] Added summary for result index ${idx} of session ${sessionId}`);
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
          
          // Clear fetching flag
          if (fetchFinalResults._fetching) {
            fetchFinalResults._fetching.delete(sessionId);
          }
        }
      } catch (error) {
        console.error('[API Integration] Error fetching final results:', error);
        
        // Clear fetching flag on error
        if (fetchFinalResults._fetching) {
          fetchFinalResults._fetching.delete(sessionId);
        }
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

