// history-detail.js - Detail modal functionality with tabs

// CRITICAL: Export function IMMEDIATELY at the very top, before ANY other code
// This ensures it's available even if there are errors later in the script
// ALWAYS override the simple version with the full version
console.log('[History Detail] Main script loading, will override simple version...');

// Export delete function early to ensure it's available (override simple version)
window.deleteHistoryEntry = async function(sessionId) {
  console.log('[History Detail] deleteHistoryEntry called with sessionId:', sessionId);
  
  if (!sessionId || sessionId === 'undefined' || sessionId === 'null' || sessionId.trim() === '') {
    console.error('[History Detail] Invalid session ID for deletion:', sessionId);
    alert('Invalid session ID. Cannot delete.');
    return;
  }
  
  if (!confirm('Are you sure you want to delete this history entry? This action cannot be undone.')) {
    return;
  }
  
  try {
    const API_BASE_URL = window.API_BASE_URL || '';
    const userType = localStorage.getItem('authentIC_userType') || 'business';
    const url = `${API_BASE_URL}/api/history/${encodeURIComponent(sessionId)}`;
    
    console.log('[History Detail] Deleting history entry:', url);
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'X-User-Type': userType
      }
    });
    
    const data = await response.json();
    console.log('[History Detail] Delete response:', data);
    
    if (response.ok && data.status === 'success') {
      // Close the modal
      if (typeof window.closeHistoryDetailModal === 'function') {
        window.closeHistoryDetailModal();
      }
      
      // Refresh the history list
      if (typeof window.handleHistorySortFilter === 'function') {
        await window.handleHistorySortFilter();
      } else if (typeof window.loadHistory === 'function') {
        await window.loadHistory();
      }
      
      // Show success message
      alert('History entry deleted successfully');
    } else {
      throw new Error(data.error || 'Failed to delete history entry');
    }
  } catch (error) {
    console.error('[History Detail] Error deleting history:', error);
    alert('Failed to delete history entry: ' + error.message);
  }
};

// Export download function early to ensure it's available (override simple version)
window.downloadHistoryReport = async function(sessionId) {
  try {
    const API_BASE_URL = window.API_BASE_URL || '';
    if (!sessionId || sessionId === 'undefined' || sessionId === 'null' || sessionId.trim() === '') {
      console.error('[History Detail] Invalid session ID for download:', sessionId);
      alert('Invalid session ID. Cannot download.');
      return;
    }
    console.log('[History Detail] Downloading report for session:', sessionId);
    const url = `${API_BASE_URL}/api/history/${encodeURIComponent(sessionId)}/download`;
    window.open(url, '_blank');
  } catch (error) {
    console.error('[History Detail] Error downloading report:', error);
    alert('Failed to download report: ' + error.message);
  }
};

// Define function at top level to ensure immediate availability
window.openHistoryDetailModal = async function(sessionId) {
  console.log('[History Detail] openHistoryDetailModal called with:', sessionId);
  
  // Validate sessionId
  if (!sessionId || sessionId === 'undefined' || sessionId === 'null' || sessionId.trim() === '') {
    console.error('[History Detail] Invalid session ID:', sessionId);
    alert('Invalid session ID. Please try again.');
    return;
  }
  
  const modal = document.getElementById('historyDetailModal');
  if (!modal) {
    console.error('[History Detail] Modal element not found');
    return;
  }
  
  // Show loading state
  const content = document.getElementById('historyDetailContent');
  if (content) {
    content.innerHTML = '<div class="loading">Loading details...</div>';
  }
  
  modal.style.display = 'flex';
  
  try {
    console.log('[History Detail] Loading details for session:', sessionId);
    
    const API_BASE_URL = window.API_BASE_URL || '';
    const response = await fetch(`${API_BASE_URL}/api/history/${sessionId}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('[History Detail] API response:', data);
    
    if (data.status === 'success' && data.detail) {
      // API returns {status: 'success', detail: {...}}
      currentHistoryDetail = data.detail;
      renderHistoryDetail(data.detail);
      // Update the history card in sidebar with correct data
      console.log('[History Detail] Calling updateHistoryCard with sessionId:', sessionId);
      if (typeof window.updateHistoryCard === 'function') {
        // Call immediately
        window.updateHistoryCard(sessionId, data.detail);
        // Also retry after a short delay in case DOM isn't ready
        setTimeout(() => {
          console.log('[History Detail] Retrying updateHistoryCard after delay');
          window.updateHistoryCard(sessionId, data.detail);
        }, 100);
      } else {
        console.error('[History Detail] updateHistoryCard function not available!');
      }
    } else if (data && !data.error && (data.metadata || data.analysis)) {
      // API returns detail directly
      currentHistoryDetail = data;
      renderHistoryDetail(data);
      // Update the history card in sidebar with correct data
      console.log('[History Detail] Calling updateHistoryCard with sessionId:', sessionId);
      if (typeof window.updateHistoryCard === 'function') {
        window.updateHistoryCard(sessionId, data);
        // Also retry after a short delay in case DOM isn't ready
        setTimeout(() => {
          console.log('[History Detail] Retrying updateHistoryCard after delay');
          window.updateHistoryCard(sessionId, data);
        }, 100);
      } else {
        console.error('[History Detail] updateHistoryCard function not available!');
      }
    } else {
      console.error('[History Detail] Failed to load:', data);
      if (content) {
        content.innerHTML = `<div class="error">Failed to load history details: ${data.error || 'Unknown error'}</div>`;
      }
    }
  } catch (error) {
    console.error('[History Detail] Error loading details:', error);
    if (content) {
      content.innerHTML = `<div class="error">Error loading details: ${error.message}</div>`;
    }
  }
};

// Verify export immediately
console.log('[History Detail] Function definition complete, verifying...');
if (typeof window.openHistoryDetailModal === 'function') {
  const funcStr = window.openHistoryDetailModal.toString();
  if (funcStr.includes('[History Detail SIMPLE]')) {
    console.error('[History Detail] ✗ FAILED: Simple version still active!');
  } else {
    console.log('[History Detail] ✓ openHistoryDetailModal exported successfully (FULL VERSION)');
  }
} else {
  console.error('[History Detail] ✗ Failed to export openHistoryDetailModal');
}

// Use existing API_BASE_URL if available, otherwise set it
if (!window.API_BASE_URL) {
  window.API_BASE_URL = '';
}
// Use var instead of const to allow redeclaration when both history-detail files are loaded
var API_BASE_URL = window.API_BASE_URL;

let currentHistoryDetail = null;
let activeTab = 'ic-details';

/**
 * Close history detail modal
 */
window.closeHistoryDetailModal = function() {
  const modal = document.getElementById('historyDetailModal');
  if (modal) {
    modal.style.display = 'none';
    currentHistoryDetail = null;
    activeTab = 'ic-details';
  }
};

/**
 * Render history detail with tabs
 */
function renderHistoryDetail(detail) {
  const content = document.getElementById('historyDetailContent');
  if (!content) return;
  
  // Handle both direct detail and wrapped response
  const actualDetail = detail.metadata ? detail : (detail.detail || detail);
  const metadata = actualDetail.metadata || actualDetail;
  const analysis = actualDetail.analysis || {};
  const filePaths = actualDetail.file_paths || {};
  const progress = actualDetail.progress || {};
  
  const icInfo = metadata.ic_info || {};
  const scores = metadata.scores || {};
  const sessionId = metadata.session_id || detail.session_id || '';
  
  const partNumber = icInfo.part_number || 'UNKNOWN';
  const manufacturer = icInfo.manufacturer || 'UNKNOWN';
  const processedDateObj = new Date(metadata.processed_date || detail.processed_date);
  const processedDate = processedDateObj.toLocaleDateString();
  const processedTime = processedDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  // Get tool outputs from analysis/tool_outputs
  const toolOutputs = analysis.tool_outputs || {};
  
  content.innerHTML = `
    <div class="history-detail-header">
      <div class="history-detail-title">
        <h2>${escapeHtml(partNumber)}</h2>
        <p class="history-detail-subtitle">${escapeHtml(manufacturer)} • ${processedDate} ${processedTime}</p>
      </div>
      <div class="history-detail-actions">
        <button class="btn-download" onclick="window.downloadHistoryReport('${sessionId}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Download PDF
        </button>
        <button class="btn-delete" onclick="window.deleteHistoryEntry('${sessionId}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
          Delete
        </button>
      </div>
    </div>
    
    <div class="history-detail-tabs">
      <button class="tab-btn ${activeTab === 'ic-details' ? 'active' : ''}" onclick="switchHistoryTab('ic-details')">
        IC Details
      </button>
      <button class="tab-btn ${activeTab === 'identify' ? 'active' : ''}" onclick="switchHistoryTab('identify')" ${toolOutputs.identify ? '' : 'style="display:none"'}>
        Identification
      </button>
      <button class="tab-btn ${activeTab === 'scrape' ? 'active' : ''}" onclick="switchHistoryTab('scrape')" ${toolOutputs.scrape ? '' : 'style="display:none"'}>
        Datasheet Scrape
      </button>
      <button class="tab-btn ${activeTab === 'parse' ? 'active' : ''}" onclick="switchHistoryTab('parse')" ${toolOutputs.parse ? '' : 'style="display:none"'}>
        Datasheet Parse
      </button>
      <button class="tab-btn ${activeTab === 'pin_counter' ? 'active' : ''}" onclick="switchHistoryTab('pin_counter')" ${analysis.pin_counter ? '' : 'style=\"display:none\"'}>
        Pin Counter
      </button>
      <button class="tab-btn ${activeTab === 'dimension' ? 'active' : ''}" onclick="switchHistoryTab('dimension')" ${analysis.dimension_analysis ? '' : 'style="display:none"'}>
        Dimension Analysis
      </button>
      <button class="tab-btn ${activeTab === 'visual' ? 'active' : ''}" onclick="switchHistoryTab('visual')" ${analysis.visual_comparison ? '' : 'style="display:none"'}>
        Visual Analysis
      </button>
      <button class="tab-btn ${activeTab === 'oem-info' ? 'active' : ''}" onclick="switchHistoryTab('oem-info')">
        OEM Info
      </button>
      <button class="tab-btn ${activeTab === 'report' ? 'active' : ''}" onclick="switchHistoryTab('report')">
        Full Report
      </button>
    </div>
    
    <div class="history-detail-tab-content" id="historyTabContent">
      ${renderTabContent(activeTab, actualDetail, analysis, filePaths, toolOutputs)}
    </div>
  `;
  
  // Export to window so simple function can use it
  if (!window.renderHistoryDetail) {
    window.renderHistoryDetail = renderHistoryDetail;
  }
}

/**
 * Switch between tabs
 */
window.switchHistoryTab = function(tabName) {
  activeTab = tabName;
  if (currentHistoryDetail) {
    const content = document.getElementById('historyTabContent');
    const actualDetail = currentHistoryDetail.metadata ? currentHistoryDetail : (currentHistoryDetail.detail || currentHistoryDetail);
    const analysis = actualDetail.analysis || currentHistoryDetail.analysis || {};
    const filePaths = actualDetail.file_paths || currentHistoryDetail.file_paths || {};
    const toolOutputs = analysis.tool_outputs || {};
    
    if (content) {
      content.innerHTML = renderTabContent(tabName, actualDetail, analysis, filePaths, toolOutputs);
    }
    
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.textContent.trim() === getTabLabel(tabName)) {
        btn.classList.add('active');
      }
    });
  }
};

function getTabLabel(tabName) {
  const labels = {
    'ic-details': 'IC Details',
    'identify': 'Identification',
    'scrape': 'Datasheet Scrape',
    'parse': 'Datasheet Parse',
    'pin_counter': 'Pin Counter',
    'histogram': 'Histogram Filters',
    'dimension': 'Dimension Analysis',
    'visual': 'Visual Analysis',
    'oem-info': 'OEM Info',
    'report': 'Full Report'
  };
  return labels[tabName] || tabName;
}

/**
 * Render tab content
 */
function renderTabContent(tabName, detail, analysis, filePaths, toolOutputs) {
  switch (tabName) {
    case 'ic-details':
      return renderICDetails(detail, analysis.ic_details);
    case 'identify':
      return renderToolOutput('identify', toolOutputs.identify, 'IC Identification');
    case 'scrape':
      return renderToolOutput('scrape', toolOutputs.scrape, 'Datasheet Scraping');
    case 'parse':
      return renderToolOutput('parse', toolOutputs.parse, 'Datasheet Parsing');
    case 'pin_counter':
      return renderToolOutput('pin_counter', analysis.pin_counter, 'Pin Counter');
    case 'dimension':
      return renderDimensionAnalysis(analysis.dimension_analysis, filePaths);
    case 'histogram':
      return renderHistogramAnalysis(analysis.histogram_analysis, filePaths, analysis.visual_comparison);
    case 'visual':
      return renderVisualAnalysis(analysis.visual_comparison, analysis.anomalies);
    case 'oem-info':
      return renderOEMInfo(analysis.oem_info, filePaths);
    case 'report':
      return renderFullReport(filePaths);
    default:
      return '<div>Content not available</div>';
  }
}

/**
 * Render tool output with proper previews
 */
function renderToolOutput(toolName, toolData, toolTitle) {
  const resolvedData = (toolData && typeof toolData === 'object' && 'data' in toolData)
    ? (toolData.data || {})
    : toolData;

  if (!resolvedData) {
    return '<div class="tab-content-section"><p>No output available for this tool</p></div>';
  }
  
  let html = `<div class="tab-content-section"><h3>${toolTitle}</h3>`;
  
  // Handle different tool types with specific previews
  if (toolName === 'identify' && typeof resolvedData === 'object') {
    // IC Identification preview
    html += '<div class="tool-preview">';
    if (resolvedData.part_number) {
      html += `<div class="preview-item"><strong>Part Number:</strong> ${escapeHtml(resolvedData.part_number)}</div>`;
    }
    if (resolvedData.manufacturer) {
      html += `<div class="preview-item"><strong>Manufacturer:</strong> ${escapeHtml(resolvedData.manufacturer)}</div>`;
    }
    if (resolvedData.package_type) {
      html += `<div class="preview-item"><strong>Package:</strong> ${escapeHtml(resolvedData.package_type)}</div>`;
    }
    if (resolvedData.pin_count) {
      html += `<div class="preview-item"><strong>Pin Count:</strong> ${resolvedData.pin_count}</div>`;
    }
    if (resolvedData.confidence) {
      html += `<div class="preview-item"><strong>Confidence:</strong> ${resolvedData.confidence}%</div>`;
    }
    html += '</div>';
    html += '<details class="json-details"><summary>View Full JSON</summary>';
    html += `<pre class="json-display">${JSON.stringify(resolvedData, null, 2)}</pre>`;
    html += '</details>';
  } else if (toolName === 'scrape' && typeof resolvedData === 'object') {
    // Datasheet scrape preview
    html += '<div class="tool-preview">';
    if (resolvedData.datasheet_url) {
      html += `<div class="preview-item"><strong>Datasheet URL:</strong> <a href="${escapeHtml(resolvedData.datasheet_url)}" target="_blank">${escapeHtml(resolvedData.datasheet_url)}</a></div>`;
    }
    if (resolvedData.title) {
      html += `<div class="preview-item"><strong>Title:</strong> ${escapeHtml(resolvedData.title)}</div>`;
    }
    if (resolvedData.summary) {
      html += `<div class="preview-item"><strong>Summary:</strong> ${escapeHtml(resolvedData.summary)}</div>`;
    }
    html += '</div>';
    html += '<details class="json-details"><summary>View Full JSON</summary>';
    html += `<pre class="json-display">${JSON.stringify(resolvedData, null, 2)}</pre>`;
    html += '</details>';
  } else if (toolName === 'parse' && typeof resolvedData === 'object') {
    // Datasheet parse preview
    html += '<div class="tool-preview">';
    if (resolvedData.specifications) {
      html += '<div class="preview-item"><strong>Specifications Found:</strong></div>';
      html += '<ul class="spec-list">';
      for (const [key, value] of Object.entries(resolvedData.specifications)) {
        html += `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(String(value))}</li>`;
      }
      html += '</ul>';
    }
    html += '</div>';
    html += '<details class="json-details"><summary>View Full JSON</summary>';
    html += `<pre class="json-display">${JSON.stringify(resolvedData, null, 2)}</pre>`;
    html += '</details>';
  } else if (toolName === 'pin_counter' && typeof resolvedData === 'object') {
    const userType = localStorage.getItem('authentIC_userType') || 'business';
    const renderImage = (label, path) => {
      if (!path) return '';
      const cleanPath = path.replace(/^.*api_results[\/\\]/, '').replace(/^[\/\\]/, '');
      const url = path.startsWith('http')
        ? path
        : `/api/download?file=${encodeURIComponent(cleanPath)}&user_type=${userType}`;
      return `
        <div class="preview-item">
          <strong>${label}:</strong><br>
          <img src="${url}" alt="${label}" style="max-width:100%;height:auto;border:1px solid var(--border);border-radius:6px;margin-top:8px;">
        </div>
      `;
    };
    html += '<div class="tool-preview">';
    html += `<div class="preview-item"><strong>Pins Detected (conf > 0.5):</strong> ${resolvedData.pins_detected ?? 'N/A'}</div>`;
    html += `<div class="preview-item"><strong>Notches Detected (conf > 0.5):</strong> ${resolvedData.notches_detected ?? 'N/A'}</div>`;
    html += renderImage('Pin Counter Visualization', resolvedData.visualization || resolvedData.overlay_path);
    html += '</div>';
    html += '<details class="json-details"><summary>View Full JSON</summary>';
    html += `<pre class="json-display">${JSON.stringify(resolvedData, null, 2)}</pre>`;
    html += '</details>';
  } else {
    // Generic JSON display
    if (typeof resolvedData === 'object') {
      html += `<pre class="json-display">${JSON.stringify(resolvedData, null, 2)}</pre>`;
    } else {
      html += `<pre class="json-display">${escapeHtml(String(resolvedData))}</pre>`;
    }
  }
  
  html += '</div>';
  return html;
}

/**
 * Render IC Details tab
 */
function renderICDetails(detail, icDetails) {
  const icInfo = detail.ic_info || {};
  const icData = icDetails || {};
  
  return `
    <div class="tab-content-section">
      <h3>IC Identification</h3>
      <div class="detail-grid">
        <div class="detail-item">
          <label>Part Number</label>
          <value>${escapeHtml(icInfo.part_number || icData.part_number || 'UNKNOWN')}</value>
        </div>
        <div class="detail-item">
          <label>Manufacturer</label>
          <value>${escapeHtml(icInfo.manufacturer || icData.manufacturer || 'UNKNOWN')}</value>
        </div>
        <div class="detail-item">
          <label>Package Type</label>
          <value>${escapeHtml(icInfo.package_type || icData.package_type || 'UNKNOWN')}</value>
        </div>
        <div class="detail-item">
          <label>Pin Count</label>
          <value>${icInfo.pin_count || icData.pin_count || 0}</value>
        </div>
        <div class="detail-item">
          <label>Country of Origin</label>
          <value>${escapeHtml(icInfo.coo || 'Unknown')}</value>
        </div>
        <div class="detail-item">
          <label>Date Codes</label>
          <value>${icInfo.date_codes && icInfo.date_codes.length > 0 ? icInfo.date_codes.join(', ') : 'None'}</value>
        </div>
        <div class="detail-item">
          <label>Lot Codes</label>
          <value>${icInfo.lot_codes && icInfo.lot_codes.length > 0 ? icInfo.lot_codes.join(', ') : 'None'}</value>
        </div>
      </div>
      ${detail.additional_info ? `
        <div class="detail-section">
          <h4>Additional Information</h4>
          <p>${escapeHtml(detail.additional_info)}</p>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Render OEM Info tab
 */
function renderOEMInfo(oemInfo, filePaths) {
  const oem = oemInfo || {};
  const datasheetPath = filePaths.datasheet;
  
  return `
    <div class="tab-content-section">
      <h3>OEM Datasheet Information</h3>
      ${datasheetPath ? `
        <div class="pdf-viewer-container">
          <iframe src="${API_BASE_URL}/api_results/${datasheetPath}" style="width: 100%; height: 600px; border: none;"></iframe>
        </div>
      ` : '<p>No datasheet available</p>'}
      ${oem.parsed_specs ? `
        <div class="detail-section">
          <h4>Parsed Specifications</h4>
          <pre class="json-display">${JSON.stringify(oem.parsed_specs, null, 2)}</pre>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Render Dimension Analysis tab
 */
function renderDimensionAnalysis(dimensionAnalysis, filePaths) {
  const dim = dimensionAnalysis || {};
  const vizPath = dim.dimension_visualization || filePaths.dimension_viz;
  
  return `
    <div class="tab-content-section">
      <h3>Dimension Analysis</h3>
      ${vizPath ? `
        <div class="image-viewer">
          <img src="${vizPath.startsWith('http') ? vizPath : `${API_BASE_URL}/api_results/${vizPath}`}" alt="SAM 2.1 Visualization">
        </div>
      ` : ''}
      <div class="detail-grid">
        ${dim.expected_aspect_ratio ? `
          <div class="detail-item">
            <label>Expected Aspect Ratio</label>
            <value>${dim.expected_aspect_ratio.toFixed(2)}</value>
          </div>
        ` : ''}
        ${dim.measured_aspect_ratio ? `
          <div class="detail-item">
            <label>Measured Aspect Ratio</label>
            <value>${dim.measured_aspect_ratio.toFixed(2)}</value>
          </div>
        ` : ''}
        ${dim.mask_coverage !== undefined && dim.mask_coverage !== null ? `
          <div class="detail-item">
            <label>Mask Coverage</label>
            <value>${(dim.mask_coverage * 100).toFixed(1)}%</value>
          </div>
        ` : ''}
        ${dim.mask_area_px ? `
          <div class="detail-item">
            <label>Mask Area (px)</label>
            <value>${dim.mask_area_px}</value>
          </div>
        ` : ''}
        ${dim.confidence_score !== undefined ? `
          <div class="detail-item">
            <label>Confidence Score</label>
            <value>${dim.confidence_score.toFixed(1)}/100</value>
          </div>
        ` : ''}
      </div>
      ${dim.dimension_source ? `
        <div class="detail-section">
          <p><strong>Source:</strong> ${escapeHtml(dim.dimension_source)}</p>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Render Histogram Filter Analysis tab
 */
function renderHistogramAnalysis(histogramAnalysis, filePaths, visualComparison = null) {
  if (!histogramAnalysis) {
    return '<div class="tab-content-section"><p>No histogram analysis available</p></div>';
  }
  
  const userType = localStorage.getItem('authentIC_userType') || 'business';
  const strips = histogramAnalysis.strip_paths || [];
  const dashboardPath = histogramAnalysis.dashboard_path || filePaths.histogram_dashboard;
  
  const renderImage = (path, label) => {
    if (!path) return '';
    const cleanPath = path.replace(/^.*api_results[\/\\]/, '').replace(/^[\/\\]/, '');
    const url = path.startsWith('http')
      ? path
      : `/api/download?file=${encodeURIComponent(cleanPath)}&user_type=${userType}`;
    return `
      <div class="histogram-strip-item">
        <h4>${escapeHtml(label)}</h4>
        <img src="${url}" alt="${label}" style="max-width:100%;height:auto;border:1px solid var(--border);border-radius:6px;margin-top:8px;cursor:pointer;" onclick="window.open('${url}', '_blank')">
      </div>
    `;
  };
  
  let html = `
    <div class="tab-content-section">
      <h3>Histogram Filter Analysis</h3>
      <p>11 image processing filters applied to enhance defect detection. Each strip shows: original, before filter, after filter, and histogram.</p>
      
      ${dashboardPath ? `
        <div class="histogram-dashboard-section" style="margin-bottom: 30px;">
          <h4>Complete Dashboard (All Filters)</h4>
          <p style="color: var(--muted); font-size: 0.9em;">This dashboard shows all 11 filters in a single view for analysis.</p>
          ${renderImage(dashboardPath, 'Histogram Filter Dashboard')}
        </div>
      ` : ''}
      
      <div class="histogram-strips-section">
        <h4>Individual Filter Strips (For QA Review)</h4>
        <p style="color: var(--muted); font-size: 0.9em;">Click any strip to view full size. Use CLAHE for surface texture, Edge Map for cracks, Threshold for contamination.</p>
        <div class="histogram-strips-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; margin-top: 20px;">
  `;
  
  // Filter descriptions and what they detect
  const filterInfo = {
    '01_resize': { name: 'Resize', detects: 'Image preprocessing', verdict: 'N/A' },
    '02_grayscale': { name: 'Grayscale', detects: 'Color normalization', verdict: 'N/A' },
    '03_gamma': { name: 'Gamma Correction', detects: 'Dark epoxy regions', verdict: 'N/A' },
    '04_hist_equalization': { name: 'Histogram Equalization', detects: 'Global contrast enhancement', verdict: 'N/A' },
    '05_clahe': { name: 'CLAHE', detects: 'Surface texture defects', verdict: 'N/A' },
    '06_gaussian_blur': { name: 'Gaussian Blur', detects: 'Noise smoothing for edge detection', verdict: 'N/A' },
    '07_edge_map': { name: 'Edge Map', detects: 'Cracks and package boundaries', verdict: 'N/A' },
    '08_color_jitter': { name: 'Color Jitter', detects: 'Illumination variations', verdict: 'N/A' },
    '09_gaussian_noise': { name: 'Gaussian Noise', detects: 'Model robustness testing', verdict: 'N/A' },
    '10_otsu_threshold': { name: 'Otsu Threshold', detects: 'Contamination and foreground defects', verdict: 'N/A' },
    '11_normalize_tensor': { name: 'Normalize Tensor', detects: 'Model-ready preprocessing', verdict: 'N/A' }
  };
  
  // Load analysis JSON to get statistics and determine verdicts
  let analysisData = null;
  if (histogramAnalysis.analysis_json_path) {
    try {
      // Try to fetch analysis JSON
      const jsonPath = histogramAnalysis.analysis_json_path;
      const cleanPath = jsonPath.replace(/^.*api_results[\/\\]/, '').replace(/^[\/\\]/, '');
      const jsonUrl = jsonPath.startsWith('http')
        ? jsonPath
        : `/api/download?file=${encodeURIComponent(cleanPath)}&user_type=${userType}`;
      
      // For now, we'll determine verdicts based on filter type and statistics if available
      // This will be enhanced when we can fetch the JSON
    } catch (e) {
      console.warn('Could not load histogram analysis JSON:', e);
    }
  }
  
  // Function to determine verdict - prefer AI analysis verdicts, fallback to calculated
  const getVerdict = (stepName, stats, aiVerdicts = null) => {
    // First, try to use AI analysis verdict if available
    if (aiVerdicts && aiVerdicts[stepName]) {
      return aiVerdicts[stepName];
    }
    
    // Fallback to calculated verdict based on statistics
    if (!stats) return 'N/A';
    
    switch(stepName) {
      case '05_clahe': // CLAHE - check entropy and contrast
        const entropy = stats.entropy || 0;
        const contrast = stats.contrast || 0;
        return (entropy > 4.0 && contrast > 150) ? 'Yes' : 'No';
      
      case '07_edge_map': // Edge Map - check skewness (edge concentration)
        const skewness = Math.abs(stats.skewness || 0);
        return skewness > 5.0 ? 'Yes' : 'No';
      
      case '10_otsu_threshold': // Otsu - check contrast and dynamic range
        const otsuContrast = stats.contrast || 0;
        const dynamicRange = stats.dynamic_range || 0;
        return (otsuContrast > 200 && dynamicRange > 0.5) ? 'Yes' : 'No';
      
      case '06_gaussian_blur': // Blur - should have lower entropy (smoothing)
        const blurEntropy = stats.entropy || 0;
        return blurEntropy < 6.0 ? 'Yes' : 'No';
      
      default:
        return 'N/A';
    }
  };
  
  // Get AI analysis histogram filter verdicts if available
  const aiVerdicts = visualComparison?.histogram_filter_verdicts || null;
  const aiReasoning = visualComparison?.histogram_filter_reasoning || null;
  
  strips.forEach((stripPath, idx) => {
    const stepName = stripPath.split('/').pop().replace('_strip.png', '');
    const info = filterInfo[stepName] || { 
      name: stepName.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
      detects: 'Image processing filter',
      verdict: 'N/A'
    };
    
    // Use AI analysis verdict if available, otherwise use default
    const initialVerdict = aiVerdicts && aiVerdicts[stepName] ? aiVerdicts[stepName] : info.verdict;
    let oneLiner = `${info.name}: ${info.detects} - Verdict: ${initialVerdict}`;
    // Add AI analysis reasoning if available
    if (aiReasoning && aiReasoning[stepName]) {
      oneLiner += ` (${aiReasoning[stepName]})`;
    }
    
    html += renderImage(stripPath, oneLiner);
  });
  
  html += `
        </div>
      </div>
      
      ${histogramAnalysis.analysis_json_path ? `
        <details class="json-details" style="margin-top: 30px;">
          <summary>View Histogram Statistics JSON</summary>
          <pre class="json-display" id="histogramStatsJson">Loading...</pre>
        </details>
      ` : ''}
    </div>
  `;
  
  // Load JSON stats if available and update verdicts
  if (histogramAnalysis.analysis_json_path) {
    const jsonPath = histogramAnalysis.analysis_json_path;
    const cleanPath = jsonPath.replace(/^.*api_results[\/\\]/, '').replace(/^[\/\\]/, '');
    const jsonUrl = `/api/download?file=${encodeURIComponent(cleanPath)}&user_type=${userType}`;
    
    fetch(jsonUrl)
      .then(res => res.json())
      .then(data => {
        // Update JSON display
        const jsonEl = document.getElementById('histogramStatsJson');
        if (jsonEl) {
          jsonEl.textContent = JSON.stringify(data, null, 2);
        }
        
        // Update verdicts in displayed strips
        const stripItems = document.querySelectorAll('.histogram-strip-item');
        stripItems.forEach(item => {
          const img = item.querySelector('img');
          if (img && img.src) {
            const stepName = img.src.split('/').pop().replace('_strip.png', '');
            const info = filterInfo[stepName];
            if (info && data.filters && data.filters[stepName]) {
              const stats = data.filters[stepName].statistics;
              const verdict = getVerdict(stepName, stats, aiVerdicts);
              let oneLiner = `${info.name}: ${info.detects} - Verdict: ${verdict}`;
              // Add AI analysis reasoning if available
              if (aiReasoning && aiReasoning[stepName]) {
                oneLiner += ` (${aiReasoning[stepName]})`;
              }
              const h4 = item.querySelector('h4');
              if (h4) h4.textContent = oneLiner;
              if (img) img.alt = oneLiner;
            }
          }
        });
      })
      .catch(err => {
        const jsonEl = document.getElementById('histogramStatsJson');
        if (jsonEl) {
          jsonEl.textContent = `Error loading JSON: ${err.message}`;
        }
      });
  }
  
  return html;
}

/**
 * Render Visual Analysis tab
 */
function renderVisualAnalysis(visualComparison, anomalies) {
  const visual = visualComparison || {};
  const anomalyList = anomalies || [];
  
  return `
    <div class="tab-content-section">
      <h3>Visual Comparison Analysis</h3>
      <div class="detail-grid">
        ${visual.text_quality_score !== undefined ? `
          <div class="detail-item">
            <label>Text Quality Score</label>
            <value>${visual.text_quality_score.toFixed(1)}/100</value>
          </div>
        ` : ''}
        ${visual.pin_count_verified !== undefined ? `
          <div class="detail-item">
            <label>Pin Count Verified</label>
            <value>${visual.pin_count_verified ? 'Yes' : 'No'}</value>
          </div>
        ` : ''}
        ${visual.package_type_verified !== undefined ? `
          <div class="detail-item">
            <label>Package Type Verified</label>
            <value>${visual.package_type_verified ? 'Yes' : 'No'}</value>
          </div>
        ` : ''}
      </div>
      ${visual.summary ? `
        <div class="detail-section">
          <h4>Summary</h4>
          <p>${escapeHtml(visual.summary)}</p>
        </div>
      ` : ''}
      ${visual.observations && visual.observations.length > 0 ? `
        <div class="detail-section">
          <h4>Observations</h4>
          <ul>
            ${visual.observations.map(obs => `<li>${escapeHtml(obs)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
      ${anomalyList.length > 0 ? `
        <div class="detail-section">
          <h4>Anomalies Detected (${anomalyList.length})</h4>
          <div class="anomalies-list">
            ${anomalyList.map((anom, idx) => `
              <div class="anomaly-item severity-${anom.severity || 'medium'}">
                <div class="anomaly-header">
                  <span class="anomaly-number">#${idx + 1}</span>
                  <span class="anomaly-type">${escapeHtml(anom.type || 'Unknown')}</span>
                  <span class="anomaly-severity">${escapeHtml(anom.severity || 'medium')}</span>
                </div>
                <p class="anomaly-description">${escapeHtml(anom.description || 'No description')}</p>
              </div>
            `).join('')}
          </div>
        </div>
      ` : '<p>No anomalies detected</p>'}
    </div>
  `;
}

/**
 * Render Full Report tab
 */
function renderFullReport(filePaths) {
  const reportPath = filePaths.report_pdf;
  
  return `
    <div class="tab-content-section">
      <h3>Full Analysis Report</h3>
      ${reportPath ? `
        <div class="pdf-viewer-container">
          <iframe src="${API_BASE_URL}/api_results/${reportPath}" style="width: 100%; height: 800px; border: none;"></iframe>
        </div>
      ` : '<p>Report not available</p>'}
    </div>
  `;
}

// Download function is now defined at the top of the file for early availability

// Delete function is now defined at the top of the file for early availability

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Log that functions are available
console.log('[History Detail] Script loaded, functions available:', {
  openHistoryDetailModal: typeof window.openHistoryDetailModal,
  closeHistoryDetailModal: typeof window.closeHistoryDetailModal,
  switchHistoryTab: typeof window.switchHistoryTab,
  downloadHistoryReport: typeof window.downloadHistoryReport,
  deleteHistoryEntry: typeof window.deleteHistoryEntry
});

// Verify the function is actually available and is the FULL version (not simple)
if (typeof window.openHistoryDetailModal !== 'function') {
  console.error('[History Detail] ERROR: openHistoryDetailModal is not a function!', typeof window.openHistoryDetailModal);
} else {
  const funcStr = window.openHistoryDetailModal.toString();
  if (funcStr.includes('[History Detail SIMPLE]')) {
    console.error('[History Detail] WARNING: Simple version is still active! Main script did not override it.');
    console.error('[History Detail] This means the main script failed to load or execute properly.');
  } else {
    console.log('[History Detail] ✓ openHistoryDetailModal is available and ready (FULL VERSION)');
  }
}

