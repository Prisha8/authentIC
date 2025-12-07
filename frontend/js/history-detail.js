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
    const API_BASE_URL = window.API_BASE_URL || 'http://localhost:5001';
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
    const API_BASE_URL = window.API_BASE_URL || 'http://localhost:5001';
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
    
    const API_BASE_URL = window.API_BASE_URL || 'http://localhost:5001';
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
    } else if (data && !data.error && (data.metadata || data.analysis)) {
      // API returns detail directly
      currentHistoryDetail = data;
      renderHistoryDetail(data);
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

// Use existing API_BASE_URL if available, otherwise declare it
const API_BASE_URL = window.API_BASE_URL || 'http://localhost:5001';
window.API_BASE_URL = API_BASE_URL; // Store for other scripts

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
    case 'dimension':
      return renderDimensionAnalysis(analysis.dimension_analysis, filePaths);
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
  if (!toolData) {
    return '<div class="tab-content-section"><p>No output available for this tool</p></div>';
  }
  
  let html = `<div class="tab-content-section"><h3>${toolTitle}</h3>`;
  
  // Handle different tool types with specific previews
  if (toolName === 'identify' && typeof toolData === 'object') {
    // IC Identification preview
    html += '<div class="tool-preview">';
    if (toolData.part_number) {
      html += `<div class="preview-item"><strong>Part Number:</strong> ${escapeHtml(toolData.part_number)}</div>`;
    }
    if (toolData.manufacturer) {
      html += `<div class="preview-item"><strong>Manufacturer:</strong> ${escapeHtml(toolData.manufacturer)}</div>`;
    }
    if (toolData.package_type) {
      html += `<div class="preview-item"><strong>Package:</strong> ${escapeHtml(toolData.package_type)}</div>`;
    }
    if (toolData.pin_count) {
      html += `<div class="preview-item"><strong>Pin Count:</strong> ${toolData.pin_count}</div>`;
    }
    if (toolData.confidence) {
      html += `<div class="preview-item"><strong>Confidence:</strong> ${toolData.confidence}%</div>`;
    }
    html += '</div>';
    html += '<details class="json-details"><summary>View Full JSON</summary>';
    html += `<pre class="json-display">${JSON.stringify(toolData, null, 2)}</pre>`;
    html += '</details>';
  } else if (toolName === 'scrape' && typeof toolData === 'object') {
    // Datasheet scrape preview
    html += '<div class="tool-preview">';
    if (toolData.datasheet_url) {
      html += `<div class="preview-item"><strong>Datasheet URL:</strong> <a href="${escapeHtml(toolData.datasheet_url)}" target="_blank">${escapeHtml(toolData.datasheet_url)}</a></div>`;
    }
    if (toolData.title) {
      html += `<div class="preview-item"><strong>Title:</strong> ${escapeHtml(toolData.title)}</div>`;
    }
    if (toolData.summary) {
      html += `<div class="preview-item"><strong>Summary:</strong> ${escapeHtml(toolData.summary)}</div>`;
    }
    html += '</div>';
    html += '<details class="json-details"><summary>View Full JSON</summary>';
    html += `<pre class="json-display">${JSON.stringify(toolData, null, 2)}</pre>`;
    html += '</details>';
  } else if (toolName === 'parse' && typeof toolData === 'object') {
    // Datasheet parse preview
    html += '<div class="tool-preview">';
    if (toolData.specifications) {
      html += '<div class="preview-item"><strong>Specifications Found:</strong></div>';
      html += '<ul class="spec-list">';
      for (const [key, value] of Object.entries(toolData.specifications)) {
        html += `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(String(value))}</li>`;
      }
      html += '</ul>';
    }
    html += '</div>';
    html += '<details class="json-details"><summary>View Full JSON</summary>';
    html += `<pre class="json-display">${JSON.stringify(toolData, null, 2)}</pre>`;
    html += '</details>';
  } else {
    // Generic JSON display
    if (typeof toolData === 'object') {
      html += `<pre class="json-display">${JSON.stringify(toolData, null, 2)}</pre>`;
    } else {
      html += `<pre class="json-display">${escapeHtml(String(toolData))}</pre>`;
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
  const vizPath = filePaths.dimension_viz;
  
  return `
    <div class="tab-content-section">
      <h3>Dimension Analysis</h3>
      ${vizPath ? `
        <div class="image-viewer">
          <img src="${API_BASE_URL}/api_results/${vizPath}" alt="Dimension Visualization">
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

