// dashboard-query.js - Dashboard functionality for business landing page
// Handles Analyse ICs form, Processed History, and detail modals

let uploadedImages = [];
let uploadedPdf = null;
let historyPage = 0;
let isLoadingHistory = false;
let hasMoreHistory = true;
let currentFilters = { date: 'all', icType: 'all' };

// Define handleAnalyseSubmit early so it's available when form initializes
// This will be implemented later in the file
window.handleAnalyseSubmit = null;

// Switch between Dashboard and Analyse ICs views
// Define IMMEDIATELY so it's available for any inline handlers or early calls
window.switchView = function(view) {
  console.log('[Dashboard] ========== switchView called with view:', view, '==========');
  
  const metricsCard = document.getElementById('metricsCard');
  const analyseContainer = document.getElementById('analyseViewContainer');
  const dashboardBtn = document.getElementById('dashboardBtn');
  const analyseBtn = document.getElementById('analyseIcsBtn');
  
  console.log('[Dashboard] Elements found:', {
    metricsCard: !!metricsCard,
    analyseContainer: !!analyseContainer,
    dashboardBtn: !!dashboardBtn,
    analyseBtn: !!analyseBtn
  });
  
  if (!metricsCard) {
    console.error('[Dashboard] metricsCard element not found!');
    console.error('[Dashboard] Searching for alternatives...');
    const allCards = document.querySelectorAll('.card');
    console.log('[Dashboard] Found cards:', allCards.length);
  }
  if (!analyseContainer) {
    console.error('[Dashboard] analyseViewContainer element not found!');
    console.error('[Dashboard] Searching for alternatives...');
    const containers = document.querySelectorAll('[id*="analyse"]');
    console.log('[Dashboard] Found analyse elements:', containers.length, Array.from(containers).map(el => el.id));
  }
  
  if (view === 'analyse') {
    console.log('[Dashboard] Switching to Analyse ICs view');
    // Hide left column (Hello card) and adjust grid
    const dashboardLeft = document.querySelector('.dashboard-left');
    const dashboardGrid = document.getElementById('dashboardGrid');
    if (dashboardLeft) {
      dashboardLeft.style.setProperty('display', 'none', 'important');
      console.log('[Dashboard] ✓ Hid dashboard left column');
    }
    if (dashboardGrid) {
      dashboardGrid.style.setProperty('grid-template-columns', '1fr', 'important');
      console.log('[Dashboard] ✓ Changed grid to single column');
    }
    
    // Hide search bar
    const searchBar = document.querySelector('.search-bar-top');
    if (searchBar) {
      searchBar.style.setProperty('display', 'none', 'important');
      console.log('[Dashboard] ✓ Hid search bar');
    }
    
    // Show Analyse ICs view
    if (metricsCard) {
      metricsCard.style.setProperty('display', 'none', 'important');
      console.log('[Dashboard] ✓ Hid metrics card');
    } else {
      console.error('[Dashboard] ✗ Could not hide metrics card - element not found');
    }
    if (analyseContainer) {
      analyseContainer.style.setProperty('display', 'flex', 'important');
      analyseContainer.classList.add('show');
      console.log('[Dashboard] ✓ Showed analyse container');
      console.log('[Dashboard] Container computed display:', window.getComputedStyle(analyseContainer).display);
      console.log('[Dashboard] Container classes:', analyseContainer.className);
      console.log('[Dashboard] Container style.display:', analyseContainer.style.display);
      
      // Re-initialize form when view is shown
      setTimeout(() => {
        initializeAnalyseForm();
        initializeImageUpload();
        
        // Load uploaded PDF if one was already uploaded
        if (uploadedPdf) {
          console.log('[Dashboard] Loading previously uploaded PDF');
          loadUploadedPdf();
        }
      }, 100);
    } else {
      console.error('[Dashboard] ✗ Could not show analyse container - element not found');
    }
    
    // Hide share analysis card
    const shareAnalysisCard = document.querySelector('.share-analysis');
    if (shareAnalysisCard) {
      shareAnalysisCard.style.setProperty('display', 'none', 'important');
      console.log('[Dashboard] ✓ Hid share analysis card');
    }
    
    // Update sidebar highlighting
    if (dashboardBtn) {
      dashboardBtn.classList.remove('active');
      console.log('[Dashboard] ✓ Removed active from dashboard button');
    }
    if (analyseBtn) {
      analyseBtn.classList.add('active');
      console.log('[Dashboard] ✓ Added active to analyse button');
    }
  } else {
    console.log('[Dashboard] Switching to Dashboard view');
    // Show left column (Hello card) and restore grid
    const dashboardLeft = document.querySelector('.dashboard-left');
    const dashboardGrid = document.getElementById('dashboardGrid');
    if (dashboardLeft) {
      dashboardLeft.style.setProperty('display', 'flex', 'important');
      console.log('[Dashboard] ✓ Showed dashboard left column');
    }
    if (dashboardGrid) {
      dashboardGrid.style.removeProperty('grid-template-columns');
      console.log('[Dashboard] ✓ Restored grid to two columns');
    }
    
    // Show search bar
    const searchBar = document.querySelector('.search-bar-top');
    if (searchBar) {
      searchBar.style.removeProperty('display');
      console.log('[Dashboard] ✓ Showed search bar');
    }
    
    // Show Dashboard view
    if (metricsCard) {
      metricsCard.style.setProperty('display', 'block', 'important');
      console.log('[Dashboard] ✓ Showed metrics card');
      console.log('[Dashboard] Metrics card computed display:', window.getComputedStyle(metricsCard).display);
    } else {
      console.error('[Dashboard] ✗ Could not show metrics card - element not found');
    }
    if (analyseContainer) {
      analyseContainer.style.setProperty('display', 'none', 'important');
      analyseContainer.classList.remove('show');
      console.log('[Dashboard] ✓ Hid analyse container');
    } else {
      console.error('[Dashboard] ✗ Could not hide analyse container - element not found');
    }
    
    // Show share analysis card
    const shareAnalysisCard = document.querySelector('.share-analysis');
    if (shareAnalysisCard) {
      shareAnalysisCard.style.setProperty('display', 'block', 'important');
      console.log('[Dashboard] ✓ Showed share analysis card');
    }
    
    // Update sidebar highlighting
    if (dashboardBtn) {
      dashboardBtn.classList.add('active');
      console.log('[Dashboard] ✓ Added active to dashboard button');
    }
    if (analyseBtn) {
      analyseBtn.classList.remove('active');
      console.log('[Dashboard] ✓ Removed active from analyse button');
    }
  }
  
  // Force a reflow to ensure changes are visible
  if (metricsCard) metricsCard.offsetHeight;
  if (analyseContainer) analyseContainer.offsetHeight;
  
  console.log('[Dashboard] ========== switchView completed ==========');
};

// Legacy function name for compatibility
window.openProcessLotModal = function(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  window.switchView('analyse');
};

window.closeHistoryDetailModal = function() {
  const modal = document.getElementById('historyDetailModal');
  if (modal) {
    modal.style.display = 'none';
  }
};

// Setup button handlers immediately (works even if DOM is already loaded)
function setupButtonHandlers() {
  console.log('[Dashboard] Setting up button handlers...');
  
  const dashboardBtn = document.getElementById('dashboardBtn');
  const analyseBtn = document.getElementById('analyseIcsBtn');
  
  console.log('[Dashboard] Buttons found:', {
    dashboardBtn: !!dashboardBtn,
    analyseBtn: !!analyseBtn
  });
  
  if (dashboardBtn) {
    // Add click handler (don't clone, keep onclick as fallback)
    const handleDashboardClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[Dashboard] Dashboard button clicked, calling switchView');
      if (typeof window.switchView === 'function') {
        window.switchView('dashboard');
      } else {
        console.error('[Dashboard] switchView function not found!');
      }
    };
    
    dashboardBtn.addEventListener('click', handleDashboardClick);
    console.log('[Dashboard] Dashboard button handler attached');
  } else {
    console.error('[Dashboard] Dashboard button not found!');
  }
  
  if (analyseBtn) {
    console.log('[Dashboard] Found analyse button, attaching handler');
    
    // Add click handler (onclick is already in HTML as fallback)
    const handleAnalyseClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[Dashboard] ===== Analyse button clicked =====');
      if (typeof window.switchView === 'function') {
        console.log('[Dashboard] Calling switchView("analyse")');
        window.switchView('analyse');
      } else {
        console.error('[Dashboard] switchView function not found!');
      }
    };
    
    analyseBtn.addEventListener('click', handleAnalyseClick);
    console.log('[Dashboard] Analyse button handler attached');
  } else {
    console.error('[Dashboard] Analyse button not found!');
  }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Dashboard] Initializing dashboard functionality...');
  
  // Setup button handlers
  setupButtonHandlers();
  
  // Initialize image upload handlers (for Analyse ICs view)
  initializeImageUpload();
  
  // Initialize Analyse ICs form
  initializeAnalyseForm();
  
  // Initialize history loading
  loadProcessedHistory();
  
  // Initialize filters
  initializeFilters();
  
  // Setup infinite scroll
  setupInfiniteScroll();
  
  // Set default view to Dashboard
  window.switchView('dashboard');
});

// Also try to setup handlers immediately if DOM is already loaded
if (document.readyState === 'loading') {
  // DOM is still loading, wait for DOMContentLoaded
} else {
  // DOM is already loaded, setup handlers now
  console.log('[Dashboard] DOM already loaded, setting up handlers immediately');
  setupButtonHandlers();
}

// Image upload handling
function initializeImageUpload() {
  // Initialize for both modal (if exists) and inline view
  const modalInput = document.getElementById('lotImageInput');
  const analyseInput = document.getElementById('analyseImageInput');
  
  if (modalInput) {
    const newInput = modalInput.cloneNode(true);
    modalInput.parentNode.replaceChild(newInput, modalInput);
    newInput.addEventListener('change', handleImageUpload);
  }
  
  if (analyseInput) {
    console.log('[Dashboard] Setting up analyse image input handler');
    const newInput = analyseInput.cloneNode(true);
    analyseInput.parentNode.replaceChild(newInput, analyseInput);
    newInput.addEventListener('change', (e) => {
      console.log('[Dashboard] Image input changed, files:', e.target.files ? e.target.files.length : 0);
      if (typeof handleAnalyseImageUpload === 'function') {
        handleAnalyseImageUpload(e);
      } else {
        console.error('[Dashboard] handleAnalyseImageUpload is not a function!', typeof handleAnalyseImageUpload);
      }
    });
    
    // Also setup PDF upload handler
    const pdfInput = document.getElementById('analysePdfInput');
    if (pdfInput) {
      const newPdfInput = pdfInput.cloneNode(true);
      pdfInput.parentNode.replaceChild(newPdfInput, pdfInput);
      newPdfInput.addEventListener('change', handleAnalysePdfUpload);
    }
  }
}

// Initialize Analyse ICs form
function initializeAnalyseForm() {
  console.log('[Dashboard] ===== initializeAnalyseForm called =====');
  const form = document.getElementById('analyseIcsForm');
  if (!form) {
    console.warn('[Dashboard] Analyse ICs form not found');
    return;
  }
  
  console.log('[Dashboard] Form found, setting up handlers...');
  console.log('[Dashboard] window.handleAnalyseSubmit exists?', typeof window.handleAnalyseSubmit);
  
  // Remove any existing listeners by cloning
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);
  
  // Attach submit handler with explicit logging
  newForm.addEventListener('submit', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[Dashboard] ===== FORM SUBMIT EVENT =====');
    console.log('[Dashboard] Uploaded images count:', uploadedImages.length);
    console.log('[Dashboard] window.handleAnalyseSubmit type:', typeof window.handleAnalyseSubmit);
    
    if (typeof window.handleAnalyseSubmit === 'function') {
      console.log('[Dashboard] Calling window.handleAnalyseSubmit...');
      window.handleAnalyseSubmit(e);
    } else {
      console.error('[Dashboard] window.handleAnalyseSubmit is not a function!');
      alert('Error: Form submission handler not loaded. Please refresh the page.');
    }
  });
  
  // Also attach to button directly as backup
  const submitBtn = newForm.querySelector('#analyseSubmitBtn');
  if (submitBtn) {
    console.log('[Dashboard] Attaching click handler to submit button');
    submitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[Dashboard] ===== SUBMIT BUTTON CLICKED =====');
      console.log('[Dashboard] window.handleAnalyseSubmit type:', typeof window.handleAnalyseSubmit);
      
      if (typeof window.handleAnalyseSubmit === 'function') {
        console.log('[Dashboard] Calling window.handleAnalyseSubmit from button click...');
        window.handleAnalyseSubmit(e);
      } else {
        console.error('[Dashboard] window.handleAnalyseSubmit is not a function!');
        alert('Error: Form submission handler not loaded. Please refresh the page.');
      }
    });
  } else {
    console.error('[Dashboard] Submit button not found!');
  }
  
  console.log('[Dashboard] ✓ Analyse ICs form initialized and handlers attached');
}

function handleImageUpload(event) {
  const files = Array.from(event.target.files);
  
  // Prevent duplicate processing by checking if files are already in uploadedImages
  const newFiles = files.filter(file => {
    // Check if file is already uploaded (by name and size)
    return !uploadedImages.some(img => 
      img.file.name === file.name && img.file.size === file.size
    );
  });
  
  newFiles.forEach(file => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        uploadedImages.push({
          file: file,
          preview: e.target.result
        });
        renderImagePreviews();
      };
      reader.readAsDataURL(file);
    }
  });
  
  // Clear the input value to allow re-selecting the same file
  if (event.target) {
    event.target.value = '';
  }
}

function renderImagePreviews() {
  // Render for modal (if exists)
  const modalContainer = document.getElementById('imagePreviews');
  if (modalContainer) {
    modalContainer.innerHTML = '';
    uploadedImages.forEach((img, index) => {
      const previewDiv = document.createElement('div');
      previewDiv.className = 'image-preview-item';
      previewDiv.innerHTML = `
        <img src="${img.preview}" alt="Preview ${index + 1}">
        <button type="button" class="remove-image-btn" onclick="removeImage(${index})">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      `;
      modalContainer.appendChild(previewDiv);
    });
  }
  
  // Render for analyse view
  const analyseContainer = document.getElementById('analyseImagePreviews');
  if (analyseContainer) {
    analyseContainer.innerHTML = '';
    uploadedImages.forEach((img, index) => {
      const previewDiv = document.createElement('div');
      previewDiv.className = 'image-preview-item';
      previewDiv.innerHTML = `
        <img src="${img.preview}" alt="Preview ${index + 1}">
        <button type="button" class="remove-image-btn" onclick="removeImage(${index})">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      `;
      analyseContainer.appendChild(previewDiv);
    });
  }
}

// Separate handler for analyse view image upload
// uploadedImages and uploadedPdf are already declared at the top of the file

function handleAnalyseImageUpload(event) {
  console.log('[Dashboard] handleAnalyseImageUpload called');
  const files = Array.from(event.target.files);
  console.log('[Dashboard] Files selected:', files.length);
  
  // Prevent duplicate processing
  const newFiles = files.filter(file => {
    return !uploadedImages.some(img => 
      img.file.name === file.name && img.file.size === file.size
    );
  });
  
  console.log('[Dashboard] New files (after deduplication):', newFiles.length);
  
  if (newFiles.length === 0) {
    console.log('[Dashboard] No new files to process');
    return;
  }
  
  let loadedCount = 0;
  newFiles.forEach(file => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        uploadedImages.push({
          file: file,
          preview: e.target.result
        });
        loadedCount++;
        console.log('[Dashboard] Image loaded:', file.name, 'Total:', uploadedImages.length);
        // Render after each image loads
        renderAnalyseImagePreviews();
      };
      reader.onerror = (err) => {
        console.error('[Dashboard] Failed to load image:', file.name, err);
        alert(`Failed to load image: ${file.name}`);
      };
      reader.readAsDataURL(file);
    } else {
      console.warn('[Dashboard] Skipping non-image file:', file.name, file.type);
    }
  });
  
  // Clear input to allow re-selecting
  if (event.target) {
    event.target.value = '';
  }
}

function renderAnalyseImagePreviews() {
  const container = document.getElementById('analyseImagePreviews');
  if (!container) {
    console.warn('[Dashboard] analyseImagePreviews container not found');
    return;
  }
  
  console.log('[Dashboard] Rendering image previews, count:', uploadedImages.length);
  container.innerHTML = '';
  
  if (uploadedImages.length === 0) {
    // Container will be hidden via CSS :empty selector
    return;
  }
  
  uploadedImages.forEach((img, index) => {
    const previewDiv = document.createElement('div');
    previewDiv.className = 'image-preview-item';
    previewDiv.innerHTML = `
      <img src="${img.preview}" alt="Preview ${index + 1}" onerror="console.error('Failed to load preview image', this.src)">
      <button type="button" class="remove-image-btn" onclick="removeAnalyseImage(${index})" title="Remove image">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;
    container.appendChild(previewDiv);
  });
  
  console.log('[Dashboard] Image previews rendered successfully');
}

function removeAnalyseImage(index) {
  uploadedImages.splice(index, 1);
  renderAnalyseImagePreviews();
}

function handleAnalysePdfUpload(event) {
  const file = event.target.files[0];
  if (file && file.type === 'application/pdf') {
    uploadedPdf = file;
    const fileNameSpan = document.getElementById('analysePdfFileName');
    const removeBtn = document.getElementById('removeAnalysePdfBtn');
    if (fileNameSpan) {
      fileNameSpan.textContent = file.name;
    }
    if (removeBtn) {
      removeBtn.style.display = 'inline-block';
    }
  } else {
    uploadedPdf = null;
    const fileNameSpan = document.getElementById('analysePdfFileName');
    const removeBtn = document.getElementById('removeAnalysePdfBtn');
    if (fileNameSpan) fileNameSpan.textContent = 'Upload PDF';
    if (removeBtn) removeBtn.style.display = 'none';
    if (file) {
      alert('Please upload a valid PDF file.');
    }
  }
}

function removeAnalysePdf() {
  uploadedPdf = null;
  const input = document.getElementById('analysePdfInput');
  const fileNameSpan = document.getElementById('analysePdfFileName');
  const removeBtn = document.getElementById('removeAnalysePdfBtn');
  if (input) input.value = '';
  if (fileNameSpan) fileNameSpan.textContent = 'Upload PDF';
  if (removeBtn) removeBtn.style.display = 'none';
  
  // Hide PDF viewer and show placeholder
  const pdfViewer = document.getElementById('pdfViewer');
  const placeholder = document.querySelector('.pdf-viewer-placeholder');
  if (pdfViewer) {
    pdfViewer.src = '';
    pdfViewer.style.display = 'none';
  }
  if (placeholder) placeholder.style.display = 'block';
}

// Check if backend server is running
async function checkServerHealth() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
    
    const response = await fetch('http://localhost:5001/api/health', {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    console.warn('[Dashboard] Server health check failed:', error);
    return false;
  }
}

// Analyse ICs form submission - Make it globally accessible
window.handleAnalyseSubmit = async function(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  
  console.log('[Dashboard] ===== handleAnalyseSubmit called =====');
  console.log('[Dashboard] Uploaded images:', uploadedImages.length);
  
  if (uploadedImages.length === 0) {
    alert('Please upload at least one IC image.');
    return;
  }
  
  // Check server health before proceeding
  const isServerRunning = await checkServerHealth();
  if (!isServerRunning) {
    alert('Backend server is not running. Please start the API server:\n\npython backend/api_server.py\n\nOr navigate to the backend directory and run:\ncd counterfeit_IC/backend\npython api_server.py');
    return;
  }
  
  const submitBtn = document.getElementById('analyseSubmitBtn');
  if (!submitBtn) {
    console.error('[Dashboard] Submit button not found!');
    return;
  }
  
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Processing...';
  
  console.log('[Dashboard] Button disabled, starting analysis...');
  
  // Hide form and show process chain
  const form = document.getElementById('analyseIcsForm');
  const analyseContent = document.getElementById('analyseContent');
  const processChain = document.getElementById('analyseProcessChain');
  
  // Hide form, show process chain
  if (form) {
    form.style.display = 'none';
    console.log('[Dashboard] Form hidden');
  }
  if (processChain) {
    processChain.classList.add('active');
    // Initialize empty chain-step container
    const chainContent = document.createElement('div');
    chainContent.className = 'process-chain-content';
    processChain.innerHTML = '';
    processChain.appendChild(chainContent);
    
    // Add navigation controls for switching between input images and process chain
    // This will handle the display of both views
    addAnalyseNavigation(analyseContent, processChain);
    
    console.log('[Dashboard] Process chain initialized');
  } else {
    console.error('[Dashboard] Process chain container not found!');
  }
  
  try {
    // Create FormData
    const formData = new FormData();
    
    // Add images
    uploadedImages.forEach((img, index) => {
      formData.append('images', img.file);
    });
    
    // Add PDF if provided
    if (uploadedPdf) {
      formData.append('pdf', uploadedPdf);
    }
    
    // Add additional info
    const infoInput = document.getElementById('analyseInfoInput');
    if (infoInput && infoInput.value.trim()) {
      formData.append('additional_info', infoInput.value.trim());
    }
    
    // Call API
    const response = await fetch('http://localhost:5001/api/detect', {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('[Dashboard] Analyse ICs response:', data);
    
    if (!data.session_id) {
      throw new Error('No session ID received from server');
    }
    
    // Start polling for progress
    console.log('[Dashboard] Starting progress polling for session:', data.session_id);
    pollAnalyseProgress(data.session_id);
    
    // Reload history to show new entry
    historyPage = 0;
    hasMoreHistory = true;
    loadProcessedHistory(true);
    
  } catch (error) {
    console.error('[Dashboard] Analyse ICs error:', error);
    
    // Provide more helpful error messages
    let errorMessage = error.message;
    if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
      errorMessage = 'Cannot connect to backend server. Please make sure the API server is running on http://localhost:5001. Start it by running: python backend/api_server.py';
    } else if (error.message.includes('fetch')) {
      errorMessage = 'Network error: Cannot reach the backend server. Please ensure the API server is running.';
    }
    
    alert('Failed to analyse ICs: ' + errorMessage);
    if (processChain) {
      processChain.innerHTML = `<div class="process-error">
        <strong>Error:</strong> ${errorMessage}<br><br>
        <small>Make sure the backend server is running:<br>
        <code>python backend/api_server.py</code></small>
      </div>`;
    }
    // Show form again on error
    const form = document.getElementById('analyseIcsForm');
    const imagePreviewContainer = document.getElementById('analyseImagePreviewContainer');
    if (form) {
      form.style.display = 'block';
    }
    if (imagePreviewContainer) {
      imagePreviewContainer.style.display = 'none';
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

// Poll for progress updates
async function pollAnalyseProgress(sessionId) {
  const processChain = document.getElementById('analyseProcessChain');
  if (!processChain) {
    console.error('[Dashboard] Process chain container not found');
    return;
  }
  
  console.log('[Dashboard] Starting progress polling for session:', sessionId);
  
  let pollCount = 0;
  const maxPolls = 300; // 5 minutes max (1 poll per second)
  let isComplete = false;
  
  const pollInterval = setInterval(async () => {
    pollCount++;
    if (pollCount > maxPolls || isComplete) {
      clearInterval(pollInterval);
      if (!isComplete) {
        console.error('[Dashboard] Progress polling timeout');
        if (processChain) {
          processChain.innerHTML = '<div class="process-error">Analysis timeout - please check server logs</div>';
        }
      }
      return;
    }
    
    try {
      const response = await fetch(`http://localhost:5001/api/progress/${sessionId}`);
      if (!response.ok) {
        if (response.status === 404) {
          console.log('[Dashboard] Session not found, stopping poll');
          clearInterval(pollInterval);
          return;
        }
        console.error('[Dashboard] Progress endpoint error, status:', response.status);
        return;
      }
      
      const data = await response.json();
      console.log('[Dashboard] Progress data received:', data);
      
      // Process all updates
      if (data.updates && Array.isArray(data.updates)) {
        for (const update of data.updates) {
          console.log('[Dashboard] Processing update:', update);
          renderAnalyseProcessStep(update, processChain);
          
          // Check if complete
          if (update.type === 'complete' || (data.session && data.session.status === 'completed')) {
            console.log('[Dashboard] Analysis complete, loading final results');
            isComplete = true;
            clearInterval(pollInterval);
            await loadAnalyseFinalResults(sessionId);
            return;
          }
        }
      }
      
      // Check session status
      if (data.session && data.session.status === 'completed') {
        console.log('[Dashboard] Session marked as completed');
        isComplete = true;
        clearInterval(pollInterval);
        await loadAnalyseFinalResults(sessionId);
        return;
      }
      
    } catch (error) {
      console.error('[Dashboard] Progress polling error:', error);
      // Don't stop polling on individual errors, just log them
    }
  }, 1000); // Poll every second
}

// Store step data for previews
const analyseStepData = {};

// Render process step using chain-step format (like personal chat)
function renderAnalyseProcessStep(data, container) {
  console.log('[Dashboard] renderAnalyseProcessStep called with:', data);
  
  // Ensure we're on the process view (2/2) when rendering steps
  // Don't switch views automatically, but ensure process chain is visible if we're on process view
  const analyseContent = document.getElementById('analyseContent');
  if (analyseContent) {
    const imageView = analyseContent.querySelector('.analyse-image-view');
    const processChain = document.getElementById('analyseProcessChain');
    const navContainer = analyseContent.querySelector('.analyse-view-navigator');
    
    // Only show process chain if we're on process view (2/2)
    if (currentAnalyseView === 'process' && processChain) {
      processChain.style.display = 'flex';
      processChain.style.visibility = 'visible';
      if (imageView) {
        imageView.style.display = 'none';
      }
    }
  }
  
  if (data.type === 'step') {
    const stepKey = data.step;
    const stepTitles = {
      'identify': 'Identifying IC from image',
      'scrape': 'Searching for OEM datasheet',
      'parse': 'Parsing datasheet and extracting diagrams',
      'dimension': 'Estimating dimensions using computer vision',
      'visual': 'Performing visual analysis',
      'verdict': 'Computing final verdict',
      'report': 'Generating detailed report'
    };
    
    // Store step data for preview
    if (!analyseStepData[stepKey]) {
      analyseStepData[stepKey] = {};
    }
    analyseStepData[stepKey] = {
      ...analyseStepData[stepKey],
      ...data,
      output: data.output || data.data || analyseStepData[stepKey].output,
      message: data.message || analyseStepData[stepKey].message
    };
    
    // Find or create process-chain-content container
    let chainContent = container.querySelector('.process-chain-content');
    if (!chainContent) {
      console.log('[Dashboard] Creating process-chain-content container');
      chainContent = document.createElement('div');
      chainContent.className = 'process-chain-content';
      container.innerHTML = '';
      container.appendChild(chainContent);
    }
    
    // Update or add step using chain-step format
    let stepEl = chainContent.querySelector(`[data-step-key="${stepKey}"]`);
    if (!stepEl) {
      console.log('[Dashboard] Creating new step element for:', stepKey);
      stepEl = document.createElement('div');
      stepEl.className = 'chain-step';
      stepEl.dataset.stepKey = stepKey;
      chainContent.appendChild(stepEl);
    }
    
    // Determine status
    let status = 'pending';
    if (data.status === 'completed') status = 'completed';
    else if (data.status === 'running') status = 'active';
    
    stepEl.className = `chain-step ${status}`;
    
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
    title.textContent = data.title || stepTitles[stepKey] || stepKey;
    content.appendChild(title);
    
    if (data.message) {
      const message = document.createElement('div');
      message.className = 'chain-step-message';
      message.textContent = data.message;
      content.appendChild(message);
    }
    
    // Add preview button if step has output (skip scrape step - no preview needed)
    const stepData = analyseStepData[stepKey];
    if (stepKey !== 'scrape' && stepData && (stepData.output || stepData.data || stepData.visualization || stepData.message)) {
      const previewBtn = document.createElement('button');
      previewBtn.className = 'chain-step-preview';
      previewBtn.textContent = 'Preview';
      previewBtn.onclick = (e) => {
        e.stopPropagation();
        showAnalyseStepPreview(stepKey, stepData, stepTitles[stepKey] || stepKey);
      };
      content.appendChild(previewBtn);
    }
    
    // Clear and rebuild
    stepEl.innerHTML = '';
    stepEl.appendChild(indicator);
    stepEl.appendChild(content);
    
    // Reveal step with animation
    if (!stepEl.classList.contains('chain-step-visible')) {
      stepEl.classList.add('chain-step-visible');
    }
    
    // Load PDF when scrape step completes
    if (stepKey === 'scrape' && status === 'completed') {
      const stepData = analyseStepData[stepKey];
      const stepOutput = stepData?.output || stepData?.data || {};
      
      // Priority: uploaded PDF first, then fetched PDF
      if (uploadedPdf) {
        // User uploaded a PDF - keep showing it (don't replace with fetched one)
        console.log('[Dashboard] User uploaded PDF takes priority, keeping it displayed');
      } else if (stepOutput.datasheet_path) {
        // No uploaded PDF, so load the fetched one
        console.log('[Dashboard] Scrape step completed, loading fetched PDF:', stepOutput.datasheet_path);
        loadPdfViewer(stepOutput.datasheet_path);
      }
    }
    
    console.log('[Dashboard] Step rendered:', stepKey, status);
  } else {
    console.log('[Dashboard] Received non-step data:', data.type);
  }
}

// Load final results and display PDF
async function loadAnalyseFinalResults(sessionId) {
  try {
    const response = await fetch(`http://localhost:5001/api/session/${sessionId}`);
    const data = await response.json();
    
    if (data.status === 'completed' && data.results && data.results.length > 0) {
      const result = data.results[0];
      
      // Load PDF if available - check multiple possible locations
      let pdfPath = null;
      
      // Check result datasheet_path first
      if (result.datasheet_path) {
        pdfPath = result.datasheet_path;
      }
      // Check progress data for datasheet
      else if (data.progress && Array.isArray(data.progress)) {
        const scrapeStep = data.progress.find(p => p.step === 'scrape' && (p.output || p.data));
        if (scrapeStep) {
          const stepData = scrapeStep.output || scrapeStep.data || {};
          if (stepData.datasheet_path) {
            pdfPath = stepData.datasheet_path;
          }
        }
        // Also check parse step
        const parseStep = data.progress.find(p => p.step === 'parse' && (p.output || p.data));
        if (parseStep && !pdfPath) {
          const stepData = parseStep.output || parseStep.data || {};
          if (stepData.datasheet_path) {
            pdfPath = stepData.datasheet_path;
          }
        }
      }
      
      // Priority: uploaded PDF first, then fetched PDF
      if (uploadedPdf) {
        // User uploaded a PDF - keep showing it (don't replace with fetched one)
        console.log('[Dashboard] User uploaded PDF takes priority, keeping it displayed');
        loadUploadedPdf();
      } else if (pdfPath) {
        // No uploaded PDF, so load the fetched one
        console.log('[Dashboard] Loading fetched PDF from result:', pdfPath);
        await loadPdfViewer(pdfPath);
      } else {
        console.log('[Dashboard] No PDF found to display');
      }
      
      // Add download report button to process chain view if report is available
      if (result.report_path) {
        addDownloadReportButton(sessionId);
      }
    }
  } catch (error) {
    console.error('[Dashboard] Error loading final results:', error);
  }
}

// Add download report button to process chain view
function addDownloadReportButton(sessionId) {
  const processChain = document.getElementById('analyseProcessChain');
  if (!processChain) {
    console.error('[Dashboard] Process chain container not found for download button');
    return;
  }
  
  // Check if button already exists
  const existingBtn = processChain.querySelector('.download-report-btn');
  if (existingBtn) {
    console.log('[Dashboard] Download button already exists');
    return;
  }
  
  // Create download button
  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'download-report-btn';
  downloadBtn.textContent = '📄 Download Full Report (PDF)';
  downloadBtn.style.marginTop = '20px';
  downloadBtn.style.width = '100%';
  
  downloadBtn.onclick = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      console.log('[Dashboard] Downloading report for session:', sessionId);
      // Use the API client if available, otherwise construct URL directly
      const reportUrl = typeof window !== 'undefined' && window.icDetectionAPI 
        ? window.icDetectionAPI.getReportURL(sessionId)
        : `http://localhost:5001/api/report/${sessionId}`;
      
      console.log('[Dashboard] Report URL:', reportUrl);
      // Open in new tab/window
      const newWindow = window.open(reportUrl, '_blank');
      if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
        // If popup blocked, try direct download via link
        const link = document.createElement('a');
        link.href = reportUrl;
        link.download = `detection_report_${sessionId}.pdf`;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          document.body.removeChild(link);
        }, 100);
      }
    } catch (error) {
      console.error('[Dashboard] Download error:', error);
      alert('Failed to download report. Please try again.');
    }
  };
  
  // Find the process chain content container and append button
  const chainContent = processChain.querySelector('.process-chain-content');
  if (chainContent) {
    chainContent.appendChild(downloadBtn);
  } else {
    // If no chain content, append directly to process chain
    processChain.appendChild(downloadBtn);
  }
  
  console.log('[Dashboard] Download report button added to process chain');
}

// PDF zoom state
let pdfZoomLevel = 1.0; // 1.0 = 100%

// Add keyboard shortcuts for PDF zoom (when PDF viewer is visible)
document.addEventListener('keydown', (e) => {
  const pdfViewer = document.getElementById('pdfViewer');
  const wrapper = document.getElementById('pdfViewerWrapper');
  
  // Only handle zoom shortcuts if PDF viewer is visible
  if (!pdfViewer || !wrapper || wrapper.style.display === 'none') {
    return;
  }
  
  // Check if focus is not in an input field
  const activeElement = document.activeElement;
  if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
    return;
  }
  
  // Ctrl/Cmd + Plus for zoom in
  if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
    e.preventDefault();
    adjustPdfZoom(0.1);
  }
  // Ctrl/Cmd + Minus for zoom out
  else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
    e.preventDefault();
    adjustPdfZoom(-0.1);
  }
  // Ctrl/Cmd + 0 for reset zoom
  else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
    e.preventDefault();
    resetPdfZoom();
  }
});

// Adjust PDF zoom level
function adjustPdfZoom(delta) {
  const pdfViewer = document.getElementById('pdfViewer');
  const zoomLevel = document.getElementById('pdfZoomLevel');
  
  if (!pdfViewer) return;
  
  // Update zoom level (clamp between 0.25 and 3.0)
  pdfZoomLevel = Math.max(0.25, Math.min(3.0, pdfZoomLevel + delta));
  
  // Apply zoom using CSS transform
  pdfViewer.style.transform = `scale(${pdfZoomLevel})`;
  
  // Update zoom level display
  if (zoomLevel) {
    zoomLevel.textContent = Math.round(pdfZoomLevel * 100) + '%';
  }
  
  console.log('[Dashboard] PDF zoom adjusted to:', pdfZoomLevel);
}

// Reset PDF zoom to 100%
function resetPdfZoom() {
  pdfZoomLevel = 1.0;
  const pdfViewer = document.getElementById('pdfViewer');
  const zoomLevel = document.getElementById('pdfZoomLevel');
  
  if (pdfViewer) {
    pdfViewer.style.transform = 'scale(1.0)';
  }
  
  if (zoomLevel) {
    zoomLevel.textContent = '100%';
  }
  
  console.log('[Dashboard] PDF zoom reset to 100%');
}

// Load uploaded PDF into viewer
function loadUploadedPdf() {
  if (!uploadedPdf) {
    console.warn('[Dashboard] No uploaded PDF to load');
    return;
  }
  
  const pdfViewer = document.getElementById('pdfViewer');
  const placeholder = document.querySelector('.pdf-viewer-placeholder');
  
  if (!pdfViewer) {
    console.error('[Dashboard] PDF viewer iframe not found');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    console.log('[Dashboard] Loading uploaded PDF into viewer');
    pdfViewer.src = e.target.result;
    pdfViewer.style.width = '100%';
    pdfViewer.style.height = '100%';
    pdfViewer.style.border = 'none';
    pdfViewer.style.display = 'block';
    
    if (placeholder) {
      placeholder.style.display = 'none';
    }
    
    // Verify PDF loaded
    pdfViewer.onload = () => {
      console.log('[Dashboard] Uploaded PDF loaded successfully');
    };
    
    pdfViewer.onerror = () => {
      console.error('[Dashboard] Failed to load uploaded PDF');
      if (placeholder) {
        placeholder.style.display = 'block';
        placeholder.innerHTML = '<p>Failed to load PDF. Please try again.</p>';
      }
    };
  };
  
  reader.onerror = () => {
    console.error('[Dashboard] Failed to read PDF file');
    alert('Failed to read PDF file. Please try again.');
  };
  
  reader.readAsDataURL(uploadedPdf);
}

// Load PDF in viewer
async function loadPdfViewer(pdfPath) {
  const pdfViewer = document.getElementById('pdfViewer');
  const placeholder = document.querySelector('.pdf-viewer-placeholder');
  
  if (!pdfViewer) {
    console.error('[Dashboard] PDF viewer iframe not found');
    return;
  }
  
  if (!pdfPath) {
    console.warn('[Dashboard] No PDF path provided');
    return;
  }
  
  console.log('[Dashboard] Loading PDF from path:', pdfPath);
  
  // Convert path to URL - use /api/download endpoint which handles MIME types correctly
  let filePath = pdfPath;
  
  // Clean up the path - remove api_results prefix if present, handle both / and \
  if (filePath.includes('api_results')) {
    filePath = filePath.replace(/^.*api_results[\/\\]/, '');
  }
  // Remove leading slashes
  filePath = filePath.replace(/^[\/\\]+/, '');
  
  // Use /api/download endpoint which properly serves PDFs with correct MIME type
  const pdfUrl = `http://localhost:5001/api/download?file=${encodeURIComponent(filePath)}`;
  
  console.log('[Dashboard] Loading PDF from URL:', pdfUrl);
  
  // Set iframe attributes for PDF viewing
  pdfViewer.style.width = '100%';
  pdfViewer.style.height = '100%';
  pdfViewer.style.border = 'none';
  pdfViewer.style.display = 'block';
  
  // Hide placeholder
  if (placeholder) {
    placeholder.style.display = 'none';
  }
  
  // Load PDF
  pdfViewer.src = pdfUrl;
  
  // Handle PDF load success
  pdfViewer.onload = () => {
    console.log('[Dashboard] PDF iframe loaded successfully');
    if (placeholder) {
      placeholder.style.display = 'none';
    }
  };
  
  // Handle PDF load errors - try alternative paths
  pdfViewer.onerror = () => {
    console.error('[Dashboard] Failed to load PDF with /api/download:', pdfUrl);
    
    // Try direct api_results path as fallback (keep the full path including datasheets/)
    const altUrl = `http://localhost:5001/api_results/${filePath}`;
    console.log('[Dashboard] Trying alternative URL:', altUrl);
    
    // Set up new handlers for the fallback attempt
    pdfViewer.onload = () => {
      console.log('[Dashboard] PDF loaded successfully via /api_results');
      if (placeholder) placeholder.style.display = 'none';
    };
    
    pdfViewer.onerror = () => {
      console.error('[Dashboard] Both PDF load methods failed');
      if (placeholder) {
        placeholder.style.display = 'block';
        placeholder.innerHTML = '<p>Failed to load PDF. Please check if the file exists and the server is running.</p>';
      }
    };
    
    pdfViewer.src = altUrl;
  };
}

// Helper function to render JSON as table (copied from chat workflow)
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

// Helper function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Show step preview modal (exact copy from chat workflow)
function showAnalyseStepPreview(stepKey, step, stepTitle) {
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
    
    // Handle parse step - show diagram image, dimensions table, and PDF download
    else if (stepKey === 'parse' && stepOutput) {
      // Create a container for diagram and dimensions side-by-side
      const contentContainer = document.createElement('div');
      contentContainer.style.display = 'flex';
      contentContainer.style.gap = '20px';
      contentContainer.style.marginTop = '12px';
      contentContainer.style.flexWrap = 'wrap';
      
      // Left side: Mechanical Diagram
      if (stepOutput.mechanical_diagram) {
        const diagramDiv = document.createElement('div');
        diagramDiv.style.flex = '1';
        diagramDiv.style.minWidth = '300px';
        diagramDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">Extracted Mechanical Diagram:</strong>';
        const img = document.createElement('img');
        // Convert relative path to absolute URL if needed
        const diagramPath = stepOutput.mechanical_diagram;
        // Use /api/download endpoint for all images
        const cleanPath = diagramPath.replace(/^.*api_results[\/\\]/, '');
        img.src = diagramPath.startsWith('http') ? diagramPath : `http://localhost:5001/api/download?file=${encodeURIComponent(cleanPath)}`;
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.borderRadius = '6px';
        img.style.marginTop = '8px';
        img.style.border = '1px solid var(--border)';
        img.onerror = function() {
          console.error('[Dashboard] Failed to load diagram image:', diagramPath);
          this.style.display = 'none';
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
          // Convert relative path to absolute URL
          const pdfPath = stepOutput.datasheet_path;
          // Try different path formats
          let pdfUrl;
          if (pdfPath.startsWith('http')) {
            pdfUrl = pdfPath;
          } else if (pdfPath.startsWith('/')) {
            pdfUrl = `http://localhost:5001${pdfPath}`;
          } else {
            // Try api_results path
            const cleanPath = pdfPath.replace(/^.*\/([^\/]+\.pdf)$/, '$1');
            pdfUrl = `http://localhost:5001/api_results/datasheets/${encodeURIComponent(cleanPath)}`;
          }
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
      imgSrc = `http://localhost:5001/api/download?file=${encodeURIComponent(cleanPath)}`;
    }
    
    img.src = imgSrc;
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.marginTop = '10px';
    img.style.borderRadius = '6px';
    img.style.border = '1px solid var(--border)';
    img.onerror = function() {
      console.error('[Dashboard] Failed to load visualization:', imgSrc, 'Original path:', vizPath);
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

// Current view state: 'images' (1/2) or 'process' (2/2)
let currentAnalyseView = 'process';
let currentImageIndex = 0;

// Add navigation controls for analyse view
function addAnalyseNavigation(container, processChain) {
  // Remove existing navigation if any
  const existingNav = container.querySelector('.analyse-view-navigator');
  if (existingNav) {
    existingNav.remove();
  }
  
  // Create image preview view container
  let imageView = container.querySelector('.analyse-image-view');
  if (!imageView) {
    imageView = document.createElement('div');
    imageView.className = 'analyse-image-view';
    imageView.style.display = 'none';
    imageView.style.flex = '1';
    imageView.style.overflow = 'auto';
    imageView.style.padding = '24px';
    imageView.style.display = 'flex';
    imageView.style.flexDirection = 'column';
    imageView.style.alignItems = 'stretch';
    imageView.style.justifyContent = 'stretch';
    imageView.style.gap = '0';
    imageView.style.minHeight = '0';
    imageView.style.height = '100%';
    imageView.style.width = '100%';
    imageView.style.padding = '0';
    
    // Image navigation container
    const imageNavContainer = document.createElement('div');
    imageNavContainer.style.display = 'flex';
    imageNavContainer.style.alignItems = 'stretch';
    imageNavContainer.style.gap = '16px';
    imageNavContainer.style.width = '100%';
    imageNavContainer.style.maxWidth = '100%';
    imageNavContainer.style.flex = '1 1 100%';
    imageNavContainer.style.minHeight = '0';
    imageNavContainer.style.minWidth = '0';
    imageNavContainer.style.justifyContent = 'center';
    imageNavContainer.style.boxSizing = 'border-box';
    imageNavContainer.style.height = '100%';
    imageNavContainer.style.padding = '24px';
    
    // Previous image button
    const prevImgBtn = document.createElement('button');
    prevImgBtn.className = 'nav-btn nav-prev';
    prevImgBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    `;
    prevImgBtn.onclick = () => {
      if (currentImageIndex > 0) {
        currentImageIndex--;
        updateImageView(imageView);
      }
    };
    
    // Image display
    const imgDisplay = document.createElement('div');
    imgDisplay.className = 'analyse-image-display';
    imgDisplay.style.flex = '1 1 auto';
    imgDisplay.style.display = 'flex';
    imgDisplay.style.alignItems = 'center';
    imgDisplay.style.justifyContent = 'center';
    imgDisplay.style.minHeight = '0';
    imgDisplay.style.maxHeight = '100%';
    imgDisplay.style.height = '100%';
    imgDisplay.style.background = 'var(--bg)';
    imgDisplay.style.borderRadius = '8px';
    imgDisplay.style.border = '1px solid var(--border)';
    imgDisplay.style.padding = '16px';
    imgDisplay.style.width = '100%';
    imgDisplay.style.maxWidth = '100%';
    imgDisplay.style.minWidth = '0';
    imgDisplay.style.boxSizing = 'border-box';
    
    const img = document.createElement('img');
    img.id = 'analyseCurrentImage';
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100%';
    img.style.width = 'auto';
    img.style.height = 'auto';
    img.style.objectFit = 'contain';
    img.style.borderRadius = '4px';
    img.style.display = 'block';
    imgDisplay.appendChild(img);
    
    // Next image button
    const nextImgBtn = document.createElement('button');
    nextImgBtn.className = 'nav-btn nav-next';
    nextImgBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    `;
    nextImgBtn.onclick = () => {
      if (currentImageIndex < uploadedImages.length - 1) {
        currentImageIndex++;
        updateImageView(imageView);
      }
    };
    
    // Image counter - minimal space, positioned at bottom
    const imgCounter = document.createElement('div');
    imgCounter.className = 'analyse-image-counter';
    imgCounter.style.color = 'var(--muted)';
    imgCounter.style.fontSize = '0.9rem';
    imgCounter.style.flexShrink = '0';
    imgCounter.style.padding = '8px 24px';
    imgCounter.style.textAlign = 'center';
    imgCounter.id = 'analyseImageCounter';
    
    // Make imgDisplay grow to fill available space
    imgDisplay.style.flex = '1 1 auto';
    imgDisplay.style.minWidth = '0';
    imgDisplay.style.minHeight = '0';
    
    // Make navigation buttons flex-shrink: 0 to maintain size
    prevImgBtn.style.flexShrink = '0';
    nextImgBtn.style.flexShrink = '0';
    
    imageNavContainer.appendChild(prevImgBtn);
    imageNavContainer.appendChild(imgDisplay);
    imageNavContainer.appendChild(nextImgBtn);
    imageView.appendChild(imageNavContainer);
    imageView.appendChild(imgCounter);
    
    // Ensure imageView fills available height when shown
    imageView.style.overflow = 'hidden';
    
    container.insertBefore(imageView, processChain);
  }
  
  // Update image view
  updateImageView(imageView);
  
  // Create navigation controls
  const navContainer = document.createElement('div');
  navContainer.className = 'analyse-view-navigator view-navigator';
  navContainer.style.marginTop = '16px';
  
  // Previous button (go to Images - view 1)
  const prevBtn = document.createElement('button');
  prevBtn.className = 'nav-btn nav-prev';
  prevBtn.disabled = currentAnalyseView === 'images';
  prevBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="15 18 9 12 15 6"></polyline>
    </svg>
  `;
  prevBtn.onclick = () => {
    if (currentAnalyseView !== 'images') {
      switchAnalyseView('images', imageView, processChain, navContainer);
    }
  };
  
  // View indicator
  const indicator = document.createElement('div');
  indicator.className = 'nav-indicator';
  indicator.id = 'analyseViewIndicator';
  indicator.textContent = currentAnalyseView === 'images' ? '1/2' : '2/2';
  
  // Next button (go to Process Chain - view 2)
  const nextBtn = document.createElement('button');
  nextBtn.className = 'nav-btn nav-next';
  nextBtn.disabled = currentAnalyseView === 'process';
  nextBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  `;
  nextBtn.onclick = () => {
    if (currentAnalyseView !== 'process') {
      switchAnalyseView('process', imageView, processChain, navContainer);
    }
  };
  
  navContainer.appendChild(prevBtn);
  navContainer.appendChild(indicator);
  navContainer.appendChild(nextBtn);
  container.appendChild(navContainer);
  
  // Start with process chain view (2/2) after analysis starts
  switchAnalyseView('process', imageView, processChain, navContainer);
}

// Switch between image view and process chain view
function switchAnalyseView(view, imageView, processChain, navContainer) {
  currentAnalyseView = view;
  
  if (view === 'images') {
    // Show only images, hide process chain completely
    if (imageView) {
      imageView.style.display = 'flex';
    }
    if (processChain) {
      processChain.style.display = 'none';
      processChain.style.visibility = 'hidden';
    }
  } else {
    // Show process chain, hide images
    if (imageView) {
      imageView.style.display = 'none';
    }
    if (processChain) {
      processChain.style.display = 'flex';
      processChain.style.visibility = 'visible';
    }
  }
  
  // Update navigation buttons
  const prevBtn = navContainer.querySelector('.nav-prev');
  const nextBtn = navContainer.querySelector('.nav-next');
  const indicator = navContainer.querySelector('.nav-indicator');
  
  if (prevBtn) prevBtn.disabled = view === 'images';
  if (nextBtn) nextBtn.disabled = view === 'process';
  if (indicator) indicator.textContent = view === 'images' ? '1/2' : '2/2';
}

// Update image view display
function updateImageView(imageView) {
  const img = imageView.querySelector('#analyseCurrentImage');
  const counter = imageView.querySelector('#analyseImageCounter');
  const prevBtn = imageView.querySelector('.nav-prev');
  const nextBtn = imageView.querySelector('.nav-next');
  
  if (uploadedImages.length === 0) {
    if (img) img.style.display = 'none';
    if (counter) counter.textContent = 'No images uploaded';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }
  
  if (img && uploadedImages[currentImageIndex]) {
    const imageData = uploadedImages[currentImageIndex];
    img.src = imageData.preview || imageData.url || '';
    img.style.display = 'block';
    img.style.visibility = 'visible';
    // Ensure image loads and uses full container space
    img.onload = function() {
      const imgDisplay = img.closest('.analyse-image-display');
      if (imgDisplay) {
        // Force container to use available space
        imgDisplay.style.display = 'flex';
        img.style.display = 'block';
        img.style.visibility = 'visible';
      }
    };
    img.onerror = function() {
      console.error('[Dashboard] Failed to load image:', imageData);
      img.style.display = 'none';
      const imgDisplay = img.closest('.analyse-image-display');
      if (imgDisplay) {
        const errorMsg = document.createElement('div');
        errorMsg.style.color = 'var(--muted)';
        errorMsg.style.padding = '20px';
        errorMsg.style.textAlign = 'center';
        errorMsg.textContent = 'Failed to load image';
        if (!imgDisplay.querySelector('.image-error')) {
          errorMsg.className = 'image-error';
          imgDisplay.appendChild(errorMsg);
        }
      }
    };
  } else if (img) {
    img.style.display = 'none';
  }
  
  if (counter) {
    counter.textContent = `Image ${currentImageIndex + 1} of ${uploadedImages.length}`;
  }
  
  if (prevBtn) prevBtn.disabled = currentImageIndex === 0;
  if (nextBtn) nextBtn.disabled = currentImageIndex >= uploadedImages.length - 1;
}

// Expose functions globally
window.removeAnalyseImage = removeAnalyseImage;
window.removeAnalysePdf = removeAnalysePdf;
// switchView is already defined at the top of the file

function removeImage(index) {
  uploadedImages.splice(index, 1);
  renderImagePreviews();
  // Update file input
  const input = document.getElementById('lotImageInput');
  if (input) {
    input.value = '';
  }
}

function handlePdfUpload(event) {
  const file = event.target.files[0];
  if (file && file.type === 'application/pdf') {
    uploadedPdf = file;
    const fileNameSpan = document.getElementById('pdfFileName');
    const removeBtn = document.getElementById('removePdfBtn');
    if (fileNameSpan) {
      fileNameSpan.textContent = file.name;
    }
    if (removeBtn) {
      removeBtn.style.display = 'inline-block';
    }
  }
}

function removePdf() {
  uploadedPdf = null;
  const input = document.getElementById('lotPdfInput');
  const fileNameSpan = document.getElementById('pdfFileName');
  const removeBtn = document.getElementById('removePdfBtn');
  if (input) input.value = '';
  if (fileNameSpan) fileNameSpan.textContent = 'Upload PDF';
  if (removeBtn) removeBtn.style.display = 'none';
}

// Expose these functions immediately
window.handlePdfUpload = handlePdfUpload;
window.removePdf = removePdf;

// Process Lot form submission
async function handleProcessLotSubmit(event) {
  event.preventDefault();
  
  if (uploadedImages.length === 0) {
    alert('Please upload at least one IC image.');
    return;
  }
  
  const submitBtn = document.getElementById('processLotSubmitBtn');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Processing...';
  
  try {
    // Create FormData
    const formData = new FormData();
    
    // Add images
    uploadedImages.forEach((img, index) => {
      formData.append('images', img.file);
    });
    
    // Add PDF if provided
    if (uploadedPdf) {
      formData.append('pdf', uploadedPdf);
    }
    
    // Add additional info
    const infoInput = document.getElementById('lotInfoInput');
    if (infoInput && infoInput.value.trim()) {
      formData.append('additional_info', infoInput.value.trim());
    }
    
    // Call API
    const response = await fetch('http://localhost:5001/api/detect', {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('[Dashboard] Process Lot response:', data);
    
    // Close modal
    if (typeof window.closeProcessLotModal === 'function') {
      window.closeProcessLotModal();
    }
    
    // Reset form
    resetProcessLotForm();
    
    // Reload history to show new entry
    historyPage = 0;
    hasMoreHistory = true;
    loadProcessedHistory(true);
    
    // Show success message
    showNotification('Lot processing started successfully!', 'success');
    
  } catch (error) {
    console.error('[Dashboard] Process Lot error:', error);
    alert('Failed to process lot: ' + error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

function resetProcessLotForm() {
  uploadedImages = [];
  uploadedPdf = null;
  renderImagePreviews();
  removePdf();
  const form = document.getElementById('processLotForm');
  if (form) form.reset();
  const infoInput = document.getElementById('lotInfoInput');
  if (infoInput) infoInput.value = '';
}

// Analyse ICs form submission (for inline view)
// Duplicate function removed - using window.handleAnalyseSubmit defined above at line 573

// Poll for progress updates
async function pollProgress(sessionId) {
  const processChain = document.getElementById('analyseProcessChain');
  if (!processChain) return;
  
  try {
    const response = await fetch(`http://localhost:5001/api/progress/${sessionId}`);
    if (!response.ok) return;
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            renderAnalyseProcessStep(data, processChain);
            
            // If complete, load final results and PDF
            if (data.type === 'complete') {
              await loadFinalResults(sessionId);
            }
          } catch (e) {
            console.warn('[Dashboard] Failed to parse progress:', e);
          }
        }
      }
    }
  } catch (error) {
    console.error('[Dashboard] Progress polling error:', error);
  }
}

// Render process chain
function renderProcessChain(data, container) {
  if (data.type === 'step') {
    // Update or add step
    let stepEl = container.querySelector(`[data-step="${data.step}"]`);
    if (!stepEl) {
      stepEl = document.createElement('div');
      stepEl.className = 'process-step';
      stepEl.dataset.step = data.step;
      container.appendChild(stepEl);
    }
    
    const statusIcon = data.status === 'completed' ? '✓' : 
                      data.status === 'running' ? '⟳' : '○';
    
    let stepHTML = `
      <div class="step-indicator">${statusIcon}</div>
      <div class="step-content">
        <div class="step-title">${data.title}</div>
        <div class="step-message">${data.message || ''}</div>
    `;
    
    // Add preview button if step has output/visualization
    if (data.output || data.visualization || data.data) {
      stepHTML += `
        <button class="step-preview-btn" onclick="showStepPreview('${data.step}', ${JSON.stringify(data).replace(/"/g, '&quot;')})">
          Preview
        </button>
      `;
    }
    
    stepHTML += `</div>`;
    stepEl.innerHTML = stepHTML;
  }
}

// Show step preview (placeholder - can be enhanced)
function showStepPreview(stepKey, stepData) {
  console.log('[Dashboard] Showing preview for step:', stepKey, stepData);
  // TODO: Implement preview modal or inline preview
  alert(`Preview for ${stepKey}: ${JSON.stringify(stepData).substring(0, 100)}...`);
}

// Load final results and display PDF
async function loadFinalResults(sessionId) {
  try {
    const response = await fetch(`http://localhost:5001/api/session/${sessionId}`);
    const data = await response.json();
    
    if (data.status === 'completed' && data.results && data.results.length > 0) {
      const result = data.results[0];
      
      // Priority: uploaded PDF first, then fetched PDF
      if (uploadedPdf) {
        // User uploaded a PDF - keep showing it (don't replace with fetched one)
        console.log('[Dashboard] User uploaded PDF takes priority, keeping it displayed');
        loadUploadedPdf();
      } else if (result.datasheet_path) {
        // No uploaded PDF, so load the fetched one
        console.log('[Dashboard] Loading fetched PDF from final results:', result.datasheet_path);
        await loadPdfViewer(result.datasheet_path);
      }
    }
  } catch (error) {
    console.error('[Dashboard] Error loading final results:', error);
  }
}

// This loadPdfViewer function is defined earlier in the file (around line 1100)
// This duplicate has been removed - using the main implementation above

// Handle PDF upload for analyse view
function handleAnalysePdfUpload(event) {
  const file = event.target.files[0];
  if (file && file.type === 'application/pdf') {
    uploadedPdf = file;
    const fileNameSpan = document.getElementById('analysePdfFileName');
    const removeBtn = document.getElementById('removeAnalysePdfBtn');
    if (fileNameSpan) {
      fileNameSpan.textContent = file.name;
    }
    if (removeBtn) {
      removeBtn.style.display = 'inline-block';
    }
    
    // Display PDF in viewer immediately when uploaded
    loadUploadedPdf();
  } else {
    uploadedPdf = null;
    const fileNameSpan = document.getElementById('analysePdfFileName');
    const removeBtn = document.getElementById('removeAnalysePdfBtn');
    if (fileNameSpan) fileNameSpan.textContent = 'Upload PDF';
    if (removeBtn) removeBtn.style.display = 'none';
    if (file) {
      alert('Please upload a valid PDF file.');
    }
  }
}

function removeAnalysePdf() {
  uploadedPdf = null;
  const input = document.getElementById('analysePdfInput');
  const fileNameSpan = document.getElementById('analysePdfFileName');
  const removeBtn = document.getElementById('removeAnalysePdfBtn');
  if (input) input.value = '';
  if (fileNameSpan) fileNameSpan.textContent = 'Upload PDF';
  if (removeBtn) removeBtn.style.display = 'none';
  
  // Hide PDF viewer and show placeholder
  const pdfViewer = document.getElementById('pdfViewer');
  const placeholder = document.querySelector('.pdf-viewer-placeholder');
  if (pdfViewer) {
    pdfViewer.src = '';
    pdfViewer.style.display = 'none';
  }
  if (placeholder) placeholder.style.display = 'block';
}

// Reset analyse form (for inline view)
function resetAnalyseForm() {
  uploadedImages = [];
  uploadedPdf = null;
  renderImagePreviews();
  removeAnalysePdf();
  const form = document.getElementById('analyseIcsForm');
  if (form) form.reset();
  const infoInput = document.getElementById('analyseInfoInput');
  if (infoInput) infoInput.value = '';
  
  // Hide process chain
  const processChain = document.getElementById('analyseProcessChain');
  if (processChain) {
    processChain.style.display = 'none';
    processChain.innerHTML = '';
  }
  
  // Reset PDF viewer
  const pdfViewer = document.getElementById('pdfViewer');
  const placeholder = document.querySelector('.pdf-viewer-placeholder');
  if (pdfViewer) {
    pdfViewer.src = '';
    pdfViewer.style.display = 'none';
  }
  if (placeholder) placeholder.style.display = 'block';
}

// Processed History loading
async function loadProcessedHistory(reset = false) {
  if (isLoadingHistory || (!hasMoreHistory && !reset)) return;
  
  isLoadingHistory = true;
  const loadingEl = document.getElementById('historyLoading');
  if (loadingEl) loadingEl.style.display = 'block';
  
  try {
    // TODO: Replace with actual API call to get processed history
    // For now, we'll use localStorage or Supabase to get chat history
    const history = await getProcessedHistory(historyPage, currentFilters);
    
    if (reset) {
      const container = document.getElementById('processedHistoryList');
      if (container) container.innerHTML = '';
    }
    
    if (history.length === 0) {
      hasMoreHistory = false;
      if (historyPage === 0) {
        const container = document.getElementById('processedHistoryList');
        if (container) {
          container.innerHTML = '<div class="empty-history"><p>No processed history yet. Process your first lot to get started.</p></div>';
        }
      }
    } else {
      renderHistoryCards(history);
      historyPage++;
    }
    
  } catch (error) {
    console.error('[Dashboard] Error loading history:', error);
  } finally {
    isLoadingHistory = false;
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

async function getProcessedHistory(page, filters) {
  try {
    // Try to get from Supabase if available
    const chatService = window.chatService;
    if (chatService && typeof chatService.getUserChats === 'function') {
      const chats = await chatService.getUserChats();
      // Convert chats to history format
      const history = chats
        .filter(chat => {
          // Apply filters
          if (filters.date !== 'all') {
            const chatDate = new Date(chat.updated_at || chat.created_at);
            const now = new Date();
            switch (filters.date) {
              case 'today':
                if (chatDate.toDateString() !== now.toDateString()) return false;
                break;
              case 'week':
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                if (chatDate < weekAgo) return false;
                break;
              case 'month':
                const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                if (chatDate < monthAgo) return false;
                break;
            }
          }
          return true;
        })
        .slice(page * 10, (page + 1) * 10)
        .map(chat => ({
          id: chat.id,
          session_id: chat.id,
          part_number: chat.title || 'Unknown',
          timestamp: chat.updated_at || chat.created_at,
          created_at: chat.created_at,
          // These will be loaded from session API when card is clicked
          authenticity_score: null,
          verdict: null,
          manufacturer: null,
          package_type: null,
          ic_image_url: null
        }));
      
      return history;
    }
    
    // Fallback: try to get from API sessions
    // This would require a new endpoint to list all sessions
    return [];
  } catch (error) {
    console.error('[Dashboard] Error getting history:', error);
    return [];
  }
}

function renderHistoryCards(history) {
  const container = document.getElementById('processedHistoryList');
  if (!container) return;
  
  history.forEach(item => {
    const card = createHistoryCard(item);
    container.appendChild(card);
  });
}

function createHistoryCard(item) {
  const card = document.createElement('div');
  card.className = 'history-card';
  card.onclick = () => openHistoryDetail(item);
  
  // Determine authenticity class
  let authenticityClass = 'unknown';
  if (item.authenticity_score !== null && item.authenticity_score !== undefined) {
    if (item.authenticity_score >= 75) {
      authenticityClass = 'authentic';
    } else if (item.authenticity_score >= 50) {
      authenticityClass = 'suspicious';
    } else {
      authenticityClass = 'counterfeit';
    }
  }
  
  // Get IC image - try to find the actual uploaded image
  let icImageUrl = item.ic_image_url || 'assets/logo.png';
  // Try to construct URL from session ID
  if (!item.ic_image_url && item.session_id) {
    // Try common patterns
    icImageUrl = `http://localhost:5001/api_results/uploads/${item.session_id}_0_*.png`;
  }
  
  card.innerHTML = `
    <div class="history-card-image">
      <img src="${icImageUrl}" alt="${item.part_number || 'IC'}" 
           onerror="this.src='assets/logo.png'; this.onerror=null;">
    </div>
    <div class="history-card-content">
      <div class="history-card-header">
        <h3>${item.part_number || 'Unknown'}</h3>
        <span class="authenticity-badge ${authenticityClass}">${item.verdict || 'UNKNOWN'}</span>
      </div>
      <div class="history-card-details">
        <div class="detail-item">
          <span class="detail-label">Score:</span>
          <span class="detail-value">${item.authenticity_score !== null && item.authenticity_score !== undefined ? item.authenticity_score : 'N/A'}/100</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Manufacturer:</span>
          <span class="detail-value">${item.manufacturer || 'N/A'}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Package:</span>
          <span class="detail-value">${item.package_type || 'N/A'}</span>
        </div>
        ${item.pin_count ? `
        <div class="detail-item">
          <span class="detail-label">Pins:</span>
          <span class="detail-value">${item.pin_count}</span>
        </div>
        ` : ''}
        <div class="detail-item">
          <span class="detail-label">Date:</span>
          <span class="detail-value">${formatDate(item.timestamp || item.created_at)}</span>
        </div>
      </div>
    </div>
  `;
  
  return card;
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// History detail modal
function openHistoryDetail(item) {
  const modal = document.getElementById('historyDetailModal');
  const content = document.getElementById('historyDetailContent');
  
  if (!modal || !content) return;
  
  // TODO: Load full details from API
  // For now, render basic info
  content.innerHTML = `
    <div class="detail-loading">
      <p>Loading details...</p>
    </div>
  `;
  
  modal.style.display = 'flex';
  
  // Load full details
  loadHistoryDetails(item.session_id || item.id, content);
}

async function loadHistoryDetails(sessionId, container) {
  try {
    const response = await fetch(`http://localhost:5001/api/session/${sessionId}`);
    const data = await response.json();
    
    if (data.status === 'completed' && data.results && data.results.length > 0) {
      const result = data.results[0];
      
      // Get the chat response which contains process chain and summary
      if (result.chat_response && Array.isArray(result.chat_response)) {
        const summaryMsg = result.chat_response.find(m => m.type === 'summary');
        
        // Build process chain HTML from session progress
        const processChainHTML = buildProcessChainHTML(data.progress || []);
        
        // Render process chain and summary with navigation
        container.innerHTML = `
          <div class="history-detail-view" data-view="summary">
            <div class="detail-process-chain" style="display: none;">
              ${processChainHTML}
            </div>
            <div class="detail-summary">
              ${summaryMsg ? formatSummaryContent(summaryMsg.content) : 'Summary not available'}
              ${result.report_path ? `
                <div style="margin-top: 20px;">
                  <a href="http://localhost:5001/api/report/${sessionId}" target="_blank" class="download-report-btn" style="display: inline-block;">
                    📄 Download Full Report (PDF)
                  </a>
                </div>
              ` : ''}
            </div>
            <div class="detail-navigation">
              <button class="nav-btn nav-prev" onclick="switchDetailView('chain')">← Process Chain</button>
              <span class="nav-indicator">2/2</span>
              <button class="nav-btn nav-next" disabled>Summary →</button>
            </div>
          </div>
        `;
      } else {
        // Fallback: render basic info
        container.innerHTML = `
          <div class="detail-basic">
            <h3>${result.part_number || 'Unknown'}</h3>
            <p><strong>Verdict:</strong> ${result.verdict || 'N/A'}</p>
            <p><strong>Score:</strong> ${result.score || 0}/100</p>
            <p><strong>Manufacturer:</strong> ${result.manufacturer || 'N/A'}</p>
            <p><strong>Package Type:</strong> ${result.package_type || 'N/A'}</p>
            ${result.report_path ? `<a href="http://localhost:5001/api/report/${sessionId}" target="_blank" class="download-report-btn">Download Report</a>` : ''}
          </div>
        `;
      }
    } else {
      container.innerHTML = '<div class="detail-error"><p>Details not available</p></div>';
    }
  } catch (error) {
    console.error('[Dashboard] Error loading details:', error);
    container.innerHTML = '<div class="detail-error"><p>Failed to load details</p></div>';
  }
}

function buildProcessChainHTML(progress) {
  const stepOrder = ['identify', 'scrape', 'parse', 'dimension', 'visual', 'verdict', 'report'];
  const stepTitles = {
    'identify': 'Identifying IC',
    'scrape': 'Searching OEM Datasheet',
    'parse': 'Extracting Parameters',
    'dimension': 'Dimension Analysis',
    'visual': 'Visual Comparison',
    'verdict': 'Calculating Verdict',
    'report': 'Generating Report'
  };
  
  let html = '<div class="process-chain-flow">';
  
  stepOrder.forEach(stepKey => {
    const stepUpdate = progress.find(p => p.step === stepKey);
    const status = stepUpdate ? stepUpdate.status : 'pending';
    const message = stepUpdate ? stepUpdate.message : '';
    
    html += `
      <div class="chain-step" style="opacity: ${status === 'completed' ? '1' : status === 'running' ? '1' : '0.5'}">
        <div class="chain-step-indicator">
          ${status === 'completed' ? '✓' : status === 'running' ? '<div class="chain-step-spinner"></div>' : '<div class="chain-step-dot"></div>'}
        </div>
        <div class="chain-step-content">
          <div class="chain-step-title">${stepTitles[stepKey] || stepKey}</div>
          ${message ? `<div class="chain-step-message">${message}</div>` : ''}
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  return html;
}

function formatSummaryContent(content) {
  // Convert markdown-style formatting to HTML
  return content
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function switchDetailView(view) {
  const detailView = document.querySelector('.history-detail-view');
  if (!detailView) return;
  
  const chainDiv = detailView.querySelector('.detail-process-chain');
  const summaryDiv = detailView.querySelector('.detail-summary');
  const navIndicator = detailView.querySelector('.nav-indicator');
  const prevBtn = detailView.querySelector('.nav-btn.nav-prev');
  const nextBtn = detailView.querySelector('.nav-btn.nav-next');
  
  if (view === 'chain') {
    chainDiv.style.display = 'block';
    summaryDiv.style.display = 'none';
    navIndicator.textContent = '1/2';
    prevBtn.disabled = true;
    nextBtn.disabled = false;
    detailView.dataset.view = 'chain';
  } else {
    chainDiv.style.display = 'none';
    summaryDiv.style.display = 'block';
    navIndicator.textContent = '2/2';
    prevBtn.disabled = false;
    nextBtn.disabled = true;
    detailView.dataset.view = 'summary';
  }
}

window.switchDetailView = switchDetailView;

function renderHistoryDetails(result, container) {
  // Render process chain and summary similar to chat-api-integration.js
  // This will use the same navigation structure
  container.innerHTML = `
    <div class="history-detail-process-chain">
      <!-- Process chain will be rendered here -->
    </div>
    <div class="history-detail-summary">
      <!-- Summary will be rendered here -->
    </div>
  `;
  
  // TODO: Implement full rendering with navigation
}

// Filters
function initializeFilters() {
  const filterDate = document.getElementById('filterDate');
  const filterICType = document.getElementById('filterICType');
  const clearBtn = document.getElementById('clearFilters');
  
  if (filterDate) {
    filterDate.addEventListener('change', (e) => {
      currentFilters.date = e.target.value;
      applyFilters();
    });
  }
  
  if (filterICType) {
    filterICType.addEventListener('change', (e) => {
      currentFilters.icType = e.target.value;
      applyFilters();
    });
  }
  
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      currentFilters = { date: 'all', icType: 'all' };
      if (filterDate) filterDate.value = 'all';
      if (filterICType) filterICType.value = 'all';
      applyFilters();
    });
  }
}

function applyFilters() {
  historyPage = 0;
  hasMoreHistory = true;
  loadProcessedHistory(true);
  
  const clearBtn = document.getElementById('clearFilters');
  const hasActiveFilters = currentFilters.date !== 'all' || currentFilters.icType !== 'all';
  if (clearBtn) {
    clearBtn.style.display = hasActiveFilters ? 'inline-block' : 'none';
  }
}

// Infinite scroll
function setupInfiniteScroll() {
  const container = document.getElementById('processedHistoryList');
  if (!container) return;
  
  // Use intersection observer for infinite scroll
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && hasMoreHistory && !isLoadingHistory) {
        loadProcessedHistory();
      }
    });
  }, {
    rootMargin: '100px'
  });
  
  // Observe the loading element
  const loadingEl = document.getElementById('historyLoading');
  if (loadingEl) {
    observer.observe(loadingEl);
  }
}

// Notification helper
function showNotification(message, type = 'info') {
  // Simple notification - can be enhanced later
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    z-index: 10000;
  `;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// switchView is already defined at the top of the file - no need to redefine here

window.closeHistoryDetailModal = function() {
  const modal = document.getElementById('historyDetailModal');
  if (modal) {
    modal.style.display = 'none';
  }
};

// Toggle sidebar
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebarToggle');
  if (sidebar) {
    const isCollapsed = sidebar.classList.toggle('collapsed');
    console.log('[Dashboard] Sidebar toggled, collapsed:', isCollapsed);
    
    // Update aria-expanded for accessibility
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', !isCollapsed ? 'true' : 'false');
    }
  }
}

// Expose other functions globally
window.handleImageUpload = handleImageUpload;
window.handleAnalyseImageUpload = handleAnalyseImageUpload;
window.handleAnalysePdfUpload = handleAnalysePdfUpload;
window.removeImage = removeImage;
window.removePdf = removePdf;
window.removeAnalysePdf = removeAnalysePdf;
window.handleProcessLotSubmit = handleProcessLotSubmit;
// window.handleAnalyseSubmit is already defined above as window.handleAnalyseSubmit
window.openHistoryDetail = openHistoryDetail;
window.closeAnalyseView = closeAnalyseView;
window.toggleSidebar = toggleSidebar;
window.showStepPreview = showStepPreview;
window.adjustPdfZoom = adjustPdfZoom;
window.resetPdfZoom = resetPdfZoom;

// Immediate test - check if button exists right away
(function() {
  function checkButton() {
    const btn = document.getElementById('analyseIcsBtn');
    if (btn) {
      console.log('[Dashboard] ✓ Analyse button found immediately');
      // Add a simple test click handler
      btn.addEventListener('click', function(e) {
        console.log('[Dashboard] Button clicked via immediate handler');
        if (typeof window.switchView === 'function') {
          window.switchView('analyse');
        }
      });
    } else {
      console.log('[Dashboard] ⚠ Analyse button not found yet, will retry...');
      setTimeout(checkButton, 100);
    }
  }
  checkButton();
})();

