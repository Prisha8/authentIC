// chat.js — chat UI + collapsible sidebar + Save Chat behavior
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const sidebar = document.getElementById('sidebar');
  const toggleSidebar = document.getElementById('toggleSidebar');
  const newChatBtn = document.getElementById('newChatBtn');
  const chatList = document.getElementById('chatList');
  const messagesEl = document.getElementById('messages');
  const sendBtn = document.getElementById('sendBtn');
  const promptEl = document.getElementById('prompt');
  const imgInput = document.getElementById('imgInput');
  const saveChatBtn = document.getElementById('saveChatBtn');

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

  // Helpers
  function formatTime(date = new Date()){
    return date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  }

  function createChat(title){
    const id = 'c' + Date.now();
    const chat = { id, title: title || `Chat ${chats.length + 1}`, messages: [] };
    chats.unshift(chat);
    renderChatList();
    setActiveChat(chat.id);
    // Clear the message area to show empty state
    renderMessages();
  }

  function renderChatList(){
    if(!chatList) return;
    chatList.innerHTML = '';
    chats.forEach(c => {
      const li = document.createElement('li');
      li.className = 'chat-item' + (c.id === activeChatId ? ' active' : '');
      li.dataset.id = c.id;
      li.innerHTML = `<div><h5>${escapeHtml(c.title)}</h5></div><div class="time">${c.messages.length ? formatTime(new Date(c.messages[c.messages.length-1].time)) : ''}</div>`;
      li.addEventListener('click', ()=> setActiveChat(c.id));
      chatList.appendChild(li);
    });
  }

  function setActiveChat(id){
    activeChatId = id;
    document.querySelectorAll('#chatList .chat-item').forEach(it => it.classList.toggle('active', it.dataset.id === id));
    renderMessages();
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
          // Simple markdown-style formatting
          let formattedText = m.text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
            .replace(/^• (.+)$/gm, '<div style="padding-left:1em">• $1</div>') // Bullet points
            .replace(/^(\d+)\. (.+)$/gm, '<div style="padding-left:1em">$1. $2</div>') // Numbered lists
            .replace(/^✓ (.+)$/gm, '<div style="color:#10b981;padding-left:1em">✓ $1</div>') // Green checkmarks
            .replace(/^⚠ (.+)$/gm, '<div style="color:#f59e0b;padding-left:1em">⚠ $1</div>'); // Orange warnings
          
          p.innerHTML = formattedText;
          p.style.whiteSpace = 'pre-line';
          p.style.lineHeight = '1.6';
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

  // new chat
  if (newChatBtn) newChatBtn.addEventListener('click', ()=> {
    // Navigate to query page if not already there
    if (!window.location.pathname.includes('query.html')) {
      window.location.href = 'query.html';
    } else {
      // If already on query page, create new chat
      createChat('New Detection');
    }
  });

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
  function handleSend(){
  const text = promptEl.value.trim();
  if(!text && !attachedFile){
    alert('Please write a prompt or attach an image.');
    return;
  }
  // create a chat if none exists
  if(!activeChatId) createChat('New Detection');
  const chat = chats.find(c => c.id === activeChatId);

  // build user message and attach image if present
  const userMsg = { role:'user', text: text || '(image only)', time: Date.now(), img: null };
  if(attachedFile) userMsg.img = URL.createObjectURL(attachedFile);
  chat.messages.push(userMsg);

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

        // Small delay before showing final result
        setTimeout(() => {
          // Remove the thinking message
          const idx = chat.messages.findIndex(m => m._thinking);
          if(idx !== -1) chat.messages.splice(idx, 1);

          // Fixed analysis for SN74AHC04N (TI logic inverter)
          const confidence = 90;
          const uncertainty = 10;
          
          const result = `**Quick Verdict**

I identify this part as **SN74AHC04N** (TI logic inverter, 14-pin SOIC style). Based on multimodal checks I am **${confidence}% confident** this is authentic, with a **${uncertainty}% residual uncertainty** due to a local surface anomaly and slight OCR spacing variation.

**Summary of Checks Performed**

• Image enhancement and glare removal applied, SR crops produced for micro-text
• OCR normalized text extracted: SN74AHC04N (high confidence)
• Logo match against TI reference via Siamese embedding: similarity 0.89 (pass threshold)
• Pin detection: 14 pins detected, rows parallel, pitch measured ≈ 1.27mm ± 0.03mm consistent with SOIC-14
• Notch/pin-1 marker detected on short edge (orientation confirmed)
• Package classification: SOIC-14 (geometry score 0.92)
• Surface texture scan (LBP + Laws' + CNN fusion): mostly consistent with reference but a small localized roughness patch near the marking line detected (anomaly score 0.34)
• Golden-IC embedding similarity (whole-device): 0.84 (good match, slightly below ideal lab-captured baseline)

**Why ${confidence}% Confident**

✓ Strong textual match to SN74AHC04N and consistent two-line marking layout
✓ TI logo and overall package geometry closely match Golden IC references
✓ Pin count, pitch, and notch presence all conform to datasheet constraints for SOIC-14
✓ Multimodal fusion weights favor geometry, marking, and logo signals which are all positive

**Remaining ${uncertainty}% Uncertainty**

⚠ Localized surface roughness/sanding pattern beneath the marking could indicate post-manufacture rework or cleaning that affects marking clarity
⚠ OCR spacing/kerning shows a minor deviation from a small subset of Golden prints (within relaxed photo tolerance but present)
⚠ Whole-device embedding is slightly lower than best-case lab images, which could be due to lighting, lens angle, or subtle manufacturing variance

**Fault Checks (electrical/physical)**

✓ Visual pin geometry shows no missing or severely bent pins
⚠ Pin continuity faults cannot be ruled out by imaging alone
⚠ Surface anomaly is physical and merits closer inspection (possible sanding, re-etch, or residue) which can correlate with rework but not necessarily counterfeit

**Recommended Next Actions**

1. Run quick electrical tests: continuity on each pin and simple bench functional test of SN74AHC04 logic gates
2. If still unsure, perform nondestructive internal inspection (X-ray or SEM) to confirm die marking, wire bonds, and internal package structure
3. If highest assurance is required, destructive decapsulation and die-level comparison is definitive
4. Optionally upload packaging/tape-reel label images or a top-down high-exposure shot to reduce the remaining uncertainty

**Final Report Prepared**

I have generated a detailed report bundle including SR-enhanced marking crop, logo match overlay, pin index & pitch map, texture anomaly heatmap, extracted datasheet snippet, and summary verdict logs.`;
          
          chat.messages.push({ role:'bot', text: result, time: Date.now(), _hasReport: true, _reportId: 'report_' + Date.now() });

          // Re-enable controls
          if(sendBtn) sendBtn.disabled = false;
          if(promptEl) promptEl.disabled = false;

          renderMessages();
          renderChatList();
        }, 600);
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

  // save chat title
  if(saveChatBtn) saveChatBtn.addEventListener('click', () => {
    if(!activeChatId){ alert('Start a chat first.'); return; }
    const chat = chats.find(c => c.id === activeChatId);
    const newTitle = prompt('Enter a title for this chat:', chat.title || 'IC Check');
    if(newTitle && newTitle.trim()){
      chat.title = newTitle.trim();
      renderChatList();
    }
  });

  // basic esc to close collapsed sidebar on mobile: clicking outside closes (optional)
  document.addEventListener('click', (e) => {
    if(window.innerWidth < 900 && sidebar && !sidebar.contains(e.target) && !sidebar.classList.contains('collapsed')) {
      sidebar.classList.add('collapsed');
    }
  });

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

  // Check if we came from "New Chat" button
  const urlParams = new URLSearchParams(window.location.search);
  const isNewChatRequest = urlParams.get('new') === 'true';
  
  if (isNewChatRequest) {
    // Create a fresh new chat when coming from dashboard
    createChat('New Detection');
    // Clean up URL without reloading
    window.history.replaceState({}, '', 'query.html');
  } else if (chats.length === 0) {
    // create default demo chat only if no chats exist
    createChat('IC Check 1');
  }
});
