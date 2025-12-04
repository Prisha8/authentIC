// chat-service.js - Supabase chat operations
// This module handles all database operations for chats and messages

class ChatService {
  constructor() {
    console.log('[ChatService] Initializing...');
    if (typeof supabase === 'undefined') {
      console.error('[ChatService] ERROR: Supabase client not initialized');
      throw new Error('Supabase client not initialized');
    }
    this.supabase = supabase;
    console.log('[ChatService] Initialized successfully');
  }

  // Get current user ID from session
  async getCurrentUserId() {
    const { data: { session }, error } = await this.supabase.auth.getSession();
    if (error || !session) {
      throw new Error('User not authenticated');
    }
    return session.user.id;
  }

  // Create a new chat
  async createChat(title = 'New Chat') {
    console.log('[ChatService] Creating new chat with title:', title);
    try {
      const userId = await this.getCurrentUserId();
      console.log('[ChatService] User ID:', userId);
      
      const { data, error } = await this.supabase
        .from('chats')
        .insert([
          {
            user_id: userId,
            title: title,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ])
        .select()
        .single();

      if (error) {
        console.error('[ChatService] Error creating chat:', error);
        throw error;
      }
      
      console.log('[ChatService] Chat created successfully:', data);
      return data;
    } catch (error) {
      console.error('[ChatService] Error creating chat:', error);
      throw error;
    }
  }

  // Get all chats for the current user
  async getUserChats() {
    console.log('[ChatService] Fetching user chats...');
    try {
      const userId = await this.getCurrentUserId();
      console.log('[ChatService] User ID:', userId);
      
      const { data, error } = await this.supabase
        .from('chats')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('[ChatService] Error fetching chats:', error);
        throw error;
      }
      
      console.log('[ChatService] Found', data?.length || 0, 'chats');
      return data || [];
    } catch (error) {
      console.error('[ChatService] Error fetching chats:', error);
      return [];
    }
  }

  // Get a single chat by ID
  async getChat(chatId) {
    try {
      const userId = await this.getCurrentUserId();
      const { data, error } = await this.supabase
        .from('chats')
        .select('*')
        .eq('id', chatId)
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching chat:', error);
      throw error;
    }
  }

  // Update chat title
  async updateChatTitle(chatId, newTitle) {
    try {
      const userId = await this.getCurrentUserId();
      const { data, error } = await this.supabase
        .from('chats')
        .update({
          title: newTitle,
          updated_at: new Date().toISOString()
        })
        .eq('id', chatId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error updating chat title:', error);
      throw error;
    }
  }

  // Save a message to a chat
  async saveMessage(chatId, role, content, imageUrl = null) {
    console.log('[ChatService] Saving message to chat:', chatId, 'Role:', role);
    try {
      const userId = await this.getCurrentUserId();
      
      // Verify chat belongs to user
      const chat = await this.getChat(chatId);
      if (!chat) {
        console.error('[ChatService] Chat not found or access denied');
        throw new Error('Chat not found or access denied');
      }

      const { data, error } = await this.supabase
        .from('messages')
        .insert([
          {
            chat_id: chatId,
            role: role, // 'user' or 'assistant'
            content: content,
            image_url: imageUrl,
            created_at: new Date().toISOString()
          }
        ])
        .select()
        .single();

      if (error) {
        console.error('[ChatService] Error saving message:', error);
        throw error;
      }

      console.log('[ChatService] Message saved successfully');

      // Update chat's updated_at timestamp
      await this.supabase
        .from('chats')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', chatId);

      return data;
    } catch (error) {
      console.error('[ChatService] Error saving message:', error);
      throw error;
    }
  }

  // Get all messages for a chat
  async getChatMessages(chatId) {
    try {
      const userId = await this.getCurrentUserId();
      
      // Verify chat belongs to user
      const chat = await this.getChat(chatId);
      if (!chat) {
        throw new Error('Chat not found or access denied');
      }

      const { data, error } = await this.supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching messages:', error);
      return [];
    }
  }

  // Delete a chat (and its messages via cascade if configured)
  async deleteChat(chatId) {
    try {
      const userId = await this.getCurrentUserId();
      const { error } = await this.supabase
        .from('chats')
        .delete()
        .eq('id', chatId)
        .eq('user_id', userId);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error deleting chat:', error);
      throw error;
    }
  }

  // Format time for display
  formatTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays}d`;
    } else {
      return date.toLocaleDateString();
    }
  }
}

// Export singleton instance
try {
  window.chatService = new ChatService();
  console.log('[ChatService] Global instance created and available at window.chatService');
} catch (error) {
  console.error('[ChatService] Failed to create global instance:', error);
  console.error('[ChatService] Make sure Supabase is initialized before loading this script');
}

