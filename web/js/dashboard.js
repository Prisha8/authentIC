// dashboard.js - public demo build: no authentication.
// Everyone is the anonymous "business" demo user.

function getRedirectUrl() {
  return 'dashboard.html';
}

async function checkAuth() {
  localStorage.setItem('authentIC_userType', 'business');
  localStorage.setItem('authentIC_loggedIn', 'true');
  return true;
}

// Define logout handler function IMMEDIATELY at the top level
// This ensures it's available for inline onclick handlers
window.handleLogout = async function(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }
  
  // Public demo: "logout" just returns to the landing page
  window.location.href = 'index.html';
};

// Setup logout handler immediately (before auth check)
// Use a global flag to prevent conflicts with chat.js
window.logoutHandlerAttached = window.logoutHandlerAttached || false;

function setupLogout() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (!logoutBtn) {
    console.warn('[Dashboard] Logout button not found');
    return false;
  }
  
  // If handler already attached by another script, don't attach again
  if (window.logoutHandlerAttached || logoutBtn.dataset.handlerAttached === 'true') {
    console.log('[Dashboard] Logout handler already attached, skipping');
    return true;
  }
  
  // Add event listener using the global function
  logoutBtn.addEventListener('click', window.handleLogout, true); // Use capture phase to ensure it fires first
  
  // Mark as attached
  logoutBtn.dataset.handlerAttached = 'true';
  window.logoutHandlerAttached = true;
  console.log('[Dashboard] Logout handler attached to button');
  return true;
}

// Setup logout immediately when script loads
(function initLogout() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!setupLogout()) {
        // Try again after a short delay if button wasn't ready
        setTimeout(() => setupLogout(), 200);
        setTimeout(() => setupLogout(), 500);
      }
    });
  } else {
    if (!setupLogout()) {
      // Try again after a short delay if button wasn't ready
      setTimeout(() => setupLogout(), 200);
      setTimeout(() => setupLogout(), 500);
    }
  }
})();

// Setup search overlay functionality
function setupSearchOverlay() {
  const searchChatsBtn = document.getElementById('searchChatsBtn');
  const searchOverlay = document.getElementById('searchOverlay');
  const closeSearchBtn = document.getElementById('closeSearchBtn');
  const searchChatInput = document.getElementById('searchChatInput');
  const searchResults = document.getElementById('searchResults');

  if (!searchChatsBtn || !searchOverlay || !closeSearchBtn || !searchChatInput || !searchResults) {
    console.log('[Dashboard] Search overlay elements not found');
    return;
  }

  // Open search overlay
  searchChatsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    console.log('[Dashboard] Opening search overlay');
    searchOverlay.style.display = 'flex';
    setTimeout(() => {
      searchChatInput.focus();
    }, 100);
    // Load all chats for search
    performSearch('');
  });

  // Close search overlay
  function closeSearchOverlay() {
    searchOverlay.style.display = 'none';
    searchChatInput.value = '';
    searchResults.innerHTML = '';
  }

  closeSearchBtn.addEventListener('click', closeSearchOverlay);

  // Close on overlay background click
  searchOverlay.addEventListener('click', (e) => {
    if (e.target === searchOverlay) {
      closeSearchOverlay();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchOverlay.style.display === 'flex') {
      closeSearchOverlay();
    }
  });

  // Perform search as user types
  searchChatInput.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    performSearch(query);
  });

  // Perform search function
  async function performSearch(query) {
    console.log('[Dashboard] Performing search with query:', query);
    
    try {
      // Get all chats from Supabase
      let allChats = [];
      
      if (typeof chatService !== 'undefined') {
        try {
          allChats = await chatService.getUserChats();
          console.log('[Dashboard] Loaded', allChats.length, 'chats from Supabase');
        } catch (error) {
          console.error('[Dashboard] Error loading chats from Supabase:', error);
        }
      }

      // Filter chats based on query
      const filteredChats = query === '' 
        ? allChats 
        : allChats.filter(chat => 
            chat.title.toLowerCase().includes(query)
          );

      // Render results
      renderSearchResults(filteredChats);
    } catch (error) {
      console.error('[Dashboard] Error performing search:', error);
      searchResults.innerHTML = '<div class="search-result-item"><div class="search-result-item-title">Error loading chats</div></div>';
    }
  }

  // Render search results
  function renderSearchResults(chats) {
    if (chats.length === 0) {
      searchResults.innerHTML = '<div class="search-result-item"><div class="search-result-item-title" style="color: var(--muted);">No chats found</div></div>';
      return;
    }

    searchResults.innerHTML = chats.map(chat => {
      const time = chatService && chat.updated_at 
        ? chatService.formatTime(chat.updated_at)
        : 'Recently';
      
      return `
        <div class="search-result-item" data-chat-id="${chat.id}" onclick="window.location.href='query.html?chatId=${chat.id}'">
          <div class="search-result-item-title">${escapeHtml(chat.title || 'Untitled Chat')}</div>
          <div class="search-result-item-time">${time}</div>
        </div>
      `;
    }).join('');
  }

  // Helper function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Setup language dropdown immediately (doesn't need auth)
function setupLanguageDropdown() {
  const langBtn = document.getElementById('langBtn');
  const langMenu = document.getElementById('langMenu');
  const langDisplay = document.getElementById('langDisplay');
  
  if (!langBtn || !langMenu || !langDisplay) {
    console.log('Language dropdown elements not found');
    return;
  }
  
  // Load saved language preference (default to English)
  const savedLang = localStorage.getItem('authentIC_language') || 'en';
  const savedLangOption = document.querySelector(`.lang-option[data-lang="${savedLang}"]`);
  if (savedLangOption) {
    langDisplay.textContent = savedLangOption.dataset.code;
    document.querySelectorAll('.lang-option').forEach(opt => opt.classList.remove('active'));
    savedLangOption.classList.add('active');
    // Translate page if function is available and language is not English
    if (savedLang !== 'en') {
      setTimeout(() => {
        if (typeof window.translatePage === 'function') {
          window.translatePage(savedLang);
        }
      }, 100);
    }
  }

  // Toggle dropdown
  langBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Language button clicked');
    const isShowing = langMenu.classList.contains('show');
    console.log('Currently showing:', isShowing);
    
    // Close all other dropdowns first (if any)
    document.querySelectorAll('.lang-menu').forEach(menu => {
      if (menu !== langMenu) menu.classList.remove('show');
    });
    
    // Toggle this menu
    langMenu.classList.toggle('show');
    console.log('Menu classes after toggle:', langMenu.className);
    console.log('Menu display style:', window.getComputedStyle(langMenu).display);
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!langBtn.contains(e.target) && !langMenu.contains(e.target)) {
      langMenu.classList.remove('show');
    }
  });

  // Handle language selection
  document.querySelectorAll('.lang-option').forEach(option => {
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      const lang = option.dataset.lang;
      const code = option.dataset.code;
      
      // Update display
      langDisplay.textContent = code;
      
      // Update active state
      document.querySelectorAll('.lang-option').forEach(opt => opt.classList.remove('active'));
      option.classList.add('active');
      
      // Save preference
      localStorage.setItem('authentIC_language', lang);
      
      // Close dropdown
      langMenu.classList.remove('show');
      
      // Translate the page immediately
      if (typeof window.translatePage === 'function') {
        window.translatePage(lang).catch(err => {
          console.error('Translation error:', err);
        });
      } else {
        console.error('translatePage function not found');
        document.documentElement.lang = lang;
      }
      
      // Show confirmation (optional)
      console.log(`Language changed to: ${option.textContent}`);
    });
  });
}

// Load chats from Supabase and render in sidebar
async function loadAndRenderChats() {
  console.log('[Dashboard] Loading chats for sidebar...');
  const chatList = document.getElementById('chatList');
  if (!chatList) {
    console.error('[Dashboard] Chat list element not found!');
    return;
  }

  try {
    if (typeof window.chatService !== 'undefined') {
      console.log('[Dashboard] ChatService available, fetching chats...');
      const chatService = window.chatService;
      const chats = await chatService.getUserChats();
      console.log('[Dashboard] Received', chats.length, 'chats from Supabase');
      
      // Clear existing static chats
      chatList.innerHTML = '';
      
      // Render chats dynamically
      chats.forEach((chat, index) => {
        console.log(`[Dashboard] Rendering chat ${index + 1}:`, chat.id, chat.title);
        const li = document.createElement('li');
        li.className = 'chat-item';
        li.dataset.chatId = chat.id;
        
        // Format time
        const timeDisplay = chatService.formatTime(chat.updated_at);
        
        // Extract IC name from title if possible (e.g., "IC Check: Texas Instruments")
        const titleParts = chat.title.split(/ \u2014 |: /);
        const displayTitle = titleParts.length > 1 ? titleParts[1] : chat.title;
        
        li.innerHTML = `
          <div><h5>IC Check: ${escapeHtml(displayTitle)}</h5></div>
          <div class="time">${timeDisplay}</div>
        `;
        
        // Click handler to navigate to chat
        li.addEventListener('click', () => {
          console.log('[Dashboard] User action: Clicked chat:', chat.id);
          window.location.href = `query.html?chatId=${chat.id}`;
        });
        
        chatList.appendChild(li);
      });
      
      // Show message if no chats
      if (chats.length === 0) {
        console.log('[Dashboard] No chats found, showing empty state');
        chatList.innerHTML = '<li class="chat-item" style="opacity:0.6;padding:12px;"><div>No chats yet. Start a new chat!</div></li>';
      } else {
        console.log('[Dashboard] Successfully rendered', chats.length, 'chats in sidebar');
      }
    } else {
      console.warn('[Dashboard] ChatService not available');
      console.warn('[Dashboard] Make sure chat-service.js is loaded before dashboard.js');
    }
  } catch (error) {
    console.error('[Dashboard] Error loading chats:', error);
    console.error('[Dashboard] Error details:', error.message);
    // Keep static chats as fallback
  }
}

// Helper to escape HTML
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Update KPIs from real history data
 * Exposed globally so it can be called from other scripts
 */
window.updateKPIsFromHistory = async function updateKPIsFromHistory() {
  try {
    const response = await fetch('/api/history');
    const data = await response.json();
    
    if (data.status === 'success' && data.history && data.history.length > 0) {
      const history = data.history;
      
      // Calculate metrics
      const totalProcessed = history.length;
      
      let totalAuthentic = 0;
      let totalSuspicious = 0;
      let totalCounterfeit = 0;
      let totalVisualMatch = 0;
      let totalAvgScore = 0;
      let totalDimensionScore = 0;
      let totalProcessingTime = 0;
      let itemsWithScores = 0;
      let itemsWithDimensionScore = 0;
      
      history.forEach(item => {
        const verdict = (item.verdict || '').toUpperCase();
        if (verdict.includes('AUTHENTIC')) {
          totalAuthentic++;
        } else if (verdict.includes('SUSPICIOUS')) {
          totalSuspicious++;
        } else if (verdict.includes('COUNTERFEIT')) {
          totalCounterfeit++;
        }
        
        // Extract scores from nested structure
        const scores = item.scores || {};
        let visualMatch = scores.visual_match || scores.visualMatch || 0;
        let authenticityScore = scores.authenticity_score || scores.authenticityScore || 0;
        // Try dimension_score first, then fallback to confidence_score from dimension_analysis
        let dimensionScore = scores.dimension_score || scores.dimensionScore || 0;
        if (dimensionScore === 0 && item.dimension_analysis) {
          dimensionScore = item.dimension_analysis.confidence_score || item.dimension_analysis.dimension_score || 0;
        }
        
        // Scores might be in 0-1 range (like 0.85) or 0-100 range (like 85)
        // If they're > 1, they're already in percentage format, otherwise convert
        if (visualMatch > 0 && visualMatch <= 1) {
          visualMatch = visualMatch * 100;
        }
        if (authenticityScore > 0 && authenticityScore <= 1) {
          authenticityScore = authenticityScore * 100;
        }
        if (dimensionScore > 0 && dimensionScore <= 1) {
          dimensionScore = dimensionScore * 100;
        }
        
        // Only count items that have at least one score
        if (visualMatch > 0 || authenticityScore > 0 || dimensionScore > 0) {
          itemsWithScores++;
        }
        
        // Count items with dimension score separately
        if (dimensionScore > 0) {
          itemsWithDimensionScore++;
        }
        
        totalVisualMatch += visualMatch;
        totalAvgScore += authenticityScore;
        totalDimensionScore += dimensionScore;
        totalProcessingTime += item.processing_time_seconds || 0;
      });
      
      // Calculate averages (scores are already in 0-100 range after conversion above)
      const avgVisualMatch = itemsWithScores > 0 ? (totalVisualMatch / itemsWithScores) : 0;
      const avgScore = itemsWithScores > 0 ? (totalAvgScore / itemsWithScores) : 0;
      const avgDimensionScore = itemsWithDimensionScore > 0 ? (totalDimensionScore / itemsWithDimensionScore) : 0;
      const avgProcessingTime = totalProcessed > 0 ? totalProcessingTime / totalProcessed : 0;
      
      // Calculate pending verifications (suspicious + counterfeit items)
      const pendingCount = totalSuspicious + totalCounterfeit;
      
      // Update circular charts
      updateCircularChart('kpi-visual', avgVisualMatch, 'kpi-visual-text');
      updateCircularChart('kpi-metadata', avgScore, 'kpi-metadata-text');
      updateCircularChart('kpi-dimension', avgDimensionScore, 'kpi-dimension-text');
      
      // Update bell curve chart
      updateBellCurveChart(totalAuthentic, totalSuspicious, totalCounterfeit);
      
      // Update progress bars with better scaling
      // For total processed, use a max that's slightly above the current total for better visualization
      const maxTotal = Math.max(totalProcessed, 10); // Minimum scale of 10
      updateProgressBar('bar-total', totalProcessed, maxTotal, 'bar-total-value', totalProcessed);
      
      // For authentic/suspicious, scale relative to total processed
      const maxVerdict = Math.max(totalProcessed, 1);
      updateProgressBar('bar-authentic', totalAuthentic, maxVerdict, 'bar-authentic-value', totalAuthentic);
      updateProgressBar('bar-suspicious', totalSuspicious + totalCounterfeit, maxVerdict, 'bar-suspicious-value', totalSuspicious + totalCounterfeit);
      
      // For processing time, use a max of 120 seconds (2 minutes)
      const maxTime = 120;
      updateProgressBar('bar-time', avgProcessingTime, maxTime, 'bar-time-value', `${avgProcessingTime.toFixed(1)}s`);
      
      // Update pending count in welcome section (after translations may have been applied)
      const updatePendingCount = () => {
        const pendingCountEl = document.getElementById('pendingCount');
        if (pendingCountEl) {
          pendingCountEl.textContent = pendingCount;
        }
      };
      
      // Try immediately
      updatePendingCount();
      
      // Also try after a delay in case translations are still applying
      setTimeout(updatePendingCount, 500);
      setTimeout(updatePendingCount, 1000);
      
      // If updatePendingCountAfterTranslation function exists, use it
      if (typeof window.updatePendingCountAfterTranslation === 'function') {
        window.updatePendingCountAfterTranslation(pendingCount);
      }
      
      console.log('[Dashboard] KPIs updated from history:', {
        totalProcessed,
        totalAuthentic,
        totalSuspicious,
        totalCounterfeit,
        pendingCount,
        avgVisualMatch: avgVisualMatch.toFixed(1),
        avgScore: avgScore.toFixed(1),
        avgDimensionScore: avgDimensionScore.toFixed(1),
        avgProcessingTime: avgProcessingTime.toFixed(1)
      });
      
      // Trigger suspicious ICs loading after KPIs are updated
      if (typeof loadSuspiciousICs === 'function') {
        console.log('[Dashboard] Triggering loadSuspiciousICs after KPI update...');
        setTimeout(() => {
          loadSuspiciousICs();
        }, 300);
      }
    } else {
      console.log('[Dashboard] No history data available for KPIs');
      // Reset to zero if no data
      updateCircularChart('kpi-visual', 0, 'kpi-visual-text');
      updateCircularChart('kpi-metadata', 0, 'kpi-metadata-text');
      updateCircularChart('kpi-dimension', 0, 'kpi-dimension-text');
      updateBellCurveChart(0, 0, 0);
      updateProgressBar('bar-total', 0, 100, 'bar-total-value', 0);
      updateProgressBar('bar-authentic', 0, 100, 'bar-authentic-value', 0);
      updateProgressBar('bar-suspicious', 0, 100, 'bar-suspicious-value', 0);
      updateProgressBar('bar-time', 0, 120, 'bar-time-value', '0s');
      
      const pendingCountEl = document.getElementById('pendingCount');
      if (pendingCountEl) {
        pendingCountEl.textContent = 0;
      }
    }
  } catch (error) {
    console.error('[Dashboard] Error updating KPIs from history:', error);
    // Reset to zero on error
    updateCircularChart('kpi-visual', 0, 'kpi-visual-text');
    updateCircularChart('kpi-metadata', 0, 'kpi-metadata-text');
    updateCircularChart('kpi-dimension', 0, 'kpi-dimension-text');
    updateBellCurveChart(0, 0, 0);
    updateProgressBar('bar-total', 0, 100, 'bar-total-value', 0);
    updateProgressBar('bar-authentic', 0, 100, 'bar-authentic-value', 0);
    updateProgressBar('bar-suspicious', 0, 100, 'bar-suspicious-value', 0);
    updateProgressBar('bar-time', 0, 120, 'bar-time-value', '0s');
  }
}

/**
 * Update circular chart with animation
 */
function updateCircularChart(chartId, value, textId) {
  const chart = document.getElementById(chartId);
  const text = document.getElementById(textId);
  
  if (!chart) {
    console.warn(`[Dashboard] Chart element not found: ${chartId}`);
    return;
  }
  
  if (!text) {
    console.warn(`[Dashboard] Text element not found: ${textId}`);
    return;
  }
  
  // Ensure value is between 0 and 100
  const percentage = Math.min(Math.max(value, 0), 100);
  
  // Calculate circumference: radius is 15.9155 (from the arc path)
  // The path creates a full circle with radius 15.9155
  const radius = 15.9155;
  const circumference = 2 * Math.PI * radius;
  
  // Calculate the dash offset to show the percentage
  // For a circular progress: stroke-dasharray = [circumference, circumference]
  // stroke-dashoffset = circumference - (percentage/100) * circumference
  const dashLength = (percentage / 100) * circumference;
  const offset = circumference - dashLength;
  
  // Set SVG attributes (not CSS properties)
  chart.setAttribute('stroke-dasharray', `${circumference} ${circumference}`);
  chart.setAttribute('stroke-dashoffset', offset.toString());
  
  // Update transition on the element style (CSS transition works on stroke-dashoffset)
  chart.style.transition = 'stroke-dashoffset 0.8s ease-in-out';
  
  // Update text content
  text.textContent = `${percentage.toFixed(0)}%`;
  
  // Update color based on value (green for high, yellow for medium, red for low)
  // Use setAttribute for SVG stroke color
  if (percentage >= 70) {
    chart.setAttribute('stroke', '#76b900'); // Green
  } else if (percentage >= 40) {
    chart.setAttribute('stroke', '#ffa500'); // Orange
  } else {
    chart.setAttribute('stroke', '#e74c3c'); // Red
  }
  
  console.log(`[Dashboard] Updated ${chartId}: ${percentage.toFixed(1)}% (dash: ${dashLength.toFixed(2)}, offset: ${offset.toFixed(2)})`);
}

/**
 * Bell curve chart instance
 */
let bellCurveChart = null;

/**
 * Update bell curve chart showing distribution of verdicts
 * Shows a single bell curve with colored regions representing where each verdict type typically falls
 */
function updateBellCurveChart(authenticCount, suspiciousCount, counterfeitCount) {
  const canvas = document.getElementById('verdictBellCurveChart');
  if (!canvas) {
    console.warn('[Dashboard] Bell curve canvas not found');
    return;
  }
  
  const ctx = canvas.getContext('2d');
  const total = authenticCount + suspiciousCount + counterfeitCount;
  
  // If no data, show empty chart
  if (total === 0) {
    if (bellCurveChart) {
      bellCurveChart.destroy();
      bellCurveChart = null;
    }
    return;
  }
  
  // Generate a single bell curve representing overall distribution
  // The curve shows where ICs typically score, with colored regions for each verdict type
  const dataPoints = 50;
  const xMin = 0;
  const xMax = 100;
  const step = (xMax - xMin) / dataPoints;
  
  // Calculate weighted mean based on actual counts
  // Authentic ICs typically score 70-100, Suspicious 40-70, Counterfeit 0-40
  const authenticMean = 85;
  const suspiciousMean = 55;
  const counterfeitMean = 25;
  
  // Weighted average mean
  const overallMean = total > 0 
    ? (authenticCount * authenticMean + suspiciousCount * suspiciousMean + counterfeitCount * counterfeitMean) / total
    : 50;
  
  // Standard deviation based on spread of verdicts
  const overallStdDev = 20;
  
  // Generate single bell curve
  const bellCurveData = [];
  for (let i = 0; i <= dataPoints; i++) {
    const x = xMin + i * step;
    const y = total * Math.exp(-0.5 * Math.pow((x - overallMean) / overallStdDev, 2)) / (overallStdDev * Math.sqrt(2 * Math.PI));
    bellCurveData.push({ x, y });
  }
  
  // Create datasets for each region (for coloring)
  const authenticData = bellCurveData.map(d => d.x >= 70 ? d.y : 0);
  const suspiciousData = bellCurveData.map(d => d.x >= 40 && d.x < 70 ? d.y : 0);
  const counterfeitData = bellCurveData.map(d => d.x < 40 ? d.y : 0);
  
  // Get computed styles for dark mode support
  const isDarkMode = document.documentElement.classList.contains('dark-mode') || 
                     window.getComputedStyle(document.body).backgroundColor.includes('rgb(15, 23, 36)');
  
  // Use brighter colors with higher opacity for dark mode visibility
  const counterfeitColor = isDarkMode ? '#ff6b6b' : '#ef4444';
  const suspiciousColor = isDarkMode ? '#ffb84d' : '#f59e0b';
  const authenticColor = isDarkMode ? '#4ade80' : '#10b981';
  
  const counterfeitBg = isDarkMode ? 'rgba(255, 107, 107, 0.4)' : 'rgba(239, 68, 68, 0.3)';
  const suspiciousBg = isDarkMode ? 'rgba(255, 184, 77, 0.4)' : 'rgba(245, 158, 11, 0.3)';
  const authenticBg = isDarkMode ? 'rgba(74, 222, 128, 0.4)' : 'rgba(16, 185, 129, 0.3)';
  
  // Prepare chart data - single curve with colored segments
  const chartData = {
    labels: bellCurveData.map(d => d.x.toFixed(0)),
    datasets: [
      {
        label: `Counterfeit (${counterfeitCount})`,
        data: counterfeitData,
        borderColor: counterfeitColor,
        backgroundColor: counterfeitBg,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0
      },
      {
        label: `Suspicious (${suspiciousCount})`,
        data: suspiciousData,
        borderColor: suspiciousColor,
        backgroundColor: suspiciousBg,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0
      },
      {
        label: `Authentic (${authenticCount})`,
        data: authenticData,
        borderColor: authenticColor,
        backgroundColor: authenticBg,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0
      }
    ]
  };
  
  const chartConfig = {
    type: 'line',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: isDarkMode ? '#f1f5f9' : '#0f1724',
            usePointStyle: true,
            padding: 10,
            font: {
              size: 10
            }
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
          titleColor: isDarkMode ? '#f1f5f9' : '#0f1724',
          bodyColor: isDarkMode ? '#f1f5f9' : '#0f1724',
          borderColor: isDarkMode ? '#334155' : '#e6e7ea',
          borderWidth: 1,
          padding: 10
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: 'Authenticity Score (0-100)',
            color: isDarkMode ? '#94a3b8' : '#6b7280',
            font: {
              size: 10
            }
          },
          ticks: {
            color: isDarkMode ? '#94a3b8' : '#6b7280',
            font: {
              size: 9
            },
            maxTicksLimit: 6
          },
          grid: {
            color: isDarkMode ? '#334155' : '#e6e7ea',
            drawBorder: false
          }
        },
        y: {
          title: {
            display: true,
            text: 'Frequency',
            color: isDarkMode ? '#94a3b8' : '#6b7280',
            font: {
              size: 10
            }
          },
          ticks: {
            color: isDarkMode ? '#94a3b8' : '#6b7280',
            font: {
              size: 9
            },
            beginAtZero: true
          },
          grid: {
            color: isDarkMode ? '#334155' : '#e6e7ea',
            drawBorder: false
          }
        }
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      }
    }
  };
  
  // Destroy existing chart if it exists
  if (bellCurveChart) {
    bellCurveChart.destroy();
    bellCurveChart = null;
  }
  
  // Create new chart
  bellCurveChart = new Chart(ctx, chartConfig);
  
  // Listen for dark mode changes and update chart colors
  const updateChartOnDarkModeChange = () => {
    if (total > 0) {
      // Recreate chart with updated colors
      updateBellCurveChart(authenticCount, suspiciousCount, counterfeitCount);
    }
  };
  
  // Only add listener once
  if (!window.bellCurveDarkModeListenerAdded) {
    // Listen for dark mode toggle
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) {
      darkModeToggle.addEventListener('click', () => {
        setTimeout(updateChartOnDarkModeChange, 100);
      });
    }
    window.bellCurveDarkModeListenerAdded = true;
  }
}

/**
 * Update progress bar with animation
 */
function updateProgressBar(barId, value, max, valueTextId, displayValue) {
  const bar = document.getElementById(barId);
  const valueText = document.getElementById(valueTextId);
  
  if (bar && valueText) {
    const percentage = max > 0 ? (value / max) * 100 : 0;
    // Add transition for smooth animation
    bar.style.transition = 'width 0.8s ease-in-out';
    bar.style.width = `${Math.min(percentage, 100)}%`;
    valueText.textContent = displayValue;
  }
}

// Wait for auth check before proceeding
checkAuth().then((isAuthenticated) => {
  if (!isAuthenticated) return;

  document.addEventListener('DOMContentLoaded', async () => {
    // Setup logout handler
    setupLogout();
    
    // Only load chats for personal users (business users use Analyse ICs instead)
    const userType = localStorage.getItem('authentIC_userType');
    if (userType !== 'business') {
      await loadAndRenderChats();
    }
    
    // Load history and update KPIs for business users
    if (userType === 'business') {
      console.log('[Dashboard] Business user detected, will load suspicious ICs');
      // Update KPIs and load suspicious ICs
      updateKPIsFromHistory().then(() => {
        console.log('[Dashboard] KPIs updated, now loading suspicious ICs...');
        // Small delay to ensure DOM is ready and function is available
        setTimeout(() => {
          if (typeof window.loadSuspiciousICs === 'function') {
            window.loadSuspiciousICs();
          } else {
            console.warn('[Dashboard] loadSuspiciousICs not available, will retry...');
            setTimeout(() => {
              if (typeof window.loadSuspiciousICs === 'function') {
                window.loadSuspiciousICs();
              }
            }, 500);
          }
        }, 500);
      }).catch((err) => {
        console.error('[Dashboard] Error updating KPIs:', err);
        // If KPIs fail, still try to load suspicious ICs
        setTimeout(() => {
          if (typeof window.loadSuspiciousICs === 'function') {
            window.loadSuspiciousICs();
          }
        }, 500);
      });
      
      // Also try loading suspicious ICs after a delay as fallback
      setTimeout(() => {
        const tasksList = document.getElementById('upcomingTasksList');
        if (tasksList) {
          const currentContent = tasksList.innerHTML;
          if (currentContent.includes('No upcoming tasks') || currentContent.includes('empty-task')) {
            console.log('[Dashboard] Fallback: Loading suspicious ICs after delay...');
            if (typeof window.loadSuspiciousICs === 'function') {
              window.loadSuspiciousICs();
            }
          }
        }
      }, 2000);
    }
    
    // animate bar fills (reads inline style width)
    document.querySelectorAll('.bar-fill').forEach((el) => {
      const w = el.style.width || '0%';
      el.style.width = '0%';
      setTimeout(() => { el.style.width = w; }, 80);
    });
    
    // Note: New Chat button removed for business users - replaced with Analyse ICs
    // Analyse ICs functionality is handled by dashboard-query.js
  });
});

// Setup sidebar resizing
function setupSidebarResizer() {
  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebarResizer');
  
  if (!sidebar || !resizer) {
    console.log('[Dashboard] Sidebar resizer elements not found', { sidebar: !!sidebar, resizer: !!resizer });
    return;
  }
  
  console.log('[Dashboard] Setting up sidebar resizer');
  
  // Load saved width from localStorage
  const savedWidth = localStorage.getItem('authentIC_sidebarWidth');
  if (savedWidth) {
    sidebar.style.width = savedWidth + 'px';
    console.log('[Dashboard] Restored sidebar width:', savedWidth);
  }
  
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;
  
  // Use both mousedown and pointerdown for better compatibility
  const handleStart = (e) => {
    console.log('[Dashboard] Resizer start event:', e.type);
    isResizing = true;
    startX = e.clientX || e.touches?.[0]?.clientX || 0;
    startWidth = sidebar.getBoundingClientRect().width;
    
    console.log('[Dashboard] Start width:', startWidth, 'Start X:', startX);
    
    // Disable transition during resize for smooth dragging
    sidebar.classList.add('resizing');
    sidebar.style.transition = 'none';
    sidebar.style.width = startWidth + 'px';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.style.pointerEvents = 'none';
    resizer.style.pointerEvents = 'auto';
    
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  };
  
  const handleMove = (e) => {
    if (!isResizing) return;
    
    const currentX = e.clientX || e.touches?.[0]?.clientX || 0;
    const diff = currentX - startX;
    const newWidth = Math.max(200, Math.min(500, startWidth + diff));
    
    sidebar.style.width = newWidth + 'px';
    sidebar.style.minWidth = newWidth + 'px';
    sidebar.style.maxWidth = newWidth + 'px';
    
    e.preventDefault();
    e.stopPropagation();
    return false;
  };
  
  const handleEnd = (e) => {
    if (isResizing) {
      const finalWidth = sidebar.getBoundingClientRect().width;
      console.log('[Dashboard] Resizer end, final width:', finalWidth);
      isResizing = false;
      
      // Re-enable transition and restore min/max width constraints
      sidebar.classList.remove('resizing');
      sidebar.style.transition = '';
      sidebar.style.minWidth = '';
      sidebar.style.maxWidth = '';
      sidebar.style.width = finalWidth + 'px';
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.style.pointerEvents = '';
      
      // Save width to localStorage
      localStorage.setItem('authentIC_sidebarWidth', finalWidth);
      
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  };
  
  // Add multiple event listeners for better compatibility
  resizer.addEventListener('mousedown', handleStart, { passive: false });
  resizer.addEventListener('pointerdown', handleStart, { passive: false });
  resizer.addEventListener('touchstart', handleStart, { passive: false });
  
  document.addEventListener('mousemove', handleMove, { passive: false });
  document.addEventListener('pointermove', handleMove, { passive: false });
  document.addEventListener('touchmove', handleMove, { passive: false });
  
  document.addEventListener('mouseup', handleEnd, { passive: false });
  document.addEventListener('pointerup', handleEnd, { passive: false });
  document.addEventListener('touchend', handleEnd, { passive: false });
  document.addEventListener('mouseleave', handleEnd, { passive: false });
  
  // Prevent text selection and drag
  resizer.addEventListener('selectstart', (e) => e.preventDefault());
  resizer.addEventListener('dragstart', (e) => e.preventDefault());
  resizer.addEventListener('contextmenu', (e) => e.preventDefault());
  
  // Test click handler to verify resizer is receiving events
  resizer.addEventListener('click', (e) => {
    console.log('[Dashboard] Resizer clicked!', e);
  });
  
  // Make resizer more visible for debugging (remove in production)
  resizer.style.backgroundColor = 'rgba(118, 185, 0, 0.1)';
  resizer.addEventListener('mouseenter', () => {
    resizer.style.backgroundColor = 'rgba(118, 185, 0, 0.3)';
  });
  resizer.addEventListener('mouseleave', () => {
    if (!isResizing) {
      resizer.style.backgroundColor = 'rgba(118, 185, 0, 0.1)';
    }
  });
  
  console.log('[Dashboard] Sidebar resizer setup complete');
  console.log('[Dashboard] Resizer element:', resizer);
  console.log('[Dashboard] Resizer computed style:', window.getComputedStyle(resizer));
}

/**
 * Load suspicious ICs and display them in the upcoming tasks container
 */
async function loadSuspiciousICs() {
  try {
    console.log('[Dashboard] Loading suspicious ICs...');
    const tasksList = document.getElementById('upcomingTasksList');
    if (!tasksList) {
      console.warn('[Dashboard] Upcoming tasks list not found');
      return;
    }

    // Fetch suspicious ICs from API - also include COUNTERFEIT as they need manual review
    const response = await fetch('/api/history?verdict=SUSPICIOUS');
    const data = await response.json();
    
    console.log('[Dashboard] Suspicious ICs API response:', data);
    console.log('[Dashboard] Response status:', data.status);
    console.log('[Dashboard] History count:', data.history ? data.history.length : 0);
    
    // Also fetch counterfeit ICs as they also need manual review
    let allPendingICs = [];
    if (data.status === 'success' && data.history) {
      allPendingICs = [...data.history];
    }
    
    // Fetch counterfeit ICs too
    try {
      const counterfeitResponse = await fetch('/api/history?verdict=COUNTERFEIT');
      const counterfeitData = await counterfeitResponse.json();
      if (counterfeitData.status === 'success' && counterfeitData.history) {
        allPendingICs = [...allPendingICs, ...counterfeitData.history];
      }
    } catch (err) {
      console.warn('[Dashboard] Error fetching counterfeit ICs:', err);
    }
    
    console.log('[Dashboard] Total pending ICs (suspicious + counterfeit):', allPendingICs.length);

    if (allPendingICs.length > 0) {
      const suspiciousICs = allPendingICs;
      
      // Clear existing content
      tasksList.innerHTML = '';

      // Render each suspicious IC as a card
      suspiciousICs.forEach(item => {
        console.log('[Dashboard] Rendering suspicious IC:', item);
        // Handle both nested and flat structures
        const icInfo = item.ic_info || {};
        const filePaths = item.file_paths || {};
        // Also check flat structure
        const partNumber = icInfo.part_number || item.part_number || 'UNKNOWN';
        const manufacturer = icInfo.manufacturer || item.manufacturer || 'UNKNOWN';
        const processedDate = item.processed_date ? new Date(item.processed_date) : new Date();
        const dateStr = processedDate.toLocaleDateString();
        const timeStr = processedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Get thumbnail image URL - check both nested and flat structure
        let thumbnailUrl = 'assets/logo.png';
        if (filePaths.thumbnail) {
          thumbnailUrl = `/api_results/${filePaths.thumbnail}`;
        } else if (item.thumbnail) {
          thumbnailUrl = `/api_results/${item.thumbnail}`;
        }

        const li = document.createElement('li');
        li.className = 'suspicious-ic-card';
        li.dataset.sessionId = item.session_id;
        li.onclick = () => openSuspiciousICModal(item);
        
        li.innerHTML = `
          <div class="suspicious-ic-preview">
            <img src="${thumbnailUrl}" alt="${partNumber}" onerror="this.src='assets/logo.png'; this.onerror=null;">
          </div>
          <div class="suspicious-ic-details">
            <div class="suspicious-ic-name">${escapeHtml(partNumber)}</div>
            <div class="suspicious-ic-manufacturer">${escapeHtml(manufacturer)}</div>
            <div class="suspicious-ic-date">${dateStr} ${timeStr}</div>
          </div>
        `;
        
        tasksList.appendChild(li);
      });

      // Update pending count
      const updatePendingCount = () => {
        const pendingCountEl = document.getElementById('pendingCount');
        if (pendingCountEl) {
          pendingCountEl.textContent = suspiciousICs.length;
        }
      };
      
      updatePendingCount();
      setTimeout(updatePendingCount, 500);
      
      // If updatePendingCountAfterTranslation function exists, use it
      if (typeof window.updatePendingCountAfterTranslation === 'function') {
        window.updatePendingCountAfterTranslation(suspiciousICs.length);
      }
      console.log(`[Dashboard] Loaded ${suspiciousICs.length} suspicious IC(s)`);
    } else {
      // No suspicious ICs
      console.log('[Dashboard] No suspicious ICs found');
      tasksList.innerHTML = `
        <li class="empty-task">
          <div class="muted">No suspicious ICs pending review</div>
        </li>
      `;
    }
  } catch (error) {
    console.error('[Dashboard] Error loading suspicious ICs:', error);
    const tasksList = document.getElementById('upcomingTasksList');
    if (tasksList) {
      tasksList.innerHTML = `
        <li class="empty-task">
          <div class="muted">Error loading suspicious ICs</div>
        </li>
      `;
    }
  }
}

/**
 * Open modal for reviewing a suspicious IC
 */
function openSuspiciousICModal(item) {
  const modal = document.getElementById('suspiciousICModal');
  if (!modal) {
    console.error('[Dashboard] Suspicious IC modal not found');
    return;
  }

  const icInfo = item.ic_info || {};
  const filePaths = item.file_paths || {};
  const partNumber = icInfo.part_number || 'UNKNOWN';
  const manufacturer = icInfo.manufacturer || 'UNKNOWN';
  const processedDate = item.processed_date ? new Date(item.processed_date) : new Date();
  const dateStr = processedDate.toLocaleDateString();
  const timeStr = processedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Get image URL
  const imageUrl = filePaths.primary_image || filePaths.thumbnail;
  const fullImageUrl = imageUrl 
    ? `/api_results/${imageUrl}`
    : 'assets/logo.png';

  // Get PDF URL
  const pdfUrl = filePaths.datasheet;
  const fullPdfUrl = pdfUrl 
    ? `/api_results/${pdfUrl}`
    : null;

  // Set modal content
  const modalTitle = modal.querySelector('.suspicious-modal-title');
  if (modalTitle) {
    modalTitle.textContent = `${partNumber} - ${manufacturer}`;
  }

  const modalDate = modal.querySelector('.suspicious-modal-date');
  if (modalDate) {
    modalDate.textContent = `Processed: ${dateStr} ${timeStr}`;
  }

  const modalImage = modal.querySelector('.suspicious-modal-image img');
  if (modalImage) {
    modalImage.src = fullImageUrl;
    modalImage.alt = partNumber;
    modalImage.onerror = function() {
      this.src = 'assets/logo.png';
      this.onerror = null;
    };
  }

  const pdfViewer = modal.querySelector('.suspicious-modal-pdf iframe');
  const pdfPlaceholder = modal.querySelector('.suspicious-modal-pdf-placeholder');
  if (fullPdfUrl) {
    if (pdfViewer) {
      pdfViewer.src = fullPdfUrl;
      pdfViewer.style.display = 'block';
    }
    if (pdfPlaceholder) {
      pdfPlaceholder.style.display = 'none';
    }
  } else {
    if (pdfViewer) {
      pdfViewer.style.display = 'none';
    }
    if (pdfPlaceholder) {
      pdfPlaceholder.style.display = 'block';
    }
  }

  // Set session ID for verdict buttons
  const verdictButtons = modal.querySelectorAll('.suspicious-modal-verdict-btn');
  verdictButtons.forEach(btn => {
    btn.dataset.sessionId = item.session_id;
  });

  // Initialize annotation tool for this modal
  const imageContainer = modal.querySelector('#suspiciousModalImageContainer');
  const annotationImage = modal.querySelector('#suspiciousModalImage');
  const annotateBtn = modal.querySelector('#suspiciousModalAnnotateBtn');
  
  if (imageContainer && annotationImage && typeof AnnotationTool !== 'undefined') {
    // Clean up any existing annotation tool
    if (window.suspiciousModalAnnotationTool) {
      window.suspiciousModalAnnotationTool.disable();
      window.suspiciousModalAnnotationTool = null;
    }
    
    // Wait for image to load before initializing annotation tool
    annotationImage.onload = function() {
      // Ensure container has proper positioning
      if (window.getComputedStyle(imageContainer).position === 'static') {
        imageContainer.style.position = 'relative';
      }
      
      // Initialize annotation tool
      if (!imageContainer.id) {
        imageContainer.id = 'suspiciousModalImageContainer-' + Date.now();
      }
      
      window.suspiciousModalAnnotationTool = new AnnotationTool(annotationImage, imageContainer.id);
      
      // Load existing annotations for this session
      if (item.session_id) {
        window.suspiciousModalAnnotationTool.loadAnnotations(item.session_id, fullImageUrl);
      }
      
      // Setup annotation button
      if (annotateBtn) {
        annotateBtn.onclick = () => {
          if (!window.suspiciousModalAnnotationTool) return;
          
          if (window.suspiciousModalAnnotationTool.enabled) {
            window.suspiciousModalAnnotationTool.disable();
            annotateBtn.textContent = '📝 Annotate Image';
            annotateBtn.classList.remove('active');
          } else {
            window.suspiciousModalAnnotationTool.enable();
            annotateBtn.textContent = '✓ Stop Annotating';
            annotateBtn.classList.add('active');
          }
        };
      }
    };
    
    // If image already loaded, trigger onload
    if (annotationImage.complete) {
      annotationImage.onload();
    }
  }

  // Show modal
  modal.style.display = 'flex';
}

/**
 * Toggle annotation mode in suspicious IC modal
 */
function toggleSuspiciousModalAnnotation() {
  const annotateBtn = document.getElementById('suspiciousModalAnnotateBtn');
  if (!window.suspiciousModalAnnotationTool || !annotateBtn) return;
  
  if (window.suspiciousModalAnnotationTool.enabled) {
    window.suspiciousModalAnnotationTool.disable();
    annotateBtn.textContent = '📝 Annotate Image';
    annotateBtn.classList.remove('active');
  } else {
    window.suspiciousModalAnnotationTool.enable();
    annotateBtn.textContent = '✓ Stop Annotating';
    annotateBtn.classList.add('active');
  }
}

window.toggleSuspiciousModalAnnotation = toggleSuspiciousModalAnnotation;

/**
 * Close suspicious IC modal
 */
function closeSuspiciousICModal() {
  const modal = document.getElementById('suspiciousICModal');
  if (modal) {
    // Disable annotation tool when closing modal
    if (window.suspiciousModalAnnotationTool) {
      window.suspiciousModalAnnotationTool.disable();
      const annotateBtn = modal.querySelector('#suspiciousModalAnnotateBtn');
      if (annotateBtn) {
        annotateBtn.textContent = '📝 Annotate Image';
        annotateBtn.classList.remove('active');
      }
    }
    modal.style.display = 'none';
  }
}

// Setup modal click handlers to prevent closing when clicking inside
function setupSuspiciousICModal() {
  const modal = document.getElementById('suspiciousICModal');
  if (!modal) return;
  
  const overlay = modal.querySelector('.modal-overlay');
  const content = modal.querySelector('.suspicious-modal-content');
  
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeSuspiciousICModal();
      }
    });
  }
  
  if (content) {
    content.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }
}

/**
 * Handle verdict button click (Counterfeit or Authentic)
 */
async function handleManualVerdict(sessionId, verdict) {
  try {
    const response = await fetch(`/api/history/${sessionId}/verdict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        verdict: verdict,
        manually_reviewed: true
      })
    });

    const data = await response.json();

    if (data.status === 'success') {
      // Close modal
      closeSuspiciousICModal();
      
      // Reload suspicious ICs list
      await loadSuspiciousICs();
      
      // Update KPIs
      if (typeof window.updateKPIsFromHistory === 'function') {
        window.updateKPIsFromHistory();
      }

      // Show success message
      alert(`IC marked as ${verdict} (manually reviewed)`);
    } else {
      throw new Error(data.error || 'Failed to update verdict');
    }
  } catch (error) {
    console.error('[Dashboard] Error updating verdict:', error);
    alert('Error updating verdict: ' + error.message);
  }
}

// Expose functions globally
window.openSuspiciousICModal = openSuspiciousICModal;
window.closeSuspiciousICModal = closeSuspiciousICModal;
window.handleManualVerdict = handleManualVerdict;
window.loadSuspiciousICs = loadSuspiciousICs;
window.setupSuspiciousICModal = setupSuspiciousICModal;

// Setup modal click handlers on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupSuspiciousICModal();
  });
} else {
  setupSuspiciousICModal();
}

// Share Analysis functionality
let shareContacts = [];
let selectedContacts = new Set();
let selectedLots = new Set();

// Load contacts from localStorage
function loadContacts() {
  try {
    const saved = localStorage.getItem('authentIC_shareContacts');
    if (saved) {
      shareContacts = JSON.parse(saved);
    }
  } catch (error) {
    console.error('[Dashboard] Error loading contacts:', error);
    shareContacts = [];
  }
  renderContacts();
}

// Save contacts to localStorage
function saveContacts() {
  try {
    localStorage.setItem('authentIC_shareContacts', JSON.stringify(shareContacts));
  } catch (error) {
    console.error('[Dashboard] Error saving contacts:', error);
  }
}

// Render contacts in the share suggestions container
function renderContacts() {
  const container = document.getElementById('shareSuggestions');
  if (!container) return;

  // Clear existing contacts (keep add recipient button)
  const addButton = container.querySelector('.add-recipient-item');
  container.innerHTML = '';
  
  // Render all contacts
  shareContacts.forEach((contact, index) => {
    const initials = getInitials(contact.name);
    const isSelected = selectedContacts.has(contact.email);
    
    const contactDiv = document.createElement('div');
    contactDiv.className = `share-item ${isSelected ? 'selected' : ''}`;
    contactDiv.innerHTML = `
      <input type="checkbox" class="share-item-checkbox" ${isSelected ? 'checked' : ''} 
             onchange="toggleContactSelection('${contact.email}', this.checked)">
      <div class="share-avatar">${initials}</div>
      <div class="share-info">
        <div class="share-name">${escapeHtml(contact.name)}</div>
        <div class="share-role">${escapeHtml(contact.position || '')}${contact.position && contact.email ? ' • ' : ''}${escapeHtml(contact.email)}</div>
      </div>
      <button class="share-btn" onclick="event.stopPropagation(); removeContact('${contact.email}')" title="Remove contact">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;
    container.appendChild(contactDiv);
  });
  
  // Re-add the add recipient button
  if (addButton) {
    container.appendChild(addButton);
  }
  
  updateShareActions();
}

// Get initials from name
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// Toggle contact selection
window.toggleContactSelection = function(email, isSelected) {
  if (isSelected) {
    selectedContacts.add(email);
  } else {
    selectedContacts.delete(email);
  }
  renderContacts();
  loadShareLots();
};

// Remove contact
window.removeContact = function(email) {
  if (confirm('Are you sure you want to remove this contact?')) {
    shareContacts = shareContacts.filter(c => c.email !== email);
    selectedContacts.delete(email);
    saveContacts();
    renderContacts();
    loadShareLots();
  }
};

// Open add recipient modal
window.openAddRecipientModal = function() {
  const modal = document.getElementById('addRecipientModal');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('recipientName').focus();
  }
};

// Close add recipient modal
window.closeAddRecipientModal = function() {
  const modal = document.getElementById('addRecipientModal');
  if (modal) {
    modal.style.display = 'none';
    document.getElementById('addRecipientForm').reset();
  }
};

// Add recipient
window.addRecipient = function() {
  const name = document.getElementById('recipientName').value.trim();
  const position = document.getElementById('recipientPosition').value.trim();
  const email = document.getElementById('recipientEmail').value.trim().toLowerCase();
  
  if (!name || !email) {
    alert('Please fill in name and email fields.');
    return;
  }
  
  // Validate email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    alert('Please enter a valid email address.');
    return;
  }
  
  // Check if contact already exists
  if (shareContacts.some(c => c.email === email)) {
    alert('A contact with this email already exists.');
    return;
  }
  
  // Add contact
  shareContacts.push({ name, position, email });
  saveContacts();
  renderContacts();
  closeAddRecipientModal();
};

// Load processing history lots for sharing
async function loadShareLots() {
  const lotsSection = document.getElementById('shareLotsSection');
  const lotsList = document.getElementById('shareLotsList');
  
  if (!lotsSection || !lotsList) return;
  
  // Only show if contacts are selected
  if (selectedContacts.size === 0) {
    lotsSection.style.display = 'none';
    updateShareActions();
    return;
  }
  
  lotsSection.style.display = 'block';
  updateShareActions();
  lotsList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">Loading lots...</div>';
  
  try {
    const response = await fetch('/api/history');
    const data = await response.json();
    
    if (data.status === 'success' && data.history && data.history.length > 0) {
      lotsList.innerHTML = '';
      
      data.history.forEach(item => {
        const icInfo = item.ic_info || {};
        const partNumber = icInfo.part_number || item.part_number || 'UNKNOWN';
        const manufacturer = icInfo.manufacturer || item.manufacturer || 'UNKNOWN';
        const verdict = item.verdict || 'UNKNOWN';
        const processedDate = item.processed_date ? new Date(item.processed_date) : new Date();
        const dateStr = processedDate.toLocaleDateString();
        const timeStr = processedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const sessionId = item.session_id;
        
        const isSelected = selectedLots.has(sessionId);
        
        const lotItem = document.createElement('div');
        lotItem.className = 'share-lot-item';
        lotItem.innerHTML = `
          <input type="checkbox" class="share-lot-checkbox" ${isSelected ? 'checked' : ''}
                 onchange="toggleLotSelection('${sessionId}', this.checked)">
          <div class="share-lot-info">
            <div class="share-lot-name">${escapeHtml(partNumber)} - ${escapeHtml(manufacturer)}</div>
            <div class="share-lot-details">Verdict: ${escapeHtml(verdict)} • Processed: ${dateStr} ${timeStr}</div>
          </div>
        `;
        lotsList.appendChild(lotItem);
      });
      
      if (data.history.length === 0) {
        lotsList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">No processing history available</div>';
      }
    } else {
      lotsList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">No processing history available</div>';
    }
  } catch (error) {
    console.error('[Dashboard] Error loading share lots:', error);
    lotsList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">Error loading processing history</div>';
  }
}

// Toggle lot selection
window.toggleLotSelection = function(sessionId, isSelected) {
  if (isSelected) {
    selectedLots.add(sessionId);
  } else {
    selectedLots.delete(sessionId);
  }
  updateShareActions();
};

// Update share actions button state
function updateShareActions() {
  const shareBtn = document.getElementById('shareSelectedBtn');
  
  if (!shareBtn) return;
  
  const hasSelection = selectedContacts.size > 0 && selectedLots.size > 0;
  
  if (hasSelection) {
    shareBtn.disabled = false;
    const lotText = selectedLots.size === 1 ? 'lot' : 'lots';
    const contactText = selectedContacts.size === 1 ? 'contact' : 'contacts';
    shareBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
        <polyline points="16 6 12 2 8 6"></polyline>
        <line x1="12" y1="2" x2="12" y2="15"></line>
      </svg>
      Send ${selectedLots.size} ${lotText} to ${selectedContacts.size} ${contactText}
    `;
  } else {
    shareBtn.disabled = true;
    shareBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
        <polyline points="16 6 12 2 8 6"></polyline>
        <line x1="12" y1="2" x2="12" y2="15"></line>
      </svg>
      Send Analysis
    `;
  }
}

// Share selected analysis
window.shareSelectedAnalysis = async function() {
  if (selectedContacts.size === 0 || selectedLots.size === 0) {
    alert('Please select at least one contact and one processing lot.');
    return;
  }
  
  const contacts = Array.from(selectedContacts).map(email => {
    return shareContacts.find(c => c.email === email);
  }).filter(Boolean);
  
  const lots = Array.from(selectedLots);
  
  // Show confirmation
  const confirmMsg = `Share ${lots.length} processing lot(s) with ${contacts.length} contact(s)?\n\nContacts:\n${contacts.map(c => `  - ${c.name} (${c.email})`).join('\n')}`;
  
  if (!confirm(confirmMsg)) {
    return;
  }
  
  // Show loading state
  const shareBtn = document.getElementById('shareSelectedBtn');
  const originalBtnHTML = shareBtn.innerHTML;
  shareBtn.disabled = true;
  shareBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="60" stroke-dashoffset="30"/>
    </svg>
    Sending...
  `;
  
  try {
    const response = await fetch('/api/share-analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contacts: contacts,
        session_ids: lots
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.status === 'success') {
      const sentCount = data.emails_sent || contacts.length;
      const failedCount = data.emails_failed || 0;
      
      let message = `Successfully sent analysis reports!\n\n`;
      message += `Emails sent: ${sentCount}\n`;
      if (failedCount > 0) {
        message += `Failed: ${failedCount}\n`;
      }
      message += `\nRecipients:\n${contacts.map(c => `  - ${c.name} (${c.email})`).join('\n')}`;
      
      alert(message);
      
      // Clear selections
      selectedContacts.clear();
      selectedLots.clear();
      renderContacts();
      loadShareLots();
    } else {
      throw new Error(data.error || 'Failed to share analysis');
    }
  } catch (error) {
    console.error('[Dashboard] Error sharing analysis:', error);
    alert(`Error sending analysis reports: ${error.message}\n\nPlease check your SMTP configuration or try again later.`);
  } finally {
    // Restore button state
    updateShareActions();
  }
};

// Close modal on overlay click
(function setupShareModal() {
  function setupModalHandlers() {
    const modal = document.getElementById('addRecipientModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeAddRecipientModal();
        }
      });
    }
    
    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('addRecipientModal');
        if (modal && modal.style.display === 'flex') {
          closeAddRecipientModal();
        }
      }
    });
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupModalHandlers);
  } else {
    setupModalHandlers();
  }
})();

// Setup handlers on page load (in case DOM is already loaded)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupLogout();
    setupLanguageDropdown();
    setupSidebarResizer();
    loadContacts();
    // Only setup search overlay for personal users (business users don't have chats)
    const userType = localStorage.getItem('authentIC_userType');
    if (userType !== 'business') {
      setupSearchOverlay();
    }
  });
} else {
  setupLogout();
  setupLanguageDropdown();
  setupSidebarResizer();
  loadContacts();
  // Only setup search overlay for personal users (business users don't have chats)
  const userType = localStorage.getItem('authentIC_userType');
  if (userType !== 'business') {
    setupSearchOverlay();
  }
}
