// notification-service.js - Manages notifications for the application

class NotificationService {
  constructor() {
    this.notifications = [];
    this.maxNotifications = 50; // Keep last 50 notifications
    this.loadNotifications();
    this.setupEventListeners();
  }

  // Load notifications from localStorage
  loadNotifications() {
    try {
      const stored = localStorage.getItem('authentIC_notifications');
      if (stored) {
        this.notifications = JSON.parse(stored);
        // Filter out old notifications (older than 7 days)
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        this.notifications = this.notifications.filter(n => n.timestamp > sevenDaysAgo);
        this.saveNotifications();
      }
    } catch (error) {
      console.error('[NotificationService] Error loading notifications:', error);
      this.notifications = [];
    }
  }

  // Save notifications to localStorage
  saveNotifications() {
    try {
      // Keep only the most recent notifications
      if (this.notifications.length > this.maxNotifications) {
        this.notifications = this.notifications.slice(-this.maxNotifications);
      }
      localStorage.setItem('authentIC_notifications', JSON.stringify(this.notifications));
    } catch (error) {
      console.error('[NotificationService] Error saving notifications:', error);
    }
  }

  // Add a new notification
  addNotification(title, message, type = 'info', action = null) {
    const notification = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      title: title,
      message: message,
      type: type, // 'info', 'success', 'warning', 'error'
      timestamp: Date.now(),
      read: false,
      action: action // Optional: { label: 'View', url: '/dashboard.html' }
    };

    this.notifications.unshift(notification); // Add to beginning
    this.saveNotifications();
    this.updateUI();
    
    // Trigger browser notification if permission granted
    this.showBrowserNotification(title, message);
    
    return notification.id;
  }

  // Mark notification as read
  markAsRead(notificationId) {
    const notification = this.notifications.find(n => n.id === notificationId);
    if (notification) {
      notification.read = true;
      this.saveNotifications();
      this.updateUI();
    }
  }

  // Mark all notifications as read
  markAllAsRead() {
    this.notifications.forEach(n => n.read = true);
    this.saveNotifications();
    this.updateUI();
  }

  // Delete a notification
  deleteNotification(notificationId) {
    this.notifications = this.notifications.filter(n => n.id !== notificationId);
    this.saveNotifications();
    this.updateUI();
  }

  // Clear all notifications
  clearAll() {
    this.notifications = [];
    this.saveNotifications();
    this.updateUI();
  }

  // Get unread count
  getUnreadCount() {
    return this.notifications.filter(n => !n.read).length;
  }

  // Update the UI (badge count and dropdown)
  updateUI() {
    const badge = document.getElementById('notificationBadge');
    const dropdown = document.getElementById('notificationDropdown');
    const list = document.getElementById('notificationList');
    const emptyState = document.getElementById('notificationEmpty');
    const clearBtn = document.getElementById('notificationClearBtn');

    // Update badge (only if it exists)
    const unreadCount = this.getUnreadCount();
    if (badge) {
      if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }

    // Update dropdown list (only if it exists)
    if (list) {
      list.innerHTML = '';
      
      if (this.notifications.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        if (clearBtn) clearBtn.style.display = 'none';
      } else {
        if (emptyState) emptyState.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'block';

        this.notifications.slice(0, 10).forEach(notification => {
          const item = this.createNotificationItem(notification);
          list.appendChild(item);
        });
      }
    }
  }

  // Create a notification item element
  createNotificationItem(notification) {
    const item = document.createElement('div');
    item.className = `notification-item ${notification.read ? 'read' : 'unread'}`;
    item.dataset.notificationId = notification.id;

    const timeAgo = this.getTimeAgo(notification.timestamp);
    const typeIcon = this.getTypeIcon(notification.type);

    item.innerHTML = `
      <div class="notification-item-content">
        <div class="notification-item-header">
          <div class="notification-item-icon">${typeIcon}</div>
          <div class="notification-item-title">${this.escapeHtml(notification.title)}</div>
          ${!notification.read ? '<div class="notification-dot"></div>' : ''}
        </div>
        <div class="notification-item-message">${this.escapeHtml(notification.message)}</div>
        <div class="notification-item-footer">
          <span class="notification-item-time">${timeAgo}</span>
          ${notification.action ? `<button class="notification-action-btn" data-action-url="${notification.action.url}">${this.escapeHtml(notification.action.label)}</button>` : ''}
        </div>
      </div>
      <button class="notification-delete-btn" onclick="window.notificationService.deleteNotification('${notification.id}')" aria-label="Delete notification">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;

    // Add click handler to mark as read and handle action
    item.addEventListener('click', (e) => {
      if (e.target.closest('.notification-delete-btn')) return;
      if (e.target.closest('.notification-action-btn')) {
        const actionBtn = e.target.closest('.notification-action-btn');
        const url = actionBtn.dataset.actionUrl;
        if (url) {
          window.location.href = url;
        }
        return;
      }
      
      if (!notification.read) {
        this.markAsRead(notification.id);
      }
    });

    return item;
  }

  // Get time ago string
  getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }

  // Get icon for notification type
  getTypeIcon(type) {
    const icons = {
      info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
      success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
      warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
      error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>'
    };
    return icons[type] || icons.info;
  }

  // Escape HTML to prevent XSS
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Show browser notification (if permission granted)
  async showBrowserNotification(title, message) {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      new Notification(title, {
        body: message,
        icon: '/assets/logo.png',
        badge: '/assets/logo.png'
      });
    } else if (Notification.permission !== 'denied') {
      // Request permission (but don't show notification immediately)
      Notification.requestPermission();
    }
  }

  // Setup event listeners
  setupEventListeners() {
    // Toggle dropdown when bell button is clicked
    document.addEventListener('click', (e) => {
      const bellBtn = e.target.closest('#notificationBtn, #notificationBtn *');
      const dropdown = document.getElementById('notificationDropdown');
      
      if (bellBtn && dropdown) {
        e.stopPropagation();
        const isVisible = dropdown.style.display === 'block';
        dropdown.style.display = isVisible ? 'none' : 'block';
        
        // Mark all as read when opening
        if (!isVisible) {
          this.markAllAsRead();
        }
      } else if (dropdown && !dropdown.contains(e.target)) {
        // Close dropdown when clicking outside
        dropdown.style.display = 'none';
      }
    });

    // Close dropdown on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const dropdown = document.getElementById('notificationDropdown');
        if (dropdown) {
          dropdown.style.display = 'none';
        }
      }
    });
  }

  // Initialize - call this when DOM is ready
  init() {
    this.updateUI();
    
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      // Don't request immediately, let user interact first
      // Notification.requestPermission();
    }
  }
}

// Create global instance
window.notificationService = new NotificationService();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.notificationService.init();
  });
} else {
  window.notificationService.init();
}

