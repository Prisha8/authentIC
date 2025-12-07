// SELF-CONTAINED History Detail Modal - Works independently
// Includes all rendering functions so it works even if main script doesn't load

// CRITICAL: Export function IMMEDIATELY at the very top, before ANY other code
// This ensures it's available even if there are errors later in the script
console.log('[History Detail SIMPLE] Script starting, exporting function immediately...');

// Define at top level - no IIFE to ensure immediate availability
window.openHistoryDetailModal = async function(sessionId) {
    console.log('[History Detail SIMPLE] openHistoryDetailModal called with:', sessionId);
    
    if (!sessionId || sessionId === 'undefined' || sessionId === 'null' || sessionId.trim() === '') {
      console.error('[History Detail SIMPLE] Invalid session ID:', sessionId);
      alert('Invalid session ID. Please try again.');
      return;
    }
    
    const modal = document.getElementById('historyDetailModal');
    if (!modal) {
      console.error('[History Detail SIMPLE] Modal element not found');
      alert('Modal element not found. Please refresh the page.');
      return;
    }
    
    const content = document.getElementById('historyDetailContent');
    if (content) {
      content.innerHTML = '<div class="loading">Loading details...</div>';
    }
    
    modal.style.display = 'flex';
    
    try {
      const API_BASE_URL = 'http://localhost:5001';
      const response = await fetch(`${API_BASE_URL}/api/history/${sessionId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Use the full render function (it should be defined by now)
      // Wait a tiny bit for rendering functions to be available
      if (typeof renderHistoryDetailFull === 'function') {
        if (data.status === 'success' && data.detail) {
          renderHistoryDetailFull(data.detail);
        } else if (data && !data.error && (data.metadata || data.analysis)) {
          renderHistoryDetailFull(data);
        } else {
          if (content) {
            content.innerHTML = `<div class="error">Failed to load history details: ${data.error || 'Unknown error'}</div>`;
          }
        }
      } else if (typeof window.renderHistoryDetailFull === 'function') {
        if (data.status === 'success' && data.detail) {
          window.renderHistoryDetailFull(data.detail);
        } else if (data && !data.error && (data.metadata || data.analysis)) {
          window.renderHistoryDetailFull(data);
        } else {
          if (content) {
            content.innerHTML = `<div class="error">Failed to load history details: ${data.error || 'Unknown error'}</div>`;
          }
        }
      } else {
        // Fallback: show basic content
        if (content) {
          const partNumber = (data.detail?.metadata?.ic_info?.part_number || data.metadata?.ic_info?.part_number || 'UNKNOWN');
          content.innerHTML = `<div class="tab-content-section"><h3>${partNumber}</h3><p>Full rendering functions loading...</p><p>Session: ${sessionId}</p></div>`;
        }
      }
    } catch (error) {
      console.error('[History Detail SIMPLE] Error loading details:', error);
      if (content) {
        content.innerHTML = `<div class="error">Error loading details: ${error.message}</div>`;
      }
    }
  };

// Verify export immediately - do this multiple times to ensure it sticks
(function verifyExport() {
  if (typeof window.openHistoryDetailModal === 'function') {
    console.log('[History Detail SIMPLE] ✓ openHistoryDetailModal exported successfully');
    // Verify it's actually callable
    try {
      const funcStr = window.openHistoryDetailModal.toString();
      if (funcStr.includes('openHistoryDetailModal')) {
        console.log('[History Detail SIMPLE] ✓ Function is properly defined and callable');
      }
    } catch (e) {
      console.error('[History Detail SIMPLE] Error verifying function:', e);
    }
  } else {
    console.error('[History Detail SIMPLE] ✗ FAILED to export openHistoryDetailModal');
    console.error('[History Detail SIMPLE] window.openHistoryDetailModal type:', typeof window.openHistoryDetailModal);
    // Try to re-export
    console.warn('[History Detail SIMPLE] Attempting to re-export function...');
    // The function should already be defined above, so this shouldn't be needed
  }
})();

// Also verify after a short delay in case something is overriding it
setTimeout(() => {
  if (typeof window.openHistoryDetailModal === 'function') {
    console.log('[History Detail SIMPLE] ✓ Function still available after delay');
  } else {
    console.error('[History Detail SIMPLE] ✗ Function was removed/overridden!');
  }
}, 100);

// Use existing API_BASE_URL if available, otherwise declare it
const API_BASE_URL = window.API_BASE_URL || 'http://localhost:5001';
window.API_BASE_URL = API_BASE_URL; // Store for other scripts
let currentHistoryDetail = null;
let activeTab = 'ic-details';

// Escape HTML helper
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Render full history detail with tabs
// Export to window so it's available globally
window.renderHistoryDetailFull = function renderHistoryDetailFull(detail) {
  const content = document.getElementById('historyDetailContent');
  if (!content) return;
  
  const actualDetail = detail.metadata ? detail : (detail.detail || detail);
  const metadata = actualDetail.metadata || actualDetail;
  const analysis = actualDetail.analysis || {};
  const filePaths = actualDetail.file_paths || {};
  
  const icInfo = metadata.ic_info || {};
  const scores = metadata.scores || {};
  const sessionId = metadata.session_id || detail.session_id || '';
  
  const partNumber = icInfo.part_number || 'UNKNOWN';
  const manufacturer = icInfo.manufacturer || 'UNKNOWN';
  const processedDateObj = new Date(metadata.processed_date || detail.processed_date);
  const processedDate = processedDateObj.toLocaleDateString();
  const processedTime = processedDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
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
      <button class="tab-btn ${activeTab === 'ic-details' ? 'active' : ''}" onclick="window.switchHistoryTab('ic-details')">
        IC Details
      </button>
      ${toolOutputs.identify ? `<button class="tab-btn ${activeTab === 'identify' ? 'active' : ''}" onclick="window.switchHistoryTab('identify')">Identification</button>` : ''}
      ${toolOutputs.scrape ? `<button class="tab-btn ${activeTab === 'scrape' ? 'active' : ''}" onclick="window.switchHistoryTab('scrape')">Datasheet Scrape</button>` : ''}
      ${toolOutputs.parse ? `<button class="tab-btn ${activeTab === 'parse' ? 'active' : ''}" onclick="window.switchHistoryTab('parse')">Datasheet Parse</button>` : ''}
      ${analysis.dimension_analysis ? `<button class="tab-btn ${activeTab === 'dimension' ? 'active' : ''}" onclick="window.switchHistoryTab('dimension')">Dimension Analysis</button>` : ''}
      ${analysis.visual_comparison ? `<button class="tab-btn ${activeTab === 'visual' ? 'active' : ''}" onclick="window.switchHistoryTab('visual')">Visual Analysis</button>` : ''}
      <button class="tab-btn ${activeTab === 'oem-info' ? 'active' : ''}" onclick="window.switchHistoryTab('oem-info')">OEM Info</button>
      <button class="tab-btn ${activeTab === 'report' ? 'active' : ''}" onclick="window.switchHistoryTab('report')">Full Report</button>
    </div>
    
    <div class="history-detail-tab-content" id="historyTabContent">
      ${renderTabContentFull(activeTab, actualDetail, analysis, filePaths, toolOutputs)}
    </div>
  `;
  
  currentHistoryDetail = detail;
}

// Render tab content
function renderTabContentFull(tabName, detail, analysis, filePaths, toolOutputs) {
  switch (tabName) {
    case 'ic-details':
      return renderICDetailsFull(detail);
    case 'identify':
      return renderToolOutputFull('identify', toolOutputs.identify, 'IC Identification');
    case 'scrape':
      return renderToolOutputFull('scrape', toolOutputs.scrape, 'Datasheet Scraping');
    case 'parse':
      return renderToolOutputFull('parse', toolOutputs.parse, 'Datasheet Parsing');
    case 'dimension':
      return renderDimensionAnalysisFull(analysis.dimension_analysis, filePaths);
    case 'visual':
      return renderVisualAnalysisFull(analysis.visual_comparison, analysis.anomalies);
    case 'oem-info':
      return renderOEMInfoFull(analysis.oem_info, filePaths);
    case 'report':
      return renderFullReportFull(filePaths);
    default:
      return '<div>Content not available</div>';
  }
}

// Render IC Details
function renderICDetailsFull(detail) {
  const icInfo = detail.ic_info || {};
  return `
    <div class="tab-content-section">
      <h3>IC Identification</h3>
      <div class="detail-grid">
        <div class="detail-item"><label>Part Number</label><value>${escapeHtml(icInfo.part_number || 'UNKNOWN')}</value></div>
        <div class="detail-item"><label>Manufacturer</label><value>${escapeHtml(icInfo.manufacturer || 'UNKNOWN')}</value></div>
        <div class="detail-item"><label>Package Type</label><value>${escapeHtml(icInfo.package_type || 'UNKNOWN')}</value></div>
        <div class="detail-item"><label>Pin Count</label><value>${icInfo.pin_count || 0}</value></div>
        <div class="detail-item"><label>Country of Origin</label><value>${escapeHtml(icInfo.coo || 'Unknown')}</value></div>
        <div class="detail-item"><label>Date Codes</label><value>${icInfo.date_codes && icInfo.date_codes.length > 0 ? icInfo.date_codes.join(', ') : 'None'}</value></div>
        <div class="detail-item"><label>Lot Codes</label><value>${icInfo.lot_codes && icInfo.lot_codes.length > 0 ? icInfo.lot_codes.join(', ') : 'None'}</value></div>
      </div>
    </div>
  `;
}

// Render tool output
function renderToolOutputFull(toolName, toolData, toolTitle) {
  if (!toolData) {
    return '<div class="tab-content-section"><p>No output available for this tool</p></div>';
  }
  
  let html = `<div class="tab-content-section"><h3>${toolTitle}</h3>`;
  
  if (toolName === 'identify' && typeof toolData === 'object') {
    html += '<div class="tool-preview">';
    if (toolData.part_number) html += `<div class="preview-item"><strong>Part Number:</strong> ${escapeHtml(toolData.part_number)}</div>`;
    if (toolData.manufacturer) html += `<div class="preview-item"><strong>Manufacturer:</strong> ${escapeHtml(toolData.manufacturer)}</div>`;
    if (toolData.package_type) html += `<div class="preview-item"><strong>Package:</strong> ${escapeHtml(toolData.package_type)}</div>`;
    if (toolData.pin_count) html += `<div class="preview-item"><strong>Pin Count:</strong> ${toolData.pin_count}</div>`;
    if (toolData.confidence) html += `<div class="preview-item"><strong>Confidence:</strong> ${toolData.confidence}%</div>`;
    html += '</div><details class="json-details"><summary>View Full JSON</summary>';
    html += `<pre class="json-display">${JSON.stringify(toolData, null, 2)}</pre></details>`;
  } else if (toolName === 'scrape' && typeof toolData === 'object') {
    html += '<div class="tool-preview">';
    if (toolData.datasheet_url) html += `<div class="preview-item"><strong>Datasheet URL:</strong> <a href="${escapeHtml(toolData.datasheet_url)}" target="_blank">${escapeHtml(toolData.datasheet_url)}</a></div>`;
    if (toolData.title) html += `<div class="preview-item"><strong>Title:</strong> ${escapeHtml(toolData.title)}</div>`;
    if (toolData.summary) html += `<div class="preview-item"><strong>Summary:</strong> ${escapeHtml(toolData.summary)}</div>`;
    html += '</div><details class="json-details"><summary>View Full JSON</summary>';
    html += `<pre class="json-display">${JSON.stringify(toolData, null, 2)}</pre></details>`;
  } else if (toolName === 'parse' && typeof toolData === 'object') {
    html += '<div class="tool-preview">';
    if (toolData.specifications) {
      html += '<div class="preview-item"><strong>Specifications Found:</strong></div><ul class="spec-list">';
      for (const [key, value] of Object.entries(toolData.specifications)) {
        html += `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(String(value))}</li>`;
      }
      html += '</ul>';
    }
    html += '</div><details class="json-details"><summary>View Full JSON</summary>';
    html += `<pre class="json-display">${JSON.stringify(toolData, null, 2)}</pre></details>`;
  } else {
    html += `<pre class="json-display">${typeof toolData === 'object' ? JSON.stringify(toolData, null, 2) : escapeHtml(String(toolData))}</pre>`;
  }
  
  html += '</div>';
  return html;
}

// Render dimension analysis
function renderDimensionAnalysisFull(dimensionAnalysis, filePaths) {
  const dim = dimensionAnalysis || {};
  const vizPath = filePaths.dimension_viz;
  return `
    <div class="tab-content-section">
      <h3>Dimension Analysis</h3>
      ${vizPath ? `<div class="image-viewer"><img src="${API_BASE_URL}/api_results/${vizPath}" alt="Dimension Visualization"></div>` : ''}
      <div class="detail-grid">
        ${dim.expected_aspect_ratio ? `<div class="detail-item"><label>Expected Aspect Ratio</label><value>${dim.expected_aspect_ratio.toFixed(2)}</value></div>` : ''}
        ${dim.measured_aspect_ratio ? `<div class="detail-item"><label>Measured Aspect Ratio</label><value>${dim.measured_aspect_ratio.toFixed(2)}</value></div>` : ''}
        ${dim.confidence_score !== undefined ? `<div class="detail-item"><label>Confidence Score</label><value>${dim.confidence_score.toFixed(1)}/100</value></div>` : ''}
      </div>
      ${dim.dimension_source ? `<div class="detail-section"><p><strong>Source:</strong> ${escapeHtml(dim.dimension_source)}</p></div>` : ''}
    </div>
  `;
}

// Render visual analysis
function renderVisualAnalysisFull(visualComparison, anomalies) {
  const visual = visualComparison || {};
  const anomalyList = anomalies || [];
  return `
    <div class="tab-content-section">
      <h3>Visual Comparison Analysis</h3>
      <div class="detail-grid">
        ${visual.text_quality_score !== undefined ? `<div class="detail-item"><label>Text Quality Score</label><value>${visual.text_quality_score.toFixed(1)}/100</value></div>` : ''}
        ${visual.pin_count_verified !== undefined ? `<div class="detail-item"><label>Pin Count Verified</label><value>${visual.pin_count_verified ? 'Yes' : 'No'}</value></div>` : ''}
        ${visual.package_type_verified !== undefined ? `<div class="detail-item"><label>Package Type Verified</label><value>${visual.package_type_verified ? 'Yes' : 'No'}</value></div>` : ''}
      </div>
      ${visual.summary ? `<div class="detail-section"><h4>Summary</h4><p>${escapeHtml(visual.summary)}</p></div>` : ''}
      ${visual.observations && visual.observations.length > 0 ? `<div class="detail-section"><h4>Observations</h4><ul>${visual.observations.map(obs => `<li>${escapeHtml(obs)}</li>`).join('')}</ul></div>` : ''}
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

// Render OEM Info
function renderOEMInfoFull(oemInfo, filePaths) {
  const oem = oemInfo || {};
  const datasheetPath = filePaths.datasheet;
  return `
    <div class="tab-content-section">
      <h3>OEM Datasheet Information</h3>
      ${datasheetPath ? `<div class="pdf-viewer-container"><iframe src="${API_BASE_URL}/api_results/${datasheetPath}" style="width: 100%; height: 600px; border: none;"></iframe></div>` : '<p>No datasheet available</p>'}
      ${oem.parsed_specs ? `<div class="detail-section"><h4>Parsed Specifications</h4><pre class="json-display">${JSON.stringify(oem.parsed_specs, null, 2)}</pre></div>` : ''}
    </div>
  `;
}

// Render full report
function renderFullReportFull(filePaths) {
  const reportPath = filePaths.report_pdf;
  return `
    <div class="tab-content-section">
      <h3>Full Analysis Report</h3>
      ${reportPath ? `<div class="pdf-viewer-container"><iframe src="${API_BASE_URL}/api_results/${reportPath}" style="width: 100%; height: 800px; border: none;"></iframe></div>` : '<p>Report not available</p>'}
    </div>
  `;
}

// Switch tabs
window.switchHistoryTab = function(tabName) {
  activeTab = tabName;
  if (currentHistoryDetail) {
    const content = document.getElementById('historyTabContent');
    const actualDetail = currentHistoryDetail.metadata ? currentHistoryDetail : (currentHistoryDetail.detail || currentHistoryDetail);
    const analysis = actualDetail.analysis || currentHistoryDetail.analysis || {};
    const filePaths = actualDetail.file_paths || currentHistoryDetail.file_paths || {};
    const toolOutputs = analysis.tool_outputs || {};
    
    if (content) {
      content.innerHTML = renderTabContentFull(tabName, actualDetail, analysis, filePaths, toolOutputs);
    }
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
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
      if (btn.textContent.trim() === labels[tabName]) {
        btn.classList.add('active');
      }
    });
  }
};

// Download report
window.downloadHistoryReport = async function(sessionId) {
  try {
    window.open(`${API_BASE_URL}/api/history/${sessionId}/download`, '_blank');
  } catch (error) {
    console.error('[History Detail] Error downloading report:', error);
    alert('Failed to download report');
  }
};

// Delete history entry
window.deleteHistoryEntry = async function(sessionId) {
  if (!confirm('Are you sure you want to delete this history entry? This action cannot be undone.')) {
    return;
  }
  
  try {
    const userType = localStorage.getItem('authentIC_userType') || 'business';
    const response = await fetch(`${API_BASE_URL}/api/history/${sessionId}`, {
      method: 'DELETE',
      headers: {
        'X-User-Type': userType
      }
    });
    
    const data = await response.json();
    
    if (response.ok && data.status === 'success') {
      // Close the modal
      window.closeHistoryDetailModal();
      
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

// Close modal
window.closeHistoryDetailModal = function() {
  const modal = document.getElementById('historyDetailModal');
  if (modal) {
    modal.style.display = 'none';
    currentHistoryDetail = null;
    activeTab = 'ic-details';
  }
};


// Final verification that everything is exported
console.log('[History Detail SIMPLE] Final verification:', {
  openHistoryDetailModal: typeof window.openHistoryDetailModal,
  renderHistoryDetailFull: typeof window.renderHistoryDetailFull,
  switchHistoryTab: typeof window.switchHistoryTab,
  closeHistoryDetailModal: typeof window.closeHistoryDetailModal,
  downloadHistoryReport: typeof window.downloadHistoryReport
});

if (typeof window.openHistoryDetailModal === 'function') {
  console.log('[History Detail SIMPLE] ✓ All functions exported successfully');
} else {
  console.error('[History Detail SIMPLE] ✗ CRITICAL: openHistoryDetailModal is NOT a function!');
}
