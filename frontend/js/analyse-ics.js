// analyse-ics.js - Handles the Analyse ICs page functionality

let uploadedImages = [];
let uploadedPdf = null;
let currentSessionId = null;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Analyse ICs] Initializing...');
  
  // Initialize image upload handler
  const imageInput = document.getElementById('analyseImageInput');
  if (imageInput) {
    imageInput.addEventListener('change', handleImageUpload);
  }
  
  // Initialize PDF upload handler
  const pdfInput = document.getElementById('analysePdfInput');
  if (pdfInput) {
    pdfInput.addEventListener('change', handlePdfUpload);
  }
  
  // Initialize form submission
  const form = document.getElementById('analyseIcsForm');
  if (form) {
    form.addEventListener('submit', handleSubmit);
  }
});

// Image upload handling
function handleImageUpload(event) {
  const files = Array.from(event.target.files);
  
  // Prevent duplicate processing
  const newFiles = files.filter(file => {
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
  
  // Clear input to allow re-selecting
  if (event.target) {
    event.target.value = '';
  }
}

function renderImagePreviews() {
  const container = document.getElementById('analyseImagePreviews');
  if (!container) return;
  
  container.innerHTML = '';
  
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
    container.appendChild(previewDiv);
  });
}

function removeImage(index) {
  uploadedImages.splice(index, 1);
  renderImagePreviews();
}

// PDF upload handling
function handlePdfUpload(event) {
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
    
    // Display uploaded PDF immediately in the viewer
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
    
    // Clear PDF viewer
    const pdfViewer = document.getElementById('pdfViewer');
    const placeholder = document.querySelector('.pdf-viewer-placeholder');
    if (pdfViewer) {
      pdfViewer.src = '';
      pdfViewer.style.display = 'none';
    }
    if (placeholder) {
      placeholder.style.display = 'block';
    }
  }
}

// Load uploaded PDF in viewer
function loadUploadedPdf() {
  if (!uploadedPdf) {
    console.warn('[Analyse ICs] No uploaded PDF to display');
    return;
  }
  
  const pdfViewer = document.getElementById('pdfViewer');
  const placeholder = document.querySelector('.pdf-viewer-placeholder');
  const container = document.getElementById('pdfViewerContainer');
  
  if (!pdfViewer) {
    console.error('[Analyse ICs] PDF viewer iframe not found');
    return;
  }
  
  if (!container) {
    console.error('[Analyse ICs] PDF viewer container not found');
    return;
  }
  
  console.log('[Analyse ICs] Loading uploaded PDF:', uploadedPdf.name);
  
  // Clean up any previous blob URL
  if (pdfViewer.src && pdfViewer.src.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(pdfViewer.src);
    } catch (e) {
      // Ignore errors when revoking
    }
  }
  
  // Ensure container is visible and has proper dimensions
  container.style.display = 'flex';
  container.style.position = 'relative';
  container.style.flex = '1';
  container.style.minHeight = '0';
  
  // Ensure right pane is visible and has proper height
  const rightPane = container.closest('.analyse-right-pane');
  if (rightPane) {
    rightPane.style.display = 'flex';
    rightPane.style.flexDirection = 'column';
    rightPane.style.flex = '0 1 50%';
    rightPane.style.minHeight = '0';
    rightPane.style.height = '100%';
  }
  
  // Use FileReader with data URL - simple and reliable approach
  const reader = new FileReader();
  
  reader.onload = (e) => {
    console.log('[Analyse ICs] Loading uploaded PDF into viewer');
    
    // Hide placeholder first
    if (placeholder) {
      placeholder.style.display = 'none';
    }
    
    // Set iframe attributes for PDF viewing
    pdfViewer.setAttribute('type', 'application/pdf');
    pdfViewer.style.width = '100%';
    pdfViewer.style.height = '100%';
    pdfViewer.style.border = 'none';
    pdfViewer.style.display = 'block';
    pdfViewer.style.position = 'absolute';
    pdfViewer.style.top = '0';
    pdfViewer.style.left = '0';
    pdfViewer.style.right = '0';
    pdfViewer.style.bottom = '0';
    pdfViewer.style.zIndex = '2';
    pdfViewer.style.visibility = 'visible';
    
    // Set the PDF source
    pdfViewer.src = e.target.result;
    console.log('[Analyse ICs] PDF src set, iframe display:', pdfViewer.style.display, 'visibility:', pdfViewer.style.visibility);
    
    // Verify PDF loaded
    pdfViewer.onload = () => {
      console.log('[Analyse ICs] Uploaded PDF loaded successfully');
      if (placeholder) {
        placeholder.style.display = 'none';
      }
    };
    
    pdfViewer.onerror = () => {
      console.error('[Analyse ICs] Failed to load uploaded PDF');
      if (placeholder) {
        placeholder.style.display = 'block';
        placeholder.innerHTML = '<p>Failed to load PDF. Please try again.</p>';
      }
    };
    
    // Force a reflow to ensure iframe is rendered
    void pdfViewer.offsetHeight;
  };
  
  reader.onerror = () => {
    console.error('[Analyse ICs] Failed to read uploaded PDF file');
    if (placeholder) {
      placeholder.style.display = 'block';
      placeholder.innerHTML = '<p>Failed to read uploaded PDF file.</p>';
    }
  };
  
  // Read file as data URL
  reader.readAsDataURL(uploadedPdf);
}

function removeAnalysePdf() {
  // Clean up blob URL if it exists
  const pdfViewer = document.getElementById('pdfViewer');
  if (pdfViewer && pdfViewer.src && pdfViewer.src.startsWith('blob:')) {
    URL.revokeObjectURL(pdfViewer.src);
  }
  
  uploadedPdf = null;
  const input = document.getElementById('analysePdfInput');
  const fileNameSpan = document.getElementById('analysePdfFileName');
  const removeBtn = document.getElementById('removeAnalysePdfBtn');
  if (input) input.value = '';
  if (fileNameSpan) fileNameSpan.textContent = 'Upload PDF';
  if (removeBtn) removeBtn.style.display = 'none';
  
  // Clear PDF viewer
  const placeholder = document.querySelector('.pdf-viewer-placeholder');
  if (pdfViewer) {
    pdfViewer.src = '';
    pdfViewer.style.display = 'none';
  }
  if (placeholder) {
    placeholder.style.display = 'block';
  }
}

// Form submission
async function handleSubmit(event) {
  event.preventDefault();
  
  if (uploadedImages.length === 0) {
    alert('Please upload at least one IC image.');
    return;
  }
  
  const submitBtn = document.getElementById('analyseSubmitBtn');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Processing...';
  
  // Show process chain container
  const processChain = document.getElementById('analyseProcessChain');
  if (processChain) {
    processChain.classList.add('active');
    processChain.innerHTML = '<div class="process-loading">Initializing analysis...</div>';
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
    
    // Get user type and add to form data
    const userType = localStorage.getItem('authentIC_userType') || 'business';
    formData.append('user_type', userType);
    
    // Call API
    const response = await fetch('http://localhost:5001/api/detect', {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('[Analyse ICs] Response:', data);
    currentSessionId = data.session_id;
    
    // Start polling for progress
    pollProgress(data.session_id);
    
  } catch (error) {
    console.error('[Analyse ICs] Error:', error);
    
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
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

// Poll for progress updates
async function pollProgress(sessionId) {
  const processChain = document.getElementById('analyseProcessChain');
  if (!processChain) return;
  
  try {
    const response = await fetch(`http://localhost:5001/api/progress/${sessionId}`);
    if (!response.ok) {
      console.error('[Analyse ICs] Progress endpoint not available');
      return;
    }
    
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
            renderProcessStep(data, processChain);
            
            // If complete, load final results and PDF
            if (data.type === 'complete') {
              await loadFinalResults(sessionId);
              
              // Show notification
              if (window.notificationService) {
                window.notificationService.addNotification(
                  'Analysis Complete',
                  'Your IC analysis has been completed successfully. View results in the dashboard.',
                  'success',
                  { label: 'View Dashboard', url: 'dashboard.html' }
                );
              }
            }
          } catch (e) {
            console.warn('[Analyse ICs] Failed to parse progress:', e);
          }
        }
      }
    }
  } catch (error) {
    console.error('[Analyse ICs] Progress polling error:', error);
  }
}

// Render process step
function renderProcessStep(data, container) {
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
    
    stepEl.innerHTML = `
      <div class="step-indicator">${statusIcon}</div>
      <div class="step-content">
        <div class="step-title">${data.title}</div>
        <div class="step-message">${data.message || ''}</div>
      </div>
    `;
    
    // Load PDF when scrape step completes
    if (data.step === 'scrape' && data.status === 'completed' && data.data) {
      const stepOutput = data.data;
      // Priority: uploaded PDF first, then fetched PDF
      if (uploadedPdf) {
        // User uploaded a PDF - keep showing it (don't replace with fetched one)
        console.log('[Analyse ICs] User uploaded PDF takes priority, keeping it displayed');
      } else if (stepOutput.datasheet_path) {
        // No uploaded PDF, so load the fetched one
        console.log('[Analyse ICs] Scrape step completed, loading fetched PDF:', stepOutput.datasheet_path);
        loadPdfViewer(stepOutput.datasheet_path);
      }
    }
  }
}

// Load final results and display PDF
async function loadFinalResults(sessionId) {
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
        console.log('[Analyse ICs] User uploaded PDF takes priority, keeping it displayed');
        loadUploadedPdf();
      } else if (pdfPath) {
        // No uploaded PDF, so load the fetched one
        console.log('[Analyse ICs] Loading fetched PDF from result:', pdfPath);
        await loadPdfViewer(pdfPath);
      } else {
        console.log('[Analyse ICs] No PDF found to display');
      }
    }
  } catch (error) {
    console.error('[Analyse ICs] Error loading final results:', error);
  }
}

// Load PDF in viewer
async function loadPdfViewer(pdfPath) {
  const pdfViewer = document.getElementById('pdfViewer');
  const placeholder = document.querySelector('.pdf-viewer-placeholder');
  
  if (!pdfViewer) {
    console.error('[Analyse ICs] PDF viewer iframe not found');
    return;
  }
  
  if (!pdfPath) {
    console.warn('[Analyse ICs] No PDF path provided');
    return;
  }
  
  console.log('[Analyse ICs] Loading PDF from path:', pdfPath);
  
  // Convert path to URL - use /api/download endpoint which handles MIME types correctly
  let filePath = pdfPath;
  
  // Clean up the path - remove api_results prefix if present, handle both / and \
  if (filePath.includes('api_results')) {
    filePath = filePath.replace(/^.*api_results[\/\\]/, '');
  }
  // Remove leading slashes
  filePath = filePath.replace(/^[\/\\]+/, '');
  
  // Use /api/download endpoint which properly serves PDFs with correct MIME type
  const userType = localStorage.getItem('authentIC_userType') || 'business';
  const pdfUrl = `http://localhost:5001/api/download?file=${encodeURIComponent(filePath)}&user_type=${userType}`;
  
  console.log('[Analyse ICs] Loading PDF from URL:', pdfUrl);
  
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
    console.log('[Analyse ICs] PDF iframe loaded successfully');
    if (placeholder) {
      placeholder.style.display = 'none';
    }
  };
  
  // Handle PDF load errors - try alternative paths
  pdfViewer.onerror = () => {
    console.error('[Analyse ICs] Failed to load PDF with /api/download:', pdfUrl);
    
    // Try direct api_results path as fallback (keep the full path including datasheets/)
    const altUrl = `http://localhost:5001/api_results/${filePath}`;
    console.log('[Analyse ICs] Trying alternative URL:', altUrl);
    
    // Set up new handlers for the fallback attempt
    pdfViewer.onload = () => {
      console.log('[Analyse ICs] PDF loaded successfully via /api_results');
      if (placeholder) placeholder.style.display = 'none';
    };
    
    pdfViewer.onerror = () => {
      console.error('[Analyse ICs] Both PDF load methods failed');
      if (placeholder) {
        placeholder.style.display = 'block';
        placeholder.innerHTML = '<p>Failed to load PDF. Please check if the file exists and the server is running.</p>';
      }
    };
    
    pdfViewer.src = altUrl;
  };
}

// Expose functions globally
window.removeImage = removeImage;
window.removeAnalysePdf = removeAnalysePdf;

