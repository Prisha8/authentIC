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
  }
}

// Load final results and display PDF
async function loadFinalResults(sessionId) {
  try {
    const response = await fetch(`http://localhost:5001/api/session/${sessionId}`);
    const data = await response.json();
    
    if (data.status === 'completed' && data.results && data.results.length > 0) {
      const result = data.results[0];
      
      // Load PDF if available
      if (result.datasheet_path) {
        await loadPdfViewer(result.datasheet_path);
      } else if (uploadedPdf) {
        // If user uploaded a PDF, show it
        const reader = new FileReader();
        reader.onload = (e) => {
          const pdfViewer = document.getElementById('pdfViewer');
          const placeholder = document.querySelector('.pdf-viewer-placeholder');
          if (pdfViewer) {
            pdfViewer.src = e.target.result;
            pdfViewer.style.display = 'block';
          }
          if (placeholder) placeholder.style.display = 'none';
        };
        reader.readAsDataURL(uploadedPdf);
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
  
  if (!pdfViewer) return;
  
  // Convert path to URL
  let pdfUrl = pdfPath;
  if (!pdfPath.startsWith('http')) {
    // If it's a relative path, construct full URL
    const userType = localStorage.getItem('authentIC_userType') || 'business';
    pdfUrl = `http://localhost:5001/api/download?file=${encodeURIComponent(pdfPath)}&user_type=${userType}`;
  }
  
  pdfViewer.src = pdfUrl;
  pdfViewer.style.display = 'block';
  if (placeholder) placeholder.style.display = 'none';
}

// Expose functions globally
window.removeImage = removeImage;
window.removeAnalysePdf = removeAnalysePdf;

