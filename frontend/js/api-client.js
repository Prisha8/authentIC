// API Client for Counterfeit IC Detection Backend
// Handles communication with Flask API server

const API_BASE_URL = 'http://localhost:5001/api';

class ICDetectionAPI {
  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  /**
   * Upload IC image and run detection
   * @param {File} imageFile - The IC image file
   * @returns {Promise<Object>} Detection result
   */
  async detectIC(imageFile) {
    const formData = new FormData();
    formData.append('image', imageFile);

    try {
      // Increase timeout to 5 minutes (long detections with Gemini + PDF generation)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 300 seconds

      const response = await fetch(`${this.baseUrl}/detect`, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Detection failed' }));
        throw new Error(error.error || 'Detection failed');
      }

      return await response.json();
    } catch (error) {
      console.error('[API] Detection error:', error);
      if (error.name === 'AbortError') {
        throw new Error('Request timed out. Detection is taking longer than expected.');
      }
      throw error;
    }
  }

  /**
   * Get session status
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Session status
   */
  async getSession(sessionId) {
    try {
      const response = await fetch(`${this.baseUrl}/session/${sessionId}`);
      
      if (!response.ok) {
        throw new Error('Session not found');
      }

      return await response.json();
    } catch (error) {
      console.error('[API] Session error:', error);
      throw error;
    }
  }

  /**
   * Get PDF report download URL
   * @param {string} sessionId - Session ID
   * @returns {string} Download URL
   */
  getReportURL(sessionId) {
    return `${this.baseUrl}/report/${sessionId}`;
  }

  /**
   * Download PDF report
   * @param {string} sessionId - Session ID
   */
  async downloadReport(sessionId) {
    const url = this.getReportURL(sessionId);
    window.open(url, '_blank');
  }

  /**
   * Health check
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return await response.json();
    } catch (error) {
      console.error('[API] Health check failed:', error);
      return { status: 'unhealthy', error: error.message };
    }
  }
}

// Create global instance
window.icDetectionAPI = new ICDetectionAPI();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ICDetectionAPI;
}

