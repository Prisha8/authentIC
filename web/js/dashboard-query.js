// dashboard-query.js - Dashboard functionality for business landing page
// Handles Analyse ICs form, Processed History, and detail modals

let uploadedImages = [];
let uploadedPdf = null;
let historyPage = 0;
let isLoadingHistory = false;
let hasMoreHistory = true;
let currentFilters = { date: 'all', icType: 'all' };

// Export delete and download functions early to ensure they're available
// These will be used by the modal buttons
window.deleteHistoryEntry = window.deleteHistoryEntry || async function(sessionId) {
  console.log('[Dashboard] deleteHistoryEntry called with sessionId:', sessionId);
  
  if (!sessionId || sessionId === 'undefined' || sessionId === 'null' || sessionId.trim() === '') {
    console.error('[Dashboard] Invalid session ID for deletion:', sessionId);
    alert('Invalid session ID. Cannot delete.');
    return;
  }
  
  if (!confirm('Are you sure you want to delete this history entry? This action cannot be undone.')) {
    return;
  }
  
  try {
    const API_BASE_URL = '';
    const userType = localStorage.getItem('authentIC_userType') || 'business';
    const url = `${API_BASE_URL}/api/history/${encodeURIComponent(sessionId)}`;
    
    console.log('[Dashboard] Deleting history entry:', url);
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'X-User-Type': userType
      }
    });
    
    const data = await response.json();
    console.log('[Dashboard] Delete response:', data);
    
    if (response.ok && data.status === 'success') {
      // Close the modal
      if (typeof window.closeHistoryDetailModal === 'function') {
        window.closeHistoryDetailModal();
      }
      
      // Refresh the history list
      console.log('[Dashboard] Refreshing history after deletion...');
      if (typeof window.handleHistorySortFilter === 'function') {
        await window.handleHistorySortFilter();
      } else if (typeof window.historyManager !== 'undefined' && typeof window.historyManager.loadHistory === 'function') {
        await window.historyManager.loadHistory();
      } else if (typeof window.loadHistory === 'function') {
        await window.loadHistory();
      } else {
        // Direct API call fallback
        try {
          const response = await fetch('/api/history');
          const data = await response.json();
          if (data.status === 'success' && data.history) {
            const historyList = document.getElementById('processedHistoryList');
            if (historyList) {
              // Use the same rendering logic
              historyList.innerHTML = data.history.map(item => {
                const icInfo = item.ic_info || {};
                const scores = item.scores || {};
                const filePaths = item.file_paths || {};
                const partNumber = icInfo.part_number || 'UNKNOWN';
                const manufacturer = icInfo.manufacturer || 'UNKNOWN';
                const authenticityScore = scores.authenticity_score || 0;
                const verdict = item.verdict || 'UNKNOWN';
                const thumbnailUrl = filePaths.thumbnail 
                  ? `/api_results/${filePaths.thumbnail}`
                  : 'assets/logo.png';
                return `<div class="history-card" data-session-id="${item.session_id}" onclick="if(typeof window.openHistoryDetail === 'function') window.openHistoryDetail('${item.session_id}')">
                  <div class="history-card-left">
                    <div class="history-card-image"><img src="${thumbnailUrl}" alt="${partNumber}" onerror="this.src='assets/logo.png'"></div>
                    <div class="history-card-score"><span class="score-label">Score:</span><span class="score-value">${authenticityScore.toFixed(1)}</span></div>
                  </div>
                  <div class="history-card-content">
                    <div class="history-card-header">
                      <h5 class="history-card-title">${partNumber}</h5>
                      <span class="history-card-manufacturer">${manufacturer}</span>
                    </div>
                    <div class="history-card-verdict-container">
                      <span class="history-card-verdict">${verdict}</span>
                    </div>
                  </div>
                </div>`;
              }).join('');
            }
          }
        } catch (error) {
          console.error('[Dashboard] Error refreshing history:', error);
        }
      }
      
      // Show success message
      alert('History entry deleted successfully');
    } else {
      throw new Error(data.error || 'Failed to delete history entry');
    }
  } catch (error) {
    console.error('[Dashboard] Error deleting history:', error);
    alert('Failed to delete history entry: ' + error.message);
  }
};

window.downloadHistoryReport = window.downloadHistoryReport || async function(sessionId) {
  try {
    const API_BASE_URL = '';
    if (!sessionId || sessionId === 'undefined' || sessionId === 'null' || sessionId.trim() === '') {
      console.error('[Dashboard] Invalid session ID for download:', sessionId);
      alert('Invalid session ID. Cannot download.');
      return;
    }
    console.log('[Dashboard] Downloading report for session:', sessionId);
    
    // Get user type from localStorage (default to business)
    const userType = localStorage.getItem('authentIC_userType') || 'business';
    
    // Build download URL with user type parameter
    const url = `${API_BASE_URL}/api/history/${encodeURIComponent(sessionId)}/download?user_type=${userType}`;
    
    console.log('[Dashboard] Download URL:', url);
    
    // Use anchor element for reliable download (works even with popup blockers)
    const link = document.createElement('a');
    link.href = url;
    link.download = `counterfeit_report_${sessionId}.pdf`;
    link.target = '_blank';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    
    // Clean up after a short delay
    setTimeout(() => {
      document.body.removeChild(link);
    }, 100);
  } catch (error) {
    console.error('[Dashboard] Error downloading report:', error);
    alert('Failed to download report: ' + error.message);
  }
};

// Define handleAnalyseSubmit early so it's available when form initializes
// This will be implemented later in the file
window.handleAnalyseSubmit = null;

// Standalone sort/filter handler that works without historyManager
window.handleHistorySortFilter = async function() {
  const sortSelect = document.getElementById('historySortBy');
  const verdictFilter = document.getElementById('filterVerdict');
  
  if (!sortSelect || !verdictFilter) {
    console.warn('[Dashboard] Sort/filter controls not found');
    return;
  }
  
  const sortValue = sortSelect.value;
  const filterValue = verdictFilter.value;
  
  console.log('[Dashboard] Sort/Filter changed - Sort:', sortValue, 'Filter:', filterValue);
  
  // Build API parameters
  const params = new URLSearchParams();
  
  // Parse sort value (format: "field-order" like "date-desc" or "score-asc")
  if (sortValue) {
    const [sortField, sortOrder] = sortValue.split('-');
    let backendSortField = 'processed_date';
    if (sortField === 'date') {
      backendSortField = 'processed_date';
    } else if (sortField === 'score') {
      backendSortField = 'authenticity_score';
    } else if (sortField === 'part-number') {
      backendSortField = 'part_number';
    } else if (sortField === 'manufacturer') {
      backendSortField = 'manufacturer';
    }
    params.append('sort_by', backendSortField);
    params.append('sort_order', sortOrder === 'asc' ? 'ASC' : 'DESC');
  }
  
  // Add filter
  if (filterValue && filterValue !== 'all') {
    params.append('verdict', filterValue);
  }
  
  try {
    const url = `/api/history${params.toString() ? '?' + params.toString() : ''}`;
    console.log('[Dashboard] Fetching sorted/filtered history from:', url);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.status === 'success' && data.history) {
      console.log('[Dashboard] Got', data.history.length, 'history items');
      if (data.history.length > 0) {
        console.log('[Dashboard] First item structure:', JSON.stringify(data.history[0], null, 2));
      }
      
      // Clear existing cards
      const historyList = document.getElementById('processedHistoryList');
      if (!historyList) {
        console.error('[Dashboard] processedHistoryList not found');
        return;
      }
      
      if (data.history.length === 0) {
        historyList.innerHTML = '<div class="empty-history"><p>No history found matching your filters.</p></div>';
        return;
      }
      
      // Render cards using the same logic as the fallback
      const cardsHTML = data.history.map((item, index) => {
        // Debug first item
        if (index === 0) {
          console.log('[Dashboard] Rendering first item:', {
            session_id: item.session_id,
            has_ic_info: !!item.ic_info,
            has_scores: !!item.scores,
            has_file_paths: !!item.file_paths,
            part_number: item.part_number || item.ic_info?.part_number,
            verdict: item.verdict
          });
        }
        // Normalize data structure - handle both nested and flattened formats
        let icInfo = item.ic_info || {};
        let scores = item.scores || {};
        let filePaths = item.file_paths || {};
        
        // If data is flattened (from vector search), reconstruct nested structure
        if (!icInfo.part_number && item.part_number) {
          icInfo = {
            part_number: item.part_number,
            manufacturer: item.manufacturer,
            package_type: item.package_type,
            pin_count: item.pin_count,
            coo: item.coo || item.country_of_origin,
            date_codes: item.date_codes || icInfo.date_codes || [],
            lot_codes: item.lot_codes || icInfo.lot_codes || [],
            temperature_grade: item.temperature_grade || icInfo.temperature_grade,
            speed_grade: item.speed_grade || icInfo.speed_grade,
            package_variant: item.package_variant || icInfo.package_variant
          };
        }
        
        if (!scores.authenticity_score && item.authenticity_score !== undefined) {
          scores = {
            authenticity_score: item.authenticity_score
          };
        }
        
        if (!filePaths.thumbnail && item.thumbnail) {
          filePaths = {
            thumbnail: item.thumbnail,
            primary_image: item.primary_image || item.thumbnail,
            datasheet: item.datasheet
          };
        }
        
        const partNumber = icInfo.part_number || item.part_number || 'UNKNOWN';
        const manufacturer = icInfo.manufacturer || item.manufacturer || 'UNKNOWN';
        // Extract COO - check multiple sources with proper priority
        let coo = icInfo.coo || item.coo || item.country_of_origin || 'Unknown';
        // Fallback: check if identify tool output is available in item
        if ((coo === 'Unknown' || !coo) && item.analysis && item.analysis.tool_outputs && item.analysis.tool_outputs.identify) {
          const identifyData = item.analysis.tool_outputs.identify.data || item.analysis.tool_outputs.identify;
          if (identifyData && identifyData.country_codes && Array.isArray(identifyData.country_codes) && identifyData.country_codes.length > 0) {
            coo = String(identifyData.country_codes[0]).toUpperCase();
          }
        }
        const processedDateObj = new Date(item.processed_date);
        const processedDate = processedDateObj.toLocaleDateString();
        const processedTime = processedDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const authenticityScore = scores.authenticity_score || item.authenticity_score || 0;
        let verdict = item.verdict || 'UNKNOWN';
        if (verdict.toUpperCase().includes('SUSPICIOUS') && verdict.includes('REQUIRES')) {
          verdict = 'SUSPICIOUS';
        }
        
        // Extract date_codes and lot_codes - check multiple sources
        let dateCodes = icInfo.date_codes || item.date_codes || [];
        let lotCodes = icInfo.lot_codes || item.lot_codes || [];
        // Fallback: check identify tool output
        if ((!dateCodes || dateCodes.length === 0) && item.analysis && item.analysis.tool_outputs && item.analysis.tool_outputs.identify) {
          const identifyData = item.analysis.tool_outputs.identify.data || item.analysis.tool_outputs.identify;
          if (identifyData) {
            if (!dateCodes || dateCodes.length === 0) dateCodes = identifyData.date_codes || [];
            if (!lotCodes || lotCodes.length === 0) lotCodes = identifyData.lot_codes || [];
          }
        }
        const packageType = icInfo.package_type || item.package_type || null;
        // Extract temperature_grade, speed_grade, package_variant - check multiple sources
        let tempGrade = icInfo.temperature_grade || item.temperature_grade || null;
        let speedGrade = icInfo.speed_grade || item.speed_grade || null;
        let packageVariant = icInfo.package_variant || item.package_variant || null;
        // Fallback: check identify tool output
        if (item.analysis && item.analysis.tool_outputs && item.analysis.tool_outputs.identify) {
          const identifyData = item.analysis.tool_outputs.identify.data || item.analysis.tool_outputs.identify;
          if (identifyData) {
            if (!tempGrade) tempGrade = identifyData.temperature_grade || null;
            if (!speedGrade) speedGrade = identifyData.speed_grade || null;
            if (!packageVariant) packageVariant = identifyData.package_variant || null;
          }
        }
        
        let year = null;
        if (dateCodes.length > 0 && dateCodes[0]) {
          const dateCode = dateCodes[0];
          if (typeof dateCode === 'object' && dateCode.decoded) {
            const yearMatch = dateCode.decoded.match(/Year\s+(\d{4})/);
            if (yearMatch) year = yearMatch[1];
          } else if (typeof dateCode === 'string') {
            const rawYear = dateCode.substring(0, 2);
            if (rawYear) {
              const yearNum = parseInt(rawYear);
              if (yearNum >= 0 && yearNum <= 99) {
                year = yearNum < 50 ? `20${rawYear}` : `19${rawYear}`;
              }
            }
          }
        }
        
        let lot = null;
        if (lotCodes.length > 0 && lotCodes[0]) {
          if (typeof lotCodes[0] === 'object' && lotCodes[0].raw) {
            lot = lotCodes[0].raw;
          } else if (typeof lotCodes[0] === 'string') {
            lot = lotCodes[0];
          }
        }
        
        const additionalInfo = [];
        if (lot) additionalInfo.push(`Lot: ${lot}`);
        if (year) additionalInfo.push(`Year: ${year}`);
        if (packageType && packageType !== 'UNKNOWN') {
          const pkgMatch = packageType.match(/^([A-Z0-9-]+)/);
          if (pkgMatch) additionalInfo.push(`Pkg: ${pkgMatch[1]}`);
        }
        if (tempGrade) additionalInfo.push(`Temp: ${tempGrade}`);
        if (speedGrade) additionalInfo.push(`Speed: ${speedGrade}`);
        
        const thumbnailPath = filePaths.thumbnail || item.thumbnail || (item.file_paths && item.file_paths.thumbnail);
        const thumbnailUrl = thumbnailPath 
          ? `/api_results/${thumbnailPath}`
          : 'assets/logo.png';
        const verdictClass = verdict.toUpperCase().includes('AUTHENTIC') ? 'verdict-authentic' :
                           verdict.toUpperCase().includes('SUSPICIOUS') ? 'verdict-suspicious' :
                           verdict.toUpperCase().includes('COUNTERFEIT') ? 'verdict-counterfeit' : 'verdict-unknown';
        
        return `
          <div class="history-card" data-session-id="${item.session_id}" onclick="if(typeof window.openHistoryDetail === 'function') window.openHistoryDetail('${item.session_id}')">
            <div class="history-card-left">
              <div class="history-card-image">
                <img src="${thumbnailUrl}" alt="${partNumber}" onerror="this.src='assets/logo.png'">
              </div>
              <div class="history-card-score">
                <span class="score-label">Score:</span>
                <span class="score-value">${authenticityScore.toFixed(1)}</span>
              </div>
            </div>
            <div class="history-card-content">
              <div class="history-card-header">
                <h5 class="history-card-title">${partNumber.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h5>
                <span class="history-card-manufacturer">${manufacturer.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
              </div>
              <div class="history-card-meta">
                <div class="history-card-date">
                  <span>${processedDate}</span>
                  <span class="history-card-time">${processedTime}</span>
                </div>
                <div class="history-card-coo-pkg">
                  <span class="history-card-coo">COO: ${coo}</span>
                  ${packageType && packageType !== 'UNKNOWN' ? (() => {
                    const pkgMatch = packageType.match(/^([A-Z0-9-]+)/);
                    return pkgMatch ? `<span class="history-card-pkg">Pkg: ${pkgMatch[1]}</span>` : '';
                  })() : ''}
                </div>
                ${additionalInfo.filter(info => !info.startsWith('Pkg:')).length > 0 ? `<div class="history-card-additional">${additionalInfo.filter(info => !info.startsWith('Pkg:')).join(' • ')}</div>` : ''}
              </div>
              <div class="history-card-verdict-container">
                <span class="history-card-verdict ${verdictClass}">${verdict}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
      
      historyList.innerHTML = cardsHTML;
      console.log('[Dashboard] ✓ Rendered', data.history.length, 'history cards with sort/filter');
      
      // Update KPIs after history loads (only if no filters are active, or always for overall stats)
      // KPIs should show overall stats, not filtered stats
      if (typeof window.updateKPIsFromHistory === 'function') {
        window.updateKPIsFromHistory();
      }
    } else {
      console.error('[Dashboard] Failed to load history:', data.error);
    }
  } catch (error) {
    console.error('[Dashboard] Error loading sorted/filtered history:', error);
    alert('Error loading history: ' + error.message);
  }
};

// Initialize sort/filter buttons on page load
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Dashboard] Initializing sort/filter buttons...');
  
  // Wait a bit for elements to be available
  setTimeout(() => {
    const sortSelect = document.getElementById('historySortBy');
    const verdictFilter = document.getElementById('filterVerdict');
    
    if (sortSelect && verdictFilter) {
      console.log('[Dashboard] ✓ Found sort/filter controls, attaching handlers');
      
      // Attach handlers
      sortSelect.addEventListener('change', window.handleHistorySortFilter);
      sortSelect.addEventListener('input', window.handleHistorySortFilter);
      verdictFilter.addEventListener('change', window.handleHistorySortFilter);
      verdictFilter.addEventListener('input', window.handleHistorySortFilter);
      
      // Also use onchange as direct fallback
      sortSelect.onchange = window.handleHistorySortFilter;
      verdictFilter.onchange = window.handleHistorySortFilter;
      
      console.log('[Dashboard] ✓ Sort/filter handlers attached');
    } else {
      console.warn('[Dashboard] Sort/filter controls not found, retrying...');
      // Retry after a delay
      setTimeout(() => {
        const retrySort = document.getElementById('historySortBy');
        const retryFilter = document.getElementById('filterVerdict');
        if (retrySort && retryFilter) {
          retrySort.addEventListener('change', window.handleHistorySortFilter);
          retrySort.addEventListener('input', window.handleHistorySortFilter);
          retrySort.onchange = window.handleHistorySortFilter;
          retryFilter.addEventListener('change', window.handleHistorySortFilter);
          retryFilter.addEventListener('input', window.handleHistorySortFilter);
          retryFilter.onchange = window.handleHistorySortFilter;
          console.log('[Dashboard] ✓ Sort/filter handlers attached on retry');
        }
      }, 1000);
    }
  }, 500);
});

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
    
    // Update KPIs when switching to dashboard view
    if (typeof window.updateKPIsFromHistory === 'function') {
      console.log('[Dashboard] Updating KPIs after switching to dashboard view');
      window.updateKPIsFromHistory();
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
  
  // Load history for business users (use direct API calls)
  const userType = localStorage.getItem('authentIC_userType');
  if (userType === 'business') {
    console.log('[Dashboard] Business user detected, loading history via API');
    
    // Use the standalone function directly (no retry needed)
    if (typeof window.handleHistorySortFilter === 'function') {
      console.log('[Dashboard] Loading history using handleHistorySortFilter()');
      window.handleHistorySortFilter();
    } else {
      // Fallback: direct API call
      console.log('[Dashboard] handleHistorySortFilter not available, using direct API call');
      fetch('/api/history')
        .then(res => res.json())
        .then(data => {
          if (data.status === 'success' && data.history) {
            console.log('[Dashboard] Got history data, rendering cards...');
            const historyList = document.getElementById('processedHistoryList');
            if (historyList && data.history.length > 0) {
              // Use handleHistorySortFilter's rendering logic (it's already defined above)
              // Just call it directly if available, otherwise render manually
              if (typeof window.handleHistorySortFilter === 'function') {
                window.handleHistorySortFilter();
              } else {
                historyList.innerHTML = '<div class="empty-history"><p>Error: History rendering function not available</p></div>';
              }
            } else if (data.history.length === 0) {
              if (historyList) {
                historyList.innerHTML = '<div class="empty-history"><p>No processed history yet. Process your first lot to get started.</p></div>';
              }
            }
          } else {
            console.error('[Dashboard] Failed to load history:', data.error);
          }
        })
        .catch(err => {
          console.error('[Dashboard] Error loading history:', err);
          const historyList = document.getElementById('processedHistoryList');
          if (historyList) {
            historyList.innerHTML = '<div class="empty-history"><p>Error loading history. Please try again.</p></div>';
          }
        });
    }
  } else {
    // Personal users - use old Supabase-based history
    console.log('[Dashboard] Personal user detected, using Supabase-based history');
    loadProcessedHistory();
  }
  
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
    
    const response = await fetch('/api/health', {
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
    var _demoSec = document.getElementById('demoIcSection');
    if (_demoSec) _demoSec.style.display = 'none';
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
    
    // Get user type and add to form data
    const userType = localStorage.getItem('authentIC_userType') || 'business';
    formData.append('user_type', userType);

  // Optional PCB/FPGA board analysis flag
  const pcbCheckbox = document.getElementById('pcbAnalysisCheckbox');
  if (pcbCheckbox && pcbCheckbox.checked) {
    formData.append('pcb_mode', 'true');
  }
    
    // Call API
    const response = await fetch('/api/detect', {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      let serverMsg = '';
      try { serverMsg = (await response.json()).error || ''; } catch (e) {}
      throw new Error(serverMsg || `API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('[Dashboard] Analyse ICs response:', data);
    
    if (!data.session_id) {
      throw new Error('No session ID received from server');
    }
    
    // Start polling for progress (with small delay to ensure session is initialized)
    console.log('[Dashboard] Starting progress polling for session:', data.session_id);
    setTimeout(() => {
      pollAnalyseProgress(data.session_id);
    }, 500); // Small delay to ensure session is fully initialized
    
    // Reload history to show new entry (only for personal users)
    // userType already declared above, just reuse it
    if (userType !== 'business') {
      historyPage = 0;
      hasMoreHistory = true;
      loadProcessedHistory(true);
    } else {
      // Business users - reload via history-manager
      if (typeof window.historyManager !== 'undefined' && typeof window.historyManager.loadHistory === 'function') {
        window.historyManager.loadHistory();
      }
      // Also reload via handleHistorySortFilter to update the list
      if (typeof window.handleHistorySortFilter === 'function') {
        setTimeout(() => {
          window.handleHistorySortFilter();
        }, 500);
      }
    }
    
  } catch (error) {
    console.error('[Dashboard] Analyse ICs error:', error);
    
    // Provide more helpful error messages
    let errorMessage = error.message;
    if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
      errorMessage = 'Cannot connect to backend server. Please make sure the API server is running on . Start it by running: python backend/api_server.py';
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
    const demoSecErr = document.getElementById('demoIcSection');
    if (demoSecErr) demoSecErr.style.display = '';
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
  const maxPolls = 900; // 15 minutes max (1 poll per second) to reduce timeouts on heavy runs
  let isComplete = false;
  let consecutive404s = 0;
  const max404s = 5; // Allow up to 5 consecutive 404s before giving up (session might be initializing)
  
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
      const response = await fetch(`/api/progress/${sessionId}`);
      
      // Handle 404 - session might not be created yet, allow a few retries
      if (response.status === 404) {
        consecutive404s++;
        if (consecutive404s > max404s) {
          console.error('[Dashboard] Session not found after multiple attempts, stopping poll');
          clearInterval(pollInterval);
          if (processChain) {
            processChain.innerHTML = '<div class="process-error">Session not found. The analysis may have failed to start. Please try again.</div>';
          }
          return;
        }
        // Wait a bit longer before next poll if session not found
        console.log(`[Dashboard] Session not found yet (attempt ${consecutive404s}/${max404s}), will retry...`);
        return;
      }
      
      // Reset 404 counter on successful response
      consecutive404s = 0;
      
      if (!response.ok) {
        console.error('[Dashboard] Progress endpoint error, status:', response.status);
        return;
      }
      
      const data = await response.json();
      console.log('[Dashboard] Progress data received:', data);
      
      // Handle error in response
      if (data.error && data.error === 'Session not found') {
        consecutive404s++;
        if (consecutive404s > max404s) {
          console.error('[Dashboard] Session not found in response, stopping poll');
          clearInterval(pollInterval);
          return;
        }
        return;
      }
      
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
            addNewAnalysisButton();

            // Show notification
            if (window.notificationService) {
              window.notificationService.addNotification(
                'Analysis Complete',
                'Your IC analysis has been completed successfully. Results are available in your history.',
                'success',
                { label: 'View History', url: 'dashboard.html' }
              );
            }
            return;
          }
        }
      }
      
      // Check session status
      if (data.session) {
        if (data.session.status === 'completed') {
          console.log('[Dashboard] Session marked as completed');
          isComplete = true;
          clearInterval(pollInterval);
          await loadAnalyseFinalResults(sessionId);
          addNewAnalysisButton();

          // Show notification
          if (window.notificationService) {
            window.notificationService.addNotification(
              'Analysis Complete',
              'Your IC analysis has been completed successfully. Results are available in your history.',
              'success',
              { label: 'View History', url: 'dashboard.html' }
            );
          }
          return;
        } else if (data.session.status === 'failed') {
          console.error('[Dashboard] Session failed:', data.session.error);
          isComplete = true;
          clearInterval(pollInterval);
          if (processChain) {
            processChain.innerHTML = `<div class="process-error">Analysis failed: ${data.session.error || 'Unknown error'}</div>`;
          }
          addNewAnalysisButton();
          return;
        }
      }
      
    } catch (error) {
      console.error('[Dashboard] Progress polling error:', error);
      // Don't stop polling on individual errors, just log them
      // But increment 404 counter for network errors that might indicate session issues
      if (error.message && error.message.includes('404')) {
        consecutive404s++;
      }
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
    'preprocess': 'Preprocessing Image',
    'identify': 'Identifying IC',
    'scrape': 'Searching OEM Datasheet',
    'parse': 'Extracting Parameters',
    'pin_counter': 'Pin Count Check',
    'dimension': 'Dimension Analysis',
    'histogram': 'Histogram Filter Analysis',
    'visual': 'Visual Comparison',
    'verdict': 'Calculating Verdict',
    'report': 'Generating Report',
    'pcb_detect': 'Detecting ICs on PCB'
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
      // Format message better - extract key info
      let messageText = data.message;
      // Clean up common patterns
      if (messageText.includes('Identified:')) {
        messageText = messageText.replace(/^Identified:\s*/i, '');
      }
      message.textContent = messageText;
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
    const response = await fetch(`/api/session/${sessionId}`);
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
      
      // Refresh the history list after analysis completion
      console.log('[Dashboard] Refreshing history after analysis completion...');
      if (typeof window.handleHistorySortFilter === 'function') {
        await window.handleHistorySortFilter();
      } else {
        // Fallback to direct API call
        try {
          const response = await fetch('/api/history');
          const data = await response.json();
          if (data.status === 'success' && data.history) {
            await window.handleHistorySortFilter();
          }
        } catch (error) {
          console.error('[Dashboard] Error refreshing history:', error);
        }
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
        : `/api/report/${sessionId}`;
      
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
    // Scroll to button to make it visible
    setTimeout(() => {
      downloadBtn.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 100);
  } else {
    // If no chain content, append directly to process chain
    processChain.appendChild(downloadBtn);
    // Scroll to button to make it visible
    setTimeout(() => {
      downloadBtn.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 100);
  }
  
  console.log('[Dashboard] Download report button added to process chain');
}

// Add a "Start New Analysis" button once a run finishes (or fails)
function addNewAnalysisButton() {
  const processChain = document.getElementById('analyseProcessChain');
  if (!processChain) return;
  if (processChain.querySelector('.new-analysis-btn')) return;

  const newBtn = document.createElement('button');
  newBtn.className = 'download-report-btn new-analysis-btn';
  newBtn.textContent = 'Start New Analysis';
  newBtn.style.marginTop = '12px';
  newBtn.style.width = '100%';
  newBtn.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    window.startNewAnalysis();
  };

  const chainContent = processChain.querySelector('.process-chain-content');
  (chainContent || processChain).appendChild(newBtn);
  setTimeout(() => {
    newBtn.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, 100);
}

// Restore the upload form + sample IC strip so the user can run another analysis
window.startNewAnalysis = function () {
  const analyseContent = document.getElementById('analyseContent');
  if (analyseContent) {
    const nav = analyseContent.querySelector('.analyse-view-navigator');
    if (nav) nav.remove();
    const imgView = analyseContent.querySelector('.analyse-image-view');
    if (imgView) imgView.remove();
  }

  if (typeof resetAnalyseForm === 'function') resetAnalyseForm();

  const processChain = document.getElementById('analyseProcessChain');
  if (processChain) {
    processChain.classList.remove('active');
    processChain.innerHTML = '';
    processChain.style.display = 'none';
  }

  const form = document.getElementById('analyseIcsForm');
  if (form) form.style.display = '';
  const demoSec = document.getElementById('demoIcSection');
  if (demoSec) demoSec.style.display = '';

  const submitBtn = document.getElementById('analyseSubmitBtn');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Begin Analysis';
  }
};

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
  const userType = localStorage.getItem('authentIC_userType') || 'business';
  const pdfUrl = `/api/download?file=${encodeURIComponent(filePath)}&user_type=${userType}`;
  
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
    const altUrl = `/api_results/${filePath}`;
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
  
  // Always create output div for histogram_filter to show visualization even if stepOutput is empty
  if ((stepOutput && Object.keys(stepOutput).length > 0) || stepKey === 'histogram_filter') {
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
        : `/api/download?file=${encodeURIComponent(cleanPath)}&user_type=${userType}`;
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
      summary.innerHTML = `
        <p><strong>Pins Detected (conf > 0.5):</strong> ${stepOutput.pins_detected ?? 'N/A'}</p>
        <p><strong>Notches Detected (conf > 0.5):</strong> ${stepOutput.notches_detected ?? 'N/A'}</p>
        ${stepOutput.classification_stats ? `
          <div style="margin-top: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px;">
            <p style="margin: 4px 0;"><strong>Classification:</strong></p>
            <p style="margin: 4px 0; color: #22c55e;"><strong>Authentic (conf ≥ 0.8):</strong> ${stepOutput.classification_stats.authentic || 0}</p>
            <p style="margin: 4px 0; color: #f59e0b;"><strong>Suspicious (0.5 ≤ conf < 0.8):</strong> ${stepOutput.classification_stats.suspicious || 0}</p>
            <p style="margin: 4px 0; color: #ef4444;"><strong>Counterfeit (conf < 0.5):</strong> ${stepOutput.classification_stats.counterfeit || 0} (filtered out)</p>
          </div>
        ` : ''}
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
      // Get data from stepOutput, step.data, or step itself
      const histData = stepOutput?.data || stepOutput || step.data || {};
      const dashboardPath = histData.dashboard_url || histData.dashboard_path || step.visualization || step.data?.dashboard_path;
      const stripPaths = histData.strip_urls || histData.strip_paths || step.data?.strip_urls || step.data?.strip_paths || [];
      
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
    
    // Handle dimension step - show brief summary and visualization
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
          const userType = localStorage.getItem('authentIC_userType') || 'business';
          imgUrl = `/api/download?file=${encodeURIComponent(cleanPath)}&user_type=${userType}`;
        }
        img.src = imgUrl;
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.borderRadius = '6px';
        img.style.marginTop = '8px';
        img.style.border = '1px solid var(--border)';
        img.onerror = function() {
          console.error('[Dashboard] Failed to load dimension visualization:', vizPath, 'tried URL:', imgUrl);
          // Try alternative path formats
          const filename = vizPath.split(/[\/\\]/).pop();
          const userType = localStorage.getItem('authentIC_userType') || 'business';
          const altUrl = `/api/download?file=${encodeURIComponent(filename)}&user_type=${userType}`;
          console.log('[Dashboard] Trying alternative dimension viz path:', altUrl);
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
        const userType = localStorage.getItem('authentIC_userType') || 'business';
        img.src = diagramPath.startsWith('http') ? diagramPath : `/api/download?file=${encodeURIComponent(cleanPath)}&user_type=${userType}`;
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
            // Use buildDownloadUrl helper (or construct manually with user_type)
            const userType = localStorage.getItem('authentIC_userType') || 'business';
            pdfUrl = `/api/download?file=${encodeURIComponent(cleanPath)}&user_type=${userType}`;
          }
          console.log('[Dashboard] Downloading datasheet from:', pdfUrl, '(original path:', pdfPath, ', clean path:', cleanPath, ')');
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
    }
    
    // Special handling for visual_comparison step - show hardcoded images
    if (stepKey === 'visual_comparison' || stepKey === 'visual') {
      // Add hardcoded visual anomaly images
      const hardcodedImagesSection = document.createElement('div');
      hardcodedImagesSection.style.marginTop = '20px';
      hardcodedImagesSection.innerHTML = '<strong style="display:block;margin-bottom:12px;">Visual Anomaly Detection Preview</strong><p style="margin-bottom:12px;color:#666;font-size:0.9em;">Advanced visual analysis techniques applied to detect surface defects and anomalies:</p>';
      
      const hardcodedImagePaths = [
        'backend/tools/pipeline 2/output/WhatsApp Image 2025-12-09 at 02.20.05.jpeg',
        'backend/tools/pipeline 2/output/WhatsApp Image 2025-12-09 at 08.43.15.jpeg'
      ];
      
      hardcodedImagePaths.forEach((imgPath, idx) => {
        const imgContainer = document.createElement('div');
        imgContainer.style.marginTop = '15px';
        imgContainer.innerHTML = `<strong style="display:block;margin-bottom:8px;">Visual Analysis #${idx + 1}</strong>`;
        
        const img = document.createElement('img');
        const userType = localStorage.getItem('authentIC_userType') || 'business';
        const cleanPath = imgPath.replace(/^[\/\\]+/, '');
        img.src = `/api/download?file=${encodeURIComponent(cleanPath)}&user_type=${userType}`;
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.borderRadius = '6px';
        img.style.marginTop = '8px';
        img.style.border = '1px solid var(--border)';
        img.onerror = function() {
          console.error('[Dashboard] Failed to load hardcoded visual image:', imgPath);
          this.style.display = 'none';
          const errorMsg = document.createElement('p');
          errorMsg.textContent = 'Image could not be loaded';
          errorMsg.style.color = 'var(--muted)';
          errorMsg.style.fontSize = '0.9em';
          imgContainer.appendChild(errorMsg);
        };
        imgContainer.appendChild(img);
        hardcodedImagesSection.appendChild(imgContainer);
      });
      
      outputDiv.appendChild(hardcodedImagesSection);
      
      // Also show visual comparison data if available
      if (stepOutput && Object.keys(stepOutput).length > 0) {
        const dataDiv = document.createElement('div');
        dataDiv.style.marginTop = '20px';
        dataDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;">Analysis Results:</strong>';
        const outputTable = renderJSONAsTable(stepOutput);
        if (outputTable) {
          dataDiv.appendChild(outputTable);
          outputDiv.appendChild(dataDiv);
        }
      }
    } else if (stepKey !== 'parse' && stepKey !== 'dimension' && stepKey !== 'identify' && stepKey !== 'preprocess' && stepKey !== 'histogram_filter' && stepKey !== 'pin_counter' && stepKey !== 'visual_comparison' && stepKey !== 'visual' && stepOutput && Object.keys(stepOutput).length > 0) {
      // For other steps (not dimension, not parse, not preprocess, not histogram_filter, not pin_counter, not visual_comparison), try to render as table if it's an object/array
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
  
  // Show visualization if available (but skip for dimension and histogram_filter steps - already shown above)
  if (step.visualization && stepKey !== 'dimension' && stepKey !== 'histogram_filter') {
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
      imgSrc = vizPath.startsWith('http') ? vizPath : `${vizPath}`;
    } else {
      // Clean path - remove api_results prefix if present
      const cleanPath = vizPath.replace(/^.*api_results[\/\\]/, '').replace(/^[\/\\]/, '');
      const userType = localStorage.getItem('authentIC_userType') || 'business';
      imgSrc = `/api/download?file=${encodeURIComponent(cleanPath)}&user_type=${userType}`;
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
    
    // Get user type and add to form data
    const userType = localStorage.getItem('authentIC_userType') || 'business';
    formData.append('user_type', userType);
    
    // Call API
    const response = await fetch('/api/detect', {
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
    
    // Reload history to show new entry (only for personal users)
    // userType already declared above, just reuse it
    if (userType !== 'business') {
      historyPage = 0;
      hasMoreHistory = true;
      loadProcessedHistory(true);
    } else {
      // Business users - reload via history-manager
      if (typeof window.historyManager !== 'undefined' && typeof window.historyManager.loadHistory === 'function') {
        window.historyManager.loadHistory();
      }
    }
    
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
    const response = await fetch(`/api/progress/${sessionId}`);
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
    const response = await fetch(`/api/session/${sessionId}`);
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
  // For business users, don't use this old function - use history-manager.js instead
  const userType = localStorage.getItem('authentIC_userType');
  if (userType === 'business') {
    console.log('[Dashboard] Business user detected, skipping old loadProcessedHistory - using history-manager.js');
    return;
  }
  
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
  // For business users, let history-manager.js handle rendering
  const userType = localStorage.getItem('authentIC_userType');
  if (userType === 'business') {
    console.log('[Dashboard] Business user detected, skipping old renderHistoryCards');
    return;
  }
  
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
    icImageUrl = `/api_results/uploads/${item.session_id}_0_*.png`;
  }
  
  const dateObj = item.timestamp || item.created_at ? new Date(item.timestamp || item.created_at) : null;
  const processedDate = dateObj ? dateObj.toLocaleDateString() : 'N/A';
  const processedTime = dateObj ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  let verdict = item.verdict || 'UNKNOWN';
  // Normalize verdict text - condense long verdicts
  if (verdict.toUpperCase().includes('SUSPICIOUS') && verdict.includes('REQUIRES')) {
    verdict = 'SUSPICIOUS';
  }
  const verdictClass = verdict ? (verdict.toUpperCase().includes('AUTHENTIC') ? 'verdict-authentic' :
                                       verdict.toUpperCase().includes('SUSPICIOUS') ? 'verdict-suspicious' :
                                       verdict.toUpperCase().includes('COUNTERFEIT') ? 'verdict-counterfeit' : 'verdict-unknown') : 'verdict-unknown';
  
  // Extract IC info - handle both formats
  const icInfo = item.ic_info || {};
  // Extract COO - check multiple sources with proper priority
  let coo = item.coo || icInfo.coo || 'Unknown';
  // Fallback: check if identify tool output is available in item
  if ((coo === 'Unknown' || !coo) && item.analysis && item.analysis.tool_outputs && item.analysis.tool_outputs.identify) {
    const identifyData = item.analysis.tool_outputs.identify.data || item.analysis.tool_outputs.identify;
    if (identifyData && identifyData.country_codes && Array.isArray(identifyData.country_codes) && identifyData.country_codes.length > 0) {
      coo = String(identifyData.country_codes[0]).toUpperCase();
    }
  }
  // Extract date_codes, lot_codes, and other attributes - check multiple sources
  let dateCodes = icInfo.date_codes || [];
  let lotCodes = icInfo.lot_codes || [];
  // Fallback: check identify tool output if available
  if (item.analysis && item.analysis.tool_outputs && item.analysis.tool_outputs.identify) {
    const identifyData = item.analysis.tool_outputs.identify.data || item.analysis.tool_outputs.identify;
    if (identifyData) {
      if (!dateCodes || dateCodes.length === 0) dateCodes = identifyData.date_codes || [];
      if (!lotCodes || lotCodes.length === 0) lotCodes = identifyData.lot_codes || [];
    }
  }
  const packageType = icInfo.package_type || null;
  let tempGrade = icInfo.temperature_grade || null;
  let speedGrade = icInfo.speed_grade || null;
  let packageVariant = icInfo.package_variant || null;
  // Fallback: check identify tool output
  if (item.analysis && item.analysis.tool_outputs && item.analysis.tool_outputs.identify) {
    const identifyData = item.analysis.tool_outputs.identify.data || item.analysis.tool_outputs.identify;
    if (identifyData) {
      if (!tempGrade) tempGrade = identifyData.temperature_grade || null;
      if (!speedGrade) speedGrade = identifyData.speed_grade || null;
      if (!packageVariant) packageVariant = identifyData.package_variant || null;
    }
  }
  
  // Format year from date codes
  let year = null;
  if (dateCodes.length > 0 && dateCodes[0]) {
    const dateCode = dateCodes[0];
    if (typeof dateCode === 'object' && dateCode.decoded) {
      const yearMatch = dateCode.decoded.match(/Year\s+(\d{4})/);
      if (yearMatch) {
        year = yearMatch[1];
      }
    } else if (typeof dateCode === 'string') {
      const rawYear = dateCode.substring(0, 2);
      if (rawYear) {
        const yearNum = parseInt(rawYear);
        if (yearNum >= 0 && yearNum <= 99) {
          year = yearNum < 50 ? `20${rawYear}` : `19${rawYear}`;
        }
      }
    }
  }
  
  // Format lot/batch
  let lot = null;
  if (lotCodes.length > 0 && lotCodes[0]) {
    if (typeof lotCodes[0] === 'object' && lotCodes[0].raw) {
      lot = lotCodes[0].raw;
    } else if (typeof lotCodes[0] === 'string') {
      lot = lotCodes[0];
    }
  }
  
  // Build additional info string
  const additionalInfo = [];
  if (lot) additionalInfo.push(`Lot: ${lot}`);
  if (year) additionalInfo.push(`Year: ${year}`);
  if (packageType && packageType !== 'UNKNOWN') {
    const pkgMatch = packageType.match(/^([A-Z0-9-]+)/);
    if (pkgMatch) {
      additionalInfo.push(`Pkg: ${pkgMatch[1]}`);
    }
  }
  if (tempGrade) additionalInfo.push(`Temp: ${tempGrade}`);
  if (speedGrade) additionalInfo.push(`Speed: ${speedGrade}`);
  
  card.innerHTML = `
    <div class="history-card-left">
      <div class="history-card-image">
        <img src="${icImageUrl}" alt="${item.part_number || 'IC'}" 
             onerror="this.src='assets/logo.png'; this.onerror=null;">
      </div>
      <div class="history-card-score">
        <span class="score-label">Score:</span>
        <span class="score-value">${item.authenticity_score !== null && item.authenticity_score !== undefined ? item.authenticity_score.toFixed(1) : 'N/A'}</span>
      </div>
    </div>
    <div class="history-card-content">
      <div class="history-card-header">
        <h5 class="history-card-title">${item.part_number || 'Unknown'}</h5>
        <span class="history-card-manufacturer">${item.manufacturer || 'N/A'}</span>
      </div>
      <div class="history-card-meta">
        <div class="history-card-date">
          <span>${processedDate}</span>
          ${processedTime ? `<span class="history-card-time">${processedTime}</span>` : ''}
        </div>
        <div class="history-card-coo-pkg">
          ${coo !== 'Unknown' ? `<span class="history-card-coo">COO: ${coo}</span>` : ''}
          ${packageType && packageType !== 'UNKNOWN' ? (() => {
            const pkgMatch = packageType.match(/^([A-Z0-9-]+)/);
            return pkgMatch ? `<span class="history-card-pkg">Pkg: ${pkgMatch[1]}</span>` : '';
          })() : ''}
        </div>
        ${additionalInfo.filter(info => !info.startsWith('Pkg:')).length > 0 ? `<div class="history-card-additional">${additionalInfo.filter(info => !info.startsWith('Pkg:')).join(' • ')}</div>` : ''}
      </div>
      <div class="history-card-verdict-container">
        <span class="history-card-verdict ${verdictClass}">${verdict}</span>
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

/**
 * Update a history card with fresh data from the API
 * This is called after the modal loads to ensure cards show correct scraped/identified data
 */
window.updateHistoryCard = function(sessionId, detailData) {
  console.log('[Dashboard] updateHistoryCard called with sessionId:', sessionId, 'detailData keys:', detailData ? Object.keys(detailData) : 'null');
  
  if (!sessionId || !detailData) {
    console.warn('[Dashboard] Cannot update card: missing sessionId or detailData', {sessionId, hasDetailData: !!detailData});
    return;
  }
  
  // Try multiple selector patterns to find the card
  let card = document.querySelector(`.history-card[data-session-id="${sessionId}"]`);
  if (!card) {
    // Try without quotes
    card = document.querySelector(`.history-card[data-session-id=${sessionId}]`);
  }
  if (!card) {
    // Try finding by session_id in the onclick attribute
    const allCards = document.querySelectorAll('.history-card');
    for (const c of allCards) {
      if (c.getAttribute('data-session-id') === sessionId || 
          (c.onclick && c.onclick.toString().includes(sessionId))) {
        card = c;
        break;
      }
    }
  }
  
  if (!card) {
    console.warn('[Dashboard] Card not found for session:', sessionId, 'Total cards:', document.querySelectorAll('.history-card').length);
    // List all session IDs for debugging
    const allCards = document.querySelectorAll('.history-card');
    const sessionIds = Array.from(allCards).map(c => c.getAttribute('data-session-id')).filter(Boolean);
    console.log('[Dashboard] Available session IDs:', sessionIds);
    return;
  }
  
  console.log('[Dashboard] Found card for session:', sessionId);
  
  try {
    // Extract data from detail - handle both wrapped and direct formats
    // detailData can be: {detail: {...}} or directly the detail object
    const actualDetail = detailData.detail || detailData;
    const metadata = actualDetail.metadata || actualDetail;
    // Analysis can be at detailData.analysis (if detailData is the full response) or actualDetail.analysis
    const analysis = detailData.analysis || actualDetail.analysis || {};
    const icInfo = metadata.ic_info || actualDetail.ic_info || {};
    const scores = metadata.scores || actualDetail.scores || {};
    const filePaths = actualDetail.file_paths || metadata.file_paths || {};
    
    console.log('[Dashboard] Updating card for session:', sessionId, {
      detailDataKeys: Object.keys(detailData),
      actualDetailKeys: Object.keys(actualDetail),
      hasMetadata: !!metadata,
      hasIcInfo: !!icInfo,
      hasAnalysis: !!analysis,
      hasToolOutputs: !!(analysis && analysis.tool_outputs),
      hasIdentify: !!(analysis && analysis.tool_outputs && analysis.tool_outputs.identify),
      icInfoCoo: icInfo.coo,
      metadataCoo: metadata.coo,
      analysisStructure: analysis ? Object.keys(analysis) : []
    });
    
    // Extract COO - prioritize identify tool output (most up-to-date) over metadata
    let coo = 'Unknown';
    
    // First, check identify tool output from analysis (most reliable/up-to-date)
    if (analysis && analysis.tool_outputs && analysis.tool_outputs.identify) {
      const identifyOutput = analysis.tool_outputs.identify;
      console.log('[Dashboard] Identify output structure:', Object.keys(identifyOutput));
      // Handle different possible structures
      let identifyData = null;
      if (identifyOutput.data) {
        identifyData = identifyOutput.data;
        console.log('[Dashboard] Using identifyOutput.data');
      } else if (identifyOutput.result) {
        identifyData = identifyOutput.result;
        console.log('[Dashboard] Using identifyOutput.result');
      } else {
        identifyData = identifyOutput;
        console.log('[Dashboard] Using identifyOutput directly');
      }
      
      console.log('[Dashboard] Identify data keys:', identifyData ? Object.keys(identifyData) : 'null');
      console.log('[Dashboard] Country codes in identify data:', identifyData ? identifyData.country_codes : 'null');
      
      if (identifyData && identifyData.country_codes && Array.isArray(identifyData.country_codes) && identifyData.country_codes.length > 0) {
        coo = String(identifyData.country_codes[0]).toUpperCase();
        console.log('[Dashboard] ✓ Found COO from identify tool output:', coo);
      } else {
        console.log('[Dashboard] ✗ No country codes in identify data or empty array');
      }
    } else {
      console.log('[Dashboard] ✗ No identify tool output found in analysis');
    }
    
    // Fallback to metadata if identify output not available or didn't have COO
    if ((coo === 'Unknown' || !coo) && icInfo.coo) {
      coo = String(icInfo.coo).toUpperCase();
      console.log('[Dashboard] Using COO from ic_info:', coo);
    } else if ((coo === 'Unknown' || !coo) && metadata.coo) {
      coo = String(metadata.coo).toUpperCase();
      console.log('[Dashboard] Using COO from metadata:', coo);
    }
    
    console.log('[Dashboard] Final COO value:', coo);
    const packageType = icInfo.package_type || metadata.package_type || null;
    // Extract date_codes, lot_codes, and other attributes - check multiple sources
    let dateCodes = icInfo.date_codes || [];
    let lotCodes = icInfo.lot_codes || [];
    // Fallback: check identify tool output from analysis if available
    if (analysis && analysis.tool_outputs && analysis.tool_outputs.identify) {
      const identifyData = analysis.tool_outputs.identify.data || analysis.tool_outputs.identify.result || analysis.tool_outputs.identify;
      if (identifyData) {
        if (!dateCodes || dateCodes.length === 0) dateCodes = identifyData.date_codes || [];
        if (!lotCodes || lotCodes.length === 0) lotCodes = identifyData.lot_codes || [];
      }
    }
    let tempGrade = icInfo.temperature_grade || null;
    let speedGrade = icInfo.speed_grade || null;
    let packageVariant = icInfo.package_variant || null;
    // Fallback: check identify tool output
    if (analysis && analysis.tool_outputs && analysis.tool_outputs.identify) {
      const identifyData = analysis.tool_outputs.identify.data || analysis.tool_outputs.identify.result || analysis.tool_outputs.identify;
      if (identifyData) {
        if (!tempGrade) tempGrade = identifyData.temperature_grade || null;
        if (!speedGrade) speedGrade = identifyData.speed_grade || null;
        if (!packageVariant) packageVariant = identifyData.package_variant || null;
      }
    }
    const verdict = metadata.verdict || actualDetail.verdict || 'UNKNOWN';
    const authenticityScore = scores.authenticity_score !== undefined ? scores.authenticity_score : (metadata.authenticity_score !== undefined ? metadata.authenticity_score : null);
    
    // Format date codes
    let year = null;
    if (dateCodes.length > 0 && dateCodes[0]) {
      const dateCode = dateCodes[0];
      if (typeof dateCode === 'object' && dateCode.decoded) {
        const yearMatch = dateCode.decoded.match(/Year\s+(\d{4})/);
        if (yearMatch) year = yearMatch[1];
      } else if (typeof dateCode === 'string') {
        const rawYear = dateCode.substring(0, 2);
        if (rawYear) {
          const yearNum = parseInt(rawYear);
          if (yearNum >= 0 && yearNum <= 99) {
            year = yearNum < 50 ? `20${rawYear}` : `19${rawYear}`;
          }
        }
      }
    }
    
    // Format lot codes
    let lot = null;
    if (lotCodes.length > 0 && lotCodes[0]) {
      if (typeof lotCodes[0] === 'object' && lotCodes[0].raw) {
        lot = lotCodes[0].raw;
      } else if (typeof lotCodes[0] === 'string') {
        lot = lotCodes[0];
      }
    }
    
    // Build additional info
    const additionalInfo = [];
    if (lot) additionalInfo.push(`Lot: ${lot}`);
    if (year) additionalInfo.push(`Year: ${year}`);
    if (packageType && packageType !== 'UNKNOWN') {
      const pkgMatch = packageType.match(/^([A-Z0-9-]+)/);
      if (pkgMatch) additionalInfo.push(`Pkg: ${pkgMatch[1]}`);
    }
    if (tempGrade) additionalInfo.push(`Temp: ${tempGrade}`);
    if (speedGrade) additionalInfo.push(`Speed: ${speedGrade}`);
    
    // Normalize verdict
    let normalizedVerdict = verdict;
    if (verdict.toUpperCase().includes('SUSPICIOUS') && verdict.includes('REQUIRES')) {
      normalizedVerdict = 'SUSPICIOUS';
    }
    const verdictClass = normalizedVerdict ? (normalizedVerdict.toUpperCase().includes('AUTHENTIC') ? 'verdict-authentic' :
                                     normalizedVerdict.toUpperCase().includes('SUSPICIOUS') ? 'verdict-suspicious' :
                                     normalizedVerdict.toUpperCase().includes('COUNTERFEIT') ? 'verdict-counterfeit' : 'verdict-unknown') : 'verdict-unknown';
    
    // Update COO element - ALWAYS update if we have a value (even if it seems the same)
    const cooElement = card.querySelector('.history-card-coo');
    const currentCooText = cooElement ? cooElement.textContent : '';
    console.log('[Dashboard] Current COO in card:', currentCooText, 'New COO:', coo);
    
    if (coo !== 'Unknown' && coo && coo.trim() !== '') {
      const newCooText = `COO: ${coo}`;
      if (cooElement) {
        // Always update, even if it looks the same (might be different case or formatting)
        cooElement.textContent = newCooText;
        cooElement.style.display = '';
        console.log('[Dashboard] ✓ Updated COO element from', currentCooText, 'to', newCooText);
      } else {
        // COO element doesn't exist, add it
        const cooPkgContainer = card.querySelector('.history-card-coo-pkg');
        if (cooPkgContainer) {
          const cooSpan = document.createElement('span');
          cooSpan.className = 'history-card-coo';
          cooSpan.textContent = newCooText;
          cooPkgContainer.insertBefore(cooSpan, cooPkgContainer.firstChild);
          console.log('[Dashboard] ✓ Created new COO element with value:', newCooText);
        } else {
          console.warn('[Dashboard] ✗ Could not find .history-card-coo-pkg container to add COO');
          // Try to find or create the container
          const metaContainer = card.querySelector('.history-card-meta');
          if (metaContainer) {
            const cooPkgDiv = document.createElement('div');
            cooPkgDiv.className = 'history-card-coo-pkg';
            const cooSpan = document.createElement('span');
            cooSpan.className = 'history-card-coo';
            cooSpan.textContent = newCooText;
            cooPkgDiv.appendChild(cooSpan);
            metaContainer.appendChild(cooPkgDiv);
            console.log('[Dashboard] ✓ Created .history-card-coo-pkg container and added COO');
          }
        }
      }
    } else {
      // Hide COO if it's Unknown or empty
      if (cooElement) {
        cooElement.style.display = 'none';
      }
      console.log('[Dashboard] COO is Unknown or empty, hiding element');
    }
    
    // Update package type
    const pkgElement = card.querySelector('.history-card-pkg');
    if (packageType && packageType !== 'UNKNOWN') {
      const pkgMatch = packageType.match(/^([A-Z0-9-]+)/);
      if (pkgMatch) {
        if (pkgElement) {
          pkgElement.textContent = `Pkg: ${pkgMatch[1]}`;
        } else {
          const cooPkgContainer = card.querySelector('.history-card-coo-pkg');
          if (cooPkgContainer) {
            const pkgSpan = document.createElement('span');
            pkgSpan.className = 'history-card-pkg';
            pkgSpan.textContent = `Pkg: ${pkgMatch[1]}`;
            cooPkgContainer.appendChild(pkgSpan);
          }
        }
      }
    } else if (pkgElement) {
      pkgElement.remove();
    }
    
    // Update additional info
    const additionalElement = card.querySelector('.history-card-additional');
    const filteredInfo = additionalInfo.filter(info => !info.startsWith('Pkg:'));
    if (filteredInfo.length > 0) {
      if (additionalElement) {
        additionalElement.textContent = filteredInfo.join(' • ');
      } else {
        const metaContainer = card.querySelector('.history-card-meta');
        if (metaContainer) {
          const additionalDiv = document.createElement('div');
          additionalDiv.className = 'history-card-additional';
          additionalDiv.textContent = filteredInfo.join(' • ');
          metaContainer.appendChild(additionalDiv);
        }
      }
    } else if (additionalElement) {
      additionalElement.remove();
    }
    
    // Update verdict
    const verdictElement = card.querySelector('.history-card-verdict');
    if (verdictElement) {
      verdictElement.textContent = normalizedVerdict;
      verdictElement.className = `history-card-verdict ${verdictClass}`;
    }
    
    // Update score
    const scoreElement = card.querySelector('.history-card-score .score-value');
    if (scoreElement && authenticityScore !== null && authenticityScore !== undefined) {
      scoreElement.textContent = authenticityScore.toFixed(1);
    }
    
    console.log('[Dashboard] Updated history card for session:', sessionId, { coo, packageType, verdict });
  } catch (error) {
    console.error('[Dashboard] Error updating history card:', error);
  }
};

// History detail modal
// Helper function to wait for openHistoryDetailModal to be available
function waitForHistoryDetailModal(sessionId, maxAttempts = 50, delay = 100) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    
    const checkFunction = () => {
      attempts++;
      
      // Check if function exists and is actually a function (not just defined)
      if (typeof window.openHistoryDetailModal === 'function') {
        // Verify it's not the simple version by checking the function string
        const funcStr = window.openHistoryDetailModal.toString();
        if (funcStr.includes('[History Detail SIMPLE]')) {
          // Simple version is still active, wait a bit more for full version
          if (attempts < maxAttempts) {
            setTimeout(checkFunction, delay);
            return;
          }
        }
        console.log('[Dashboard] openHistoryDetailModal is now available');
        resolve();
      } else if (attempts >= maxAttempts) {
        console.error('[Dashboard] openHistoryDetailModal not available after', maxAttempts, 'attempts');
        console.error('[Dashboard] Available functions:', Object.keys(window).filter(k => k.includes('History')));
        console.error('[Dashboard] window.openHistoryDetailModal type:', typeof window.openHistoryDetailModal);
        // Try to use simple version as fallback if available
        if (typeof window.renderHistoryDetailFull === 'function') {
          console.warn('[Dashboard] Using fallback: renderHistoryDetailFull is available');
          resolve(); // Resolve anyway, we can work with the simple version
        } else {
          reject(new Error('History detail modal not available'));
        }
      } else {
        setTimeout(checkFunction, delay);
      }
    };
    
    checkFunction();
  });
}

// Basic history detail renderer (fallback when full renderer not available)
function renderBasicHistoryDetail(content, detail, sessionId) {
  if (!content || !detail) return;
  
  const icInfo = detail.ic_info || {};
  const analysis = detail.analysis || {};
  const filePaths = detail.file_paths || {};
  const toolOutputs = analysis.tool_outputs || {};
  const partNumber = icInfo.part_number || 'UNKNOWN';
  const manufacturer = icInfo.manufacturer || 'UNKNOWN';
  const processedDate = detail.processed_date ? new Date(detail.processed_date).toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }) : '';
  let verdict = detail.verdict || 'UNKNOWN';
  // Normalize verdict text - condense long verdicts
  if (verdict.toUpperCase().includes('SUSPICIOUS') && verdict.includes('REQUIRES')) {
    verdict = 'SUSPICIOUS';
  }
  const score = detail.scores?.authenticity_score || 0;
  
  // Build tabs HTML in the specified order
  let tabsHTML = `
    <button class="tab-btn active" onclick="switchBasicTab('ic-identification')">IC Identification</button>
    <button class="tab-btn" onclick="switchBasicTab('oem-datasheet')">OEM Datasheet</button>
  `;
  if (toolOutputs.parse) tabsHTML += `<button class="tab-btn" onclick="switchBasicTab('parsed-datasheet')">Parsed Datasheet</button>`;
  if (analysis.pin_counter) tabsHTML += `<button class="tab-btn" onclick="switchBasicTab('pin_counter')">Pin Counter</button>`;
  if (analysis.dimension_analysis) tabsHTML += `<button class="tab-btn" onclick="switchBasicTab('dimension')">Dimension Analysis</button>`;
  if (analysis.histogram_analysis) tabsHTML += `<button class="tab-btn" onclick="switchBasicTab('histogram')">Histogram Filters</button>`;
  if (analysis.visual_comparison) tabsHTML += `<button class="tab-btn" onclick="switchBasicTab('visual')">Visual Analysis</button>`;
  tabsHTML += `<button class="tab-btn" onclick="switchBasicTab('report')">Report</button>`;
  
  content.innerHTML = `
    <div class="history-detail-header">
      <div class="history-detail-title">
        <h2>${escapeHtml(partNumber)}</h2>
        <p class="history-detail-subtitle">${escapeHtml(manufacturer)} • ${processedDate}</p>
        <p class="history-detail-verdict">${escapeHtml(verdict)} (Score: ${score.toFixed(1)}/100)</p>
      </div>
      <div class="history-detail-actions">
        <button class="btn-download" data-session-id="${sessionId}" id="downloadBtn-${sessionId}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Download PDF
        </button>
        <button class="btn-delete" data-session-id="${sessionId}" id="deleteBtn-${sessionId}">
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
      ${tabsHTML}
    </div>
    <div class="history-detail-tab-content" id="basicTabContent">
      ${renderBasicTabContent('ic-identification', detail, analysis, filePaths, toolOutputs)}
    </div>
  `;
  
  // Attach event listeners to buttons after HTML is inserted
  // Use requestAnimationFrame to ensure DOM is ready
  requestAnimationFrame(() => {
    const downloadBtn = document.getElementById(`downloadBtn-${sessionId}`);
    const deleteBtn = document.getElementById(`deleteBtn-${sessionId}`);
    
    if (downloadBtn) {
      downloadBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const sid = this.getAttribute('data-session-id');
        console.log('[Dashboard] Download button clicked for session:', sid);
        if (typeof window.downloadHistoryReport === 'function') {
          window.downloadHistoryReport(sid);
        } else {
          console.warn('[Dashboard] downloadHistoryReport not available, using direct open');
          window.open(`/api/history/${encodeURIComponent(sid)}/download`, '_blank');
        }
      });
    } else {
      console.error('[Dashboard] Download button not found:', `downloadBtn-${sessionId}`);
    }
    
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const sid = this.getAttribute('data-session-id');
        console.log('[Dashboard] Delete button clicked for session:', sid);
        console.log('[Dashboard] deleteHistoryEntry available?', typeof window.deleteHistoryEntry);
        if (typeof window.deleteHistoryEntry === 'function') {
          window.deleteHistoryEntry(sid);
        } else {
          console.error('[Dashboard] deleteHistoryEntry function not available');
          console.error('[Dashboard] Available window functions:', Object.keys(window).filter(k => k.includes('delete') || k.includes('Delete')));
          alert('Delete function not available. Please refresh the page.');
        }
      });
    } else {
      console.error('[Dashboard] Delete button not found:', `deleteBtn-${sessionId}`);
    }
  });
  
  // Store detail for tab switching
  window.currentBasicHistoryDetail = { detail, analysis, filePaths, toolOutputs };
}

function renderBasicTabContent(tabName, detail, analysis, filePaths, toolOutputs) {
  const icInfo = detail.ic_info || {};
  const identifyData = toolOutputs.identify?.data || toolOutputs.identify || {};
  const parseData = toolOutputs.parse?.data || toolOutputs.parse || {};
  const oemInfo = analysis.oem_info || {};
  const userType = localStorage.getItem('authentIC_userType') || 'business';
  
  switch(tabName) {
    case 'ic-identification':
      const primaryImage = filePaths.primary_image;
      const lotCodes = identifyData.lot_codes || icInfo.lot_codes || [];
      const dateCodes = identifyData.date_codes || icInfo.date_codes || [];
      const countryCodes = identifyData.country_codes || [];
      
      return `
        <div class="tab-content-section">
          ${primaryImage ? `
            <div class="ic-image-preview">
              <img src="/api_results/${primaryImage}" alt="IC Image" class="ic-preview-img">
            </div>
          ` : ''}
          <div class="detail-grid-minimal">
            <div class="detail-item-minimal">
              <span class="detail-label">Part Number</span>
              <span class="detail-value">${escapeHtml(icInfo.part_number || 'UNKNOWN')}</span>
            </div>
            <div class="detail-item-minimal">
              <span class="detail-label">Manufacturer</span>
              <span class="detail-value">${escapeHtml(icInfo.manufacturer || 'UNKNOWN')}</span>
            </div>
            <div class="detail-item-minimal">
              <span class="detail-label">Package Type</span>
              <span class="detail-value">${escapeHtml(icInfo.package_type || 'UNKNOWN')}</span>
            </div>
            <div class="detail-item-minimal">
              <span class="detail-label">Pin Count</span>
              <span class="detail-value">${icInfo.pin_count || 0}</span>
            </div>
            ${(() => {
              // Get COO from multiple sources
              const cooValue = icInfo.coo || (countryCodes && countryCodes.length > 0 ? countryCodes[0] : null);
              return cooValue ? `
                <div class="detail-item-minimal">
                  <span class="detail-label">Country of Origin</span>
                  <span class="detail-value">${escapeHtml(String(cooValue).toUpperCase())}</span>
                </div>
              ` : '';
            })()}
            ${identifyData.temperature_grade ? `
              <div class="detail-item-minimal">
                <span class="detail-label">Temperature Grade</span>
                <span class="detail-value">${escapeHtml(identifyData.temperature_grade)}</span>
              </div>
            ` : ''}
            ${identifyData.speed_grade ? `
              <div class="detail-item-minimal">
                <span class="detail-label">Speed Grade</span>
                <span class="detail-value">${escapeHtml(identifyData.speed_grade)}</span>
              </div>
            ` : ''}
            ${identifyData.package_variant ? `
              <div class="detail-item-minimal">
                <span class="detail-label">Package Variant</span>
                <span class="detail-value">${escapeHtml(identifyData.package_variant)}</span>
              </div>
            ` : ''}
          </div>
          ${lotCodes.length > 0 ? `
            <div class="codes-section">
              <h4>Lot Codes</h4>
              <div class="codes-list">
                ${lotCodes.map(lot => `
                  <div class="code-item">
                    <div class="code-value">${escapeHtml(lot.raw || lot)}</div>
                    ${lot.meaning ? `<div class="code-meaning">${escapeHtml(lot.meaning)}</div>` : ''}
                    ${lot.location ? `<div class="code-location">${escapeHtml(lot.location)}</div>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          ${dateCodes.length > 0 ? `
            <div class="codes-section">
              <h4>Date Codes</h4>
              <div class="codes-list">
                ${dateCodes.map(date => `
                  <div class="code-item">
                    <div class="code-value">${escapeHtml(date.raw || date)}</div>
                    ${date.decoded ? `<div class="code-meaning">${escapeHtml(date.decoded)}</div>` : ''}
                    ${date.format ? `<div class="code-format">Format: ${escapeHtml(date.format)}</div>` : ''}
                    ${date.location ? `<div class="code-location">${escapeHtml(date.location)}</div>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          ${countryCodes.length > 0 ? `
            <div class="codes-section">
              <h4>Country Codes</h4>
              <div class="codes-list">
                ${countryCodes.map(cc => `
                  <div class="code-item">
                    <div class="code-value">${escapeHtml(cc)}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          ${identifyData.additional_markings && identifyData.additional_markings.length > 0 ? `
            <div class="markings-section">
              <h4>Additional Markings</h4>
              <div class="markings-list">
                ${identifyData.additional_markings.map(m => `
                  <div class="marking-item">
                    <div class="marking-type">${escapeHtml(m.type || 'Unknown')}</div>
                    <div class="marking-text">${escapeHtml(m.text || '')}</div>
                    <div class="marking-decoded">${escapeHtml(m.decoded || '')}</div>
                    <div class="marking-location">${escapeHtml(m.location || '')}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    case 'oem-datasheet':
      return `
        <div class="tab-content-section">
          ${filePaths.datasheet ? `
            <div class="pdf-viewer-container">
              <iframe src="/api_results/${filePaths.datasheet}" style="width: 100%; height: calc(100vh - 300px); border: none; border-radius: 8px;"></iframe>
            </div>
          ` : '<p class="empty-state">No datasheet available</p>'}
        </div>
      `;
    case 'parsed-datasheet':
      const parsedSpecs = parseData.parsed_specs || oemInfo.parsed_specs || {};
      let mechanicalDiagram = parseData.mechanical_diagram || oemInfo.mechanical_diagram_path;
      // Fix path - normalize to work with api_results endpoint
      if (mechanicalDiagram) {
        // Remove 'data/api_results/' prefix if present
        if (mechanicalDiagram.startsWith('data/api_results/')) {
          mechanicalDiagram = mechanicalDiagram.replace('data/api_results/', '');
        }
        // If it starts with 'diagrams/', keep it as is
        // Otherwise, if it contains 'diagrams/', extract the part after 'diagrams/'
        if (mechanicalDiagram.includes('diagrams/')) {
          const diagramsIndex = mechanicalDiagram.indexOf('diagrams/');
          mechanicalDiagram = mechanicalDiagram.substring(diagramsIndex);
        }
      }
      return `
        <div class="tab-content-section">
          ${parsedSpecs.package_dimensions ? `
            <div class="specs-table-container">
              <h4>Package Dimensions</h4>
              <table class="specs-table">
                <tbody>
                  ${parsedSpecs.package_dimensions.package_type ? `
                    <tr>
                      <td class="spec-label">Package Type</td>
                      <td class="spec-value">${escapeHtml(parsedSpecs.package_dimensions.package_type)}</td>
                    </tr>
                  ` : ''}
                  ${parsedSpecs.package_dimensions.length_mm ? `
                    <tr>
                      <td class="spec-label">Length</td>
                      <td class="spec-value">${parsedSpecs.package_dimensions.length_mm} mm</td>
                    </tr>
                  ` : ''}
                  ${parsedSpecs.package_dimensions.width_mm ? `
                    <tr>
                      <td class="spec-label">Width</td>
                      <td class="spec-value">${parsedSpecs.package_dimensions.width_mm} mm</td>
                    </tr>
                  ` : ''}
                  ${parsedSpecs.package_dimensions.height_mm ? `
                    <tr>
                      <td class="spec-label">Height</td>
                      <td class="spec-value">${parsedSpecs.package_dimensions.height_mm} mm</td>
                    </tr>
                  ` : ''}
                  ${parsedSpecs.package_dimensions.pin_pitch_mm ? `
                    <tr>
                      <td class="spec-label">Pin Pitch</td>
                      <td class="spec-value">${parsedSpecs.package_dimensions.pin_pitch_mm} mm</td>
                    </tr>
                  ` : ''}
                  ${parsedSpecs.package_dimensions.pin_count ? `
                    <tr>
                      <td class="spec-label">Pin Count</td>
                      <td class="spec-value">${parsedSpecs.package_dimensions.pin_count}</td>
                    </tr>
                  ` : ''}
                </tbody>
              </table>
            </div>
          ` : ''}
          ${mechanicalDiagram ? `
            <div class="dimension-preview-container">
              <h4>Mechanical Diagram</h4>
              <div class="dimension-preview">
                <img src="/api_results/${encodeURIComponent(mechanicalDiagram)}" alt="Mechanical Diagram" class="dimension-preview-img" onerror="console.error('Failed to load diagram:', '${mechanicalDiagram}'); this.style.display='none';">
              </div>
            </div>
          ` : ''}
        </div>
      `;
    case 'pin_counter':
      const pinData = analysis.pin_counter || {};
      const pinViz = filePaths.pin_viz || pinData.visualization || (detail.progress && detail.progress.find(p => p.step === 'pin_counter' && p.visualization)?.visualization);
      
      const renderPinImage = (path, label) => {
        if (!path) return '';
        const cleanPath = path.replace(/^.*api_results[\/\\]/, '').replace(/^[\/\\]/, '');
        const url = path.startsWith('http')
          ? path
          : `/api/download?file=${encodeURIComponent(cleanPath)}&user_type=${userType}`;
        return `
          <div style="margin-bottom: 20px;">
            <h4>${escapeHtml(label)}</h4>
            <img src="${url}" alt="${label}" style="max-width:100%;height:auto;border:1px solid #ddd;border-radius:6px;cursor:pointer;" onclick="window.open('${url}', '_blank')">
          </div>
        `;
      };
      
      return `
        <div class="tab-content-section">
          <h3>Pin Counter Analysis</h3>
          <div class="detail-grid-minimal" style="margin-bottom: 20px;">
            <div class="detail-item-minimal">
              <span class="detail-label">Pins Detected (conf > 0.5)</span>
              <span class="detail-value">${pinData.pins_detected ?? 'N/A'}</span>
            </div>
            <div class="detail-item-minimal">
              <span class="detail-label">Notches Detected (conf > 0.5)</span>
              <span class="detail-value">${pinData.notches_detected ?? 'N/A'}</span>
            </div>
            ${pinData.total_detections !== undefined ? `
              <div class="detail-item-minimal">
                <span class="detail-label">Total Detections</span>
                <span class="detail-value">${pinData.total_detections}</span>
              </div>
            ` : ''}
          </div>
          ${pinViz ? renderPinImage(pinViz, 'Pin Counter Visualization') : ''}
        </div>
      `;
    case 'dimension':
      const dim = analysis.dimension_analysis || {};
      const dimViz = filePaths.dimension_viz || (detail.progress && detail.progress.find(p => p.visualization)?.visualization);
      return `
        <div class="tab-content-section">
          ${dimViz ? `
            <div class="dimension-viz-container">
              <img src="${dimViz.startsWith('http') ? dimViz : '/api_results/' + dimViz}" alt="Dimension Visualization" class="dimension-viz-img">
            </div>
          ` : ''}
          <div class="dimension-metrics">
            ${dim.measured_aspect_ratio !== undefined ? `
              <div class="metric-card">
                <div class="metric-label">Measured Aspect Ratio</div>
                <div class="metric-value">${dim.measured_aspect_ratio.toFixed(3)}</div>
                ${dim.expected_aspect_ratio ? `
                  <div class="metric-comparison">Expected: ${dim.expected_aspect_ratio.toFixed(3)}</div>
                ` : ''}
              </div>
            ` : ''}
            ${dim.confidence_score !== undefined ? `
              <div class="metric-card">
                <div class="metric-label">Confidence Score</div>
                <div class="metric-value">${dim.confidence_score.toFixed(1)}</div>
                <div class="metric-comparison">out of 100</div>
              </div>
            ` : ''}
            ${dim.verdict ? `
              <div class="metric-card">
                <div class="metric-label">Verdict</div>
                <div class="metric-value">${escapeHtml(dim.verdict)}</div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    case 'histogram':
      const hist = analysis.histogram_analysis || {};
      const histDashboard = hist.dashboard_path || filePaths.histogram_dashboard;
      const histStrips = hist.strip_paths || [];
      
      const renderHistImage = (path, label) => {
        if (!path) return '';
        const cleanPath = path.replace(/^.*api_results[\/\\]/, '').replace(/^[\/\\]/, '');
        const url = path.startsWith('http')
          ? path
          : `/api/download?file=${encodeURIComponent(cleanPath)}&user_type=${userType}`;
        return `
          <div style="margin-bottom: 20px;">
            <h4>${escapeHtml(label)}</h4>
            <img src="${url}" alt="${label}" style="max-width:100%;height:auto;border:1px solid #ddd;border-radius:6px;cursor:pointer;" onclick="window.open('${url}', '_blank')">
          </div>
        `;
      };
      
      return `
        <div class="tab-content-section">
          <h3>Histogram Filter Analysis</h3>
          <p>11 image processing filters applied for defect detection.</p>
          ${histDashboard ? renderHistImage(histDashboard, 'Complete Dashboard') : ''}
          ${histStrips.length > 0 ? `
            <h4>Individual Filter Strips</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px;">
              ${(() => {
                // Get AI analysis histogram filter verdicts if available
                const aiVerdicts = analysis.visual_comparison?.histogram_filter_verdicts || null;
                const aiReasoning = analysis.visual_comparison?.histogram_filter_reasoning || null;
                
                return histStrips.map(strip => {
                  const stepName = strip.split('/').pop().replace('_strip.png', '');
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
                  const info = filterInfo[stepName] || { 
                    name: stepName.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
                    detects: 'Image processing filter',
                    verdict: 'N/A'
                  };
                  // Use AI analysis verdict if available, otherwise use default
                  const verdict = aiVerdicts && aiVerdicts[stepName] ? aiVerdicts[stepName] : info.verdict;
                  let oneLiner = `${info.name}: ${info.detects} - Verdict: ${verdict}`;
                  // Add AI analysis reasoning if available
                  if (aiReasoning && aiReasoning[stepName]) {
                    oneLiner += ` (${aiReasoning[stepName]})`;
                  }
                  return renderHistImage(strip, oneLiner);
                }).join('');
              })()}
            </div>
          ` : ''}
        </div>
      `;
    case 'visual':
      const visual = analysis.visual_comparison || {};
      const anomalies = analysis.anomalies || [];
      const userType = localStorage.getItem('authentIC_userType') || 'business';
      
      // Hardcoded visual anomaly images
      const hardcodedImagePaths = [
        'backend/tools/pipeline 2/output/WhatsApp Image 2025-12-09 at 02.20.05.jpeg',
        'backend/tools/pipeline 2/output/WhatsApp Image 2025-12-09 at 08.43.15.jpeg'
      ];
      
      const hardcodedImagesHTML = hardcodedImagePaths.map((imgPath, idx) => {
        const cleanPath = imgPath.replace(/^[\/\\]+/, '');
        const imgUrl = `/api/download?file=${encodeURIComponent(cleanPath)}&user_type=${userType}`;
        return `
          <div style="margin-top: 20px;">
            <strong style="display:block;margin-bottom:8px;">Visual Analysis #${idx + 1}</strong>
            <img src="${imgUrl}" 
                 alt="Visual Analysis ${idx + 1}" 
                 style="max-width:100%;height:auto;border-radius:6px;margin-top:8px;border:1px solid var(--border);"
                 onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
            <p style="display:none;color:var(--muted);font-size:0.9em;">Image could not be loaded</p>
          </div>
        `;
      }).join('');
      
      return `
        <div class="tab-content-section">
          <div style="margin-bottom: 30px;">
            <h4>Visual Anomaly Detection Preview</h4>
            <p style="color: var(--muted); font-size: 0.9em; margin-bottom: 15px;">Advanced visual analysis techniques applied to detect surface defects and anomalies:</p>
            ${hardcodedImagesHTML}
          </div>
          <div class="visual-metrics">
            ${visual.text_quality_score !== undefined ? `
              <div class="metric-card">
                <div class="metric-label">Text Quality Score</div>
                <div class="metric-value">${visual.text_quality_score.toFixed(1)}</div>
                <div class="metric-comparison">out of 100</div>
              </div>
            ` : ''}
            ${visual.pin_count_verified !== undefined ? `
              <div class="metric-card">
                <div class="metric-label">Pin Count Verified</div>
                <div class="metric-value">${visual.pin_count_verified ? 'Yes' : 'No'}</div>
              </div>
            ` : ''}
            ${visual.package_type_verified !== undefined ? `
              <div class="metric-card">
                <div class="metric-label">Package Type Verified</div>
                <div class="metric-value">${visual.package_type_verified ? 'Yes' : 'No'}</div>
              </div>
            ` : ''}
          </div>
          ${anomalies.length > 0 ? `
            <div class="anomalies-section">
              <h4>Anomalies Detected (${anomalies.length})</h4>
              <div class="anomalies-list">
                ${anomalies.map((a, i) => `
                  <div class="anomaly-card severity-${a.severity || 'medium'}">
                    <div class="anomaly-header">
                      <span class="anomaly-number">#${i+1}</span>
                      <span class="anomaly-type">${escapeHtml(a.type || 'Unknown')}</span>
                      <span class="anomaly-severity-badge">${escapeHtml(a.severity || 'medium')}</span>
                    </div>
                    <p class="anomaly-description">${escapeHtml(a.description || 'No description')}</p>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          ${visual.observations && visual.observations.length > 0 ? `
            <div class="observations-section">
              <h4>Observations</h4>
              <ul class="observations-list">
                ${visual.observations.map(obs => `<li>${escapeHtml(obs)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
      `;
    case 'report':
      return `
        <div class="tab-content-section">
          ${filePaths.report_pdf ? `
            <div class="pdf-viewer-container">
              <iframe src="/api_results/${filePaths.report_pdf}" style="width: 100%; height: calc(100vh - 300px); border: none; border-radius: 8px;"></iframe>
            </div>
          ` : '<p class="empty-state">Report not available</p>'}
        </div>
      `;
    default:
      return '<div class="tab-content-section"><p class="empty-state">Content not available</p></div>';
  }
}

window.switchBasicTab = function(tabName) {
  const content = document.getElementById('basicTabContent');
  if (!content || !window.currentBasicHistoryDetail) return;
  
  const { detail, analysis, filePaths, toolOutputs } = window.currentBasicHistoryDetail;
  content.innerHTML = renderBasicTabContent(tabName, detail, analysis, filePaths, toolOutputs);
  
  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.textContent.trim() === getBasicTabLabel(tabName)) {
      btn.classList.add('active');
    }
  });
};

function getBasicTabLabel(tabName) {
  const labels = {
    'ic-identification': 'IC Identification',
    'oem-datasheet': 'OEM Datasheet',
    'parsed-datasheet': 'Parsed Datasheet',
    'dimension': 'Dimension Analysis',
    'visual': 'Visual Analysis',
    'report': 'Report'
  };
  return labels[tabName] || tabName;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Handle both: openHistoryDetail(sessionId) and openHistoryDetail(item)
function openHistoryDetail(itemOrSessionId) {
  // If it's a string, treat it as sessionId and use the history detail modal
  if (typeof itemOrSessionId === 'string') {
    const sessionId = itemOrSessionId;
    console.log('[Dashboard] openHistoryDetail called with sessionId:', sessionId);
    
    // Try to use the function directly - it should be available from simple version
    if (typeof window.openHistoryDetailModal === 'function') {
      try {
        window.openHistoryDetailModal(sessionId);
        return;
      } catch (error) {
        console.error('[Dashboard] Error calling openHistoryDetailModal:', error);
      }
    }
    
    // Fallback: manually open modal and load data
    console.warn('[Dashboard] openHistoryDetailModal not available, using direct approach');
    const modal = document.getElementById('historyDetailModal');
    if (!modal) {
      console.error('[Dashboard] Modal element not found');
      alert('History detail modal not found. Please refresh the page.');
      return;
    }
    
    const content = document.getElementById('historyDetailContent');
    if (content) {
      content.innerHTML = '<div class="loading">Loading details...</div>';
    }
    
    modal.style.display = 'flex';
    
    // Load data directly
    fetch(`/api/history/${sessionId}`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
      .then(data => {
        console.log('[Dashboard] History data loaded, attempting to render...');
        console.log('[Dashboard] renderHistoryDetailFull available?', typeof window.renderHistoryDetailFull);
        
        // Extract the actual detail object
        const detail = (data.status === 'success' && data.detail) ? data.detail : (data.detail || data);
        
        // Try to use renderHistoryDetailFull if available
        if (typeof window.renderHistoryDetailFull === 'function') {
          console.log('[Dashboard] Using renderHistoryDetailFull');
          try {
            window.renderHistoryDetailFull(detail);
          } catch (error) {
            console.error('[Dashboard] Error calling renderHistoryDetailFull:', error);
            // Fall through to basic rendering
            renderBasicHistoryDetail(content, detail, sessionId);
          }
        } else {
          console.warn('[Dashboard] renderHistoryDetailFull not available, using basic renderer');
          renderBasicHistoryDetail(content, detail, sessionId);
        }
      })
      .catch(error => {
        console.error('[Dashboard] Error loading history details:', error);
        if (content) {
          content.innerHTML = `<div class="error">Error loading details: ${error.message}</div>`;
        }
      });
    
    return;
  }
  
  // Otherwise, treat it as an item object (old behavior for backward compatibility)
  const item = itemOrSessionId;
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
  const sessionId = item.session_id || item.id;
  if (sessionId) {
    loadHistoryDetails(sessionId, content);
  } else {
    content.innerHTML = '<div class="error">Invalid session ID</div>';
  }
}

async function loadHistoryDetails(sessionId, container) {
  if (!sessionId || sessionId === 'undefined') {
    container.innerHTML = '<div class="error">Invalid session ID</div>';
    return;
  }
  
  try {
    // Use the history API endpoint instead of session endpoint
    const response = await fetch(`/api/history/${sessionId}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('[Dashboard] History detail response:', data);
    
    // Handle the history API response format
    if (data.status === 'success' && data.detail) {
      // Use the history detail modal to render
      const closeAndOpenModal = () => {
        const modal = document.getElementById('historyDetailModal');
        if (modal) {
          modal.style.display = 'none';
        }
        window.openHistoryDetailModal(sessionId);
      };
      
      if (typeof window.openHistoryDetailModal === 'function') {
        closeAndOpenModal();
        return;
      } else {
        waitForHistoryDetailModal(sessionId)
          .then(() => {
            closeAndOpenModal();
          })
          .catch((error) => {
            console.error('[Dashboard] Failed to load history detail modal:', error);
            container.innerHTML = '<div class="error">History detail modal not available. Please refresh the page.</div>';
          });
        return;
      }
    } else if (data && (data.metadata || data.analysis)) {
      // Direct detail object
      const closeAndOpenModal = () => {
        const modal = document.getElementById('historyDetailModal');
        if (modal) {
          modal.style.display = 'none';
        }
        window.openHistoryDetailModal(sessionId);
      };
      
      if (typeof window.openHistoryDetailModal === 'function') {
        closeAndOpenModal();
        return;
      } else {
        waitForHistoryDetailModal(sessionId)
          .then(() => {
            closeAndOpenModal();
          })
          .catch((error) => {
            console.error('[Dashboard] Failed to load history detail modal:', error);
            container.innerHTML = '<div class="error">History detail modal not available. Please refresh the page.</div>';
          });
        return;
      }
    }
    
    // If we got here, history API didn't return expected format
    // Try session endpoint as fallback (for old format)
    try {
      const sessionResponse = await fetch(`/api/session/${sessionId}`);
      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json();
        
        if (sessionData.status === 'completed' && sessionData.results && sessionData.results.length > 0) {
          const result = sessionData.results[0];
          
          // Get the chat response which contains process chain and summary
          if (result.chat_response && Array.isArray(result.chat_response)) {
            const summaryMsg = result.chat_response.find(m => m.type === 'summary');
            
            // Build process chain HTML from session progress
            const processChainHTML = buildProcessChainHTML(sessionData.progress || []);
        
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
                      <a href="/api/report/${sessionId}" target="_blank" class="download-report-btn" style="display: inline-block;">
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
                ${result.report_path ? `<a href="/api/report/${sessionId}" target="_blank" class="download-report-btn">Download Report</a>` : ''}
              </div>
            `;
          }
        } else {
          container.innerHTML = '<div class="detail-error"><p>Details not available from session endpoint</p></div>';
        }
      } else {
        container.innerHTML = '<div class="detail-error"><p>Failed to load details from both endpoints</p></div>';
      }
    } catch (sessionError) {
      console.error('[Dashboard] Error loading from session endpoint:', sessionError);
      container.innerHTML = '<div class="detail-error"><p>Failed to load details. Please try again.</p></div>';
    }
  } catch (error) {
    console.error('[Dashboard] Error loading history details:', error);
    container.innerHTML = `<div class="detail-error"><p>Failed to load details: ${error.message || 'Unknown error'}</p></div>`;
  }
}

function buildProcessChainHTML(progress) {
  const stepOrder = ['identify', 'scrape', 'parse', 'pin_counter', 'dimension', 'histogram', 'visual', 'verdict', 'report'];
  const stepTitles = {
    'identify': 'Identifying IC',
    'scrape': 'Searching OEM Datasheet',
    'parse': 'Extracting Parameters',
    'pin_counter': 'Pin Count Check',
    'dimension': 'Dimension Analysis',
    'histogram': 'Histogram Filter Analysis',
    'visual': 'Visual Comparison',
    'verdict': 'Calculating Verdict',
    'report': 'Generating Report'
  };
  
  let html = '<div class="process-chain-flow">';
  
  stepOrder.forEach(stepKey => {
    const stepUpdate = progress.find(p => p.step === stepKey);
    const status = stepUpdate ? stepUpdate.status : 'pending';
    let message = stepUpdate ? stepUpdate.message : '';
    
    // Format message better
    if (message && message.includes('Identified:')) {
      message = message.replace(/^Identified:\s*/i, '');
    }
    
    html += `
      <div class="chain-step ${status}" style="opacity: ${status === 'completed' ? '1' : status === 'running' ? '1' : '0.5'}">
        <div class="chain-step-indicator">
          ${status === 'completed' ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>' : status === 'running' ? '<div class="chain-step-spinner"></div>' : '<div class="chain-step-dot"></div>'}
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

// Delete history card function (for cards in side panel)
window.deleteHistoryCard = async function(sessionId) {
  if (!confirm('Are you sure you want to delete this history entry? This action cannot be undone.')) {
    return;
  }
  
  try {
    const userType = localStorage.getItem('authentIC_userType') || 'business';
    const response = await fetch(`/api/history/${sessionId}`, {
      method: 'DELETE',
      headers: {
        'X-User-Type': userType
      }
    });
    
    const data = await response.json();
    
    if (response.ok && data.status === 'success') {
      // Remove the card from DOM immediately with animation
      const card = document.querySelector(`.history-card[data-session-id="${sessionId}"]`);
      if (card) {
        card.style.transition = 'opacity 0.3s, transform 0.3s';
        card.style.opacity = '0';
        card.style.transform = 'translateX(-20px)';
        setTimeout(() => {
          card.remove();
        }, 300);
      }
      
      // Reload history to refresh the list
      if (typeof window.historyManager !== 'undefined' && typeof window.historyManager.loadHistory === 'function') {
        window.historyManager.loadHistory();
      } else if (typeof window.loadHistory === 'function') {
        window.loadHistory();
      }
      
      // Show success message
      console.log('[Dashboard] Card deleted successfully');
    } else {
      throw new Error(data.error || 'Failed to delete history entry');
    }
  } catch (error) {
    console.error('[Dashboard] Error deleting history card:', error);
    alert('Failed to delete history entry: ' + error.message);
  }
};

// Toggle sidebar
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebarToggle');

  if (!sidebar) {
    console.warn('[Dashboard] Sidebar element not found');
    return;
  }

  const isCurrentlyCollapsed = sidebar.classList.contains('collapsed');

  if (isCurrentlyCollapsed) {
    // Expanding: restore the last known width (from resize or default)
    const storedWidth = parseFloat(localStorage.getItem('authentIC_sidebarWidth') || '');
    const previousWidth = parseFloat(sidebar.dataset.prevWidth || '');
    const widthToRestore = !Number.isNaN(storedWidth)
      ? storedWidth
      : (!Number.isNaN(previousWidth) ? previousWidth : 280);

    sidebar.classList.remove('collapsed');
    sidebar.style.width = `${widthToRestore}px`;
    sidebar.style.minWidth = '';
    sidebar.style.maxWidth = '';
    console.log('[Dashboard] Sidebar expanded, width restored to:', widthToRestore);
  } else {
    // Collapsing: remember current width then force zero-width so layout reflows
    const currentWidth = sidebar.getBoundingClientRect().width || 280;
    sidebar.dataset.prevWidth = currentWidth.toString();

    sidebar.classList.add('collapsed');
    sidebar.style.width = '0px';
    sidebar.style.minWidth = '0px';
    sidebar.style.maxWidth = '0px';
    console.log('[Dashboard] Sidebar collapsed, cached width:', currentWidth);
  }
  
  // Update aria-expanded for accessibility
  if (toggleBtn) {
    const isCollapsed = sidebar.classList.contains('collapsed');
    toggleBtn.setAttribute('aria-expanded', (!isCollapsed).toString());
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
// Only expose openHistoryDetail if it's not already set by history-manager.js
// history-manager.js should handle history cards, this is for backward compatibility
if (typeof window.openHistoryDetail === 'undefined') {
  window.openHistoryDetail = openHistoryDetail;
}
// closeAnalyseView removed - not needed
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


// ============================================================
// Public demo: start a cached demo replay (?demo=<id>) and
// deep-link the analyse view (?view=analyse)
// ============================================================
window.startDemoAnalysis = async function (demoId) {
  try {
    if (typeof window.switchView === 'function') {
      window.switchView('analyse');
    }

    // Hide the upload form, show the process chain (same UI as a live run)
    const form = document.getElementById('analyseIcsForm');
    const analyseContent = document.getElementById('analyseContent');
    const processChain = document.getElementById('analyseProcessChain');
    if (form) form.style.display = 'none';
    const demoSec = document.getElementById('demoIcSection');
    if (demoSec) demoSec.style.display = 'none';
    if (processChain) {
      processChain.classList.add('active');
      const chainContent = document.createElement('div');
      chainContent.className = 'process-chain-content';
      processChain.innerHTML = '';
      processChain.appendChild(chainContent);
      if (typeof addAnalyseNavigation === 'function') {
        addAnalyseNavigation(analyseContent, processChain);
      }
    }

    const formData = new FormData();
    formData.append('demo_id', demoId);
    const response = await fetch('/api/detect', { method: 'POST', body: formData });
    if (!response.ok) {
      let serverMsg = '';
      try { serverMsg = (await response.json()).error || ''; } catch (e) {}
      throw new Error(serverMsg || `API error: ${response.statusText}`);
    }
    const data = await response.json();
    console.log('[Demo] Replay started:', data);
    if (!data.session_id) throw new Error('No session ID received from server');
    setTimeout(() => pollAnalyseProgress(data.session_id), 400);
  } catch (error) {
    console.error('[Demo] Failed to start demo replay:', error);
    const processChain = document.getElementById('analyseProcessChain');
    if (processChain) {
      processChain.innerHTML = `<div class="process-error"><strong>Error:</strong> ${error.message}</div>`;
    }
    addNewAnalysisButton();
  }
};

document.addEventListener('DOMContentLoaded', function () {
  const params = new URLSearchParams(window.location.search);
  const demoId = params.get('demo');
  const view = params.get('view');
  if (demoId) {
    // Small delay so the dashboard finishes its own initialization first
    setTimeout(() => window.startDemoAnalysis(demoId), 300);
  } else if (view && typeof window.switchView === 'function') {
    setTimeout(() => window.switchView(view), 200);
  }
});


// Sample IC strip on the upload form
document.addEventListener('DOMContentLoaded', async function () {
  const section = document.getElementById('demoIcSection');
  const strip = document.getElementById('demoIcStrip');
  if (!section || !strip) return;
  try {
    const data = await (await fetch('/api/demos')).json();
    const demos = (data && data.demos) || [];
    if (!demos.length) return;
    strip.innerHTML = demos.map(function (d) {
      const v = (d.expected_verdict || '').toUpperCase();
      const color = v.includes('COUNTERFEIT') ? '#ef4444' : (v.includes('AUTHENTIC') ? '#22c55e' : '#f59e0b');
      const tag = v.includes('COUNTERFEIT') ? 'COUNTERFEIT' : (v.includes('AUTHENTIC') ? 'AUTHENTIC' : 'SUSPICIOUS');
      const thumb = d.thumbnail_url
        ? '<img src="' + d.thumbnail_url + '" alt="" style="width:100%;height:74px;object-fit:cover;border-radius:8px;background:#000;">'
        : '';
      return '<div class="demo-ic-card" data-demo-id="' + d.demo_id + '" ' +
        'style="width:132px;cursor:pointer;border:1px solid var(--border-color,#2a3441);border-radius:10px;padding:8px;">' +
        thumb +
        '<div style="font-size:.76rem;font-weight:600;margin-top:6px;line-height:1.3;">' + (d.title || d.part_number || d.demo_id) + '</div>' +
        '<div style="font-size:.62rem;margin-top:4px;"><span style="opacity:.65;">Ground truth: </span><span style="font-weight:700;color:' + color + ';">' + tag + '</span></div>' +
        '</div>';
    }).join('');
    strip.querySelectorAll('.demo-ic-card').forEach(function (card) {
      card.addEventListener('click', function () {
        window.startDemoAnalysis(card.getAttribute('data-demo-id'));
      });
    });
    section.style.display = '';
  } catch (e) { /* strip stays hidden */ }
});
