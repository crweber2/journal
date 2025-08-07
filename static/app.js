class JournalApp {
    constructor() {
        this.currentSessionType = 'reflection';
        this.isLoading = false;
        this.initializeElements();
        this.attachEventListeners();
    }

    initializeElements() {
        this.messagesContainer = document.getElementById('messages');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.navBtns = document.querySelectorAll('.nav-btn[data-type]');
        this.newSessionBtn = document.getElementById('newSessionBtn');
        this.voiceBtn = document.getElementById('voiceBtn');
    }

    attachEventListeners() {
        // Send message on button click
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        
        // Send message on Enter (but allow Shift+Enter for new lines)
        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Navigation buttons
        this.navBtns.forEach(btn => {
            btn.addEventListener('click', () => this.switchSessionType(btn.dataset.type));
        });

        // New session button
        this.newSessionBtn.addEventListener('click', () => this.startNewSession());

        // Voice button (placeholder for now)
        this.voiceBtn.addEventListener('click', () => {
            alert('Voice input coming soon! For now, you can type your thoughts.');
        });

        // Auto-resize textarea
        this.messageInput.addEventListener('input', () => {
            this.messageInput.style.height = 'auto';
            this.messageInput.style.height = this.messageInput.scrollHeight + 'px';
        });
    }

    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message || this.isLoading) return;

        // Add user message to chat
        this.addMessage(message, 'user');
        this.messageInput.value = '';
        this.messageInput.style.height = 'auto';
        
        // Show loading state
        this.setLoading(true);

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    type: this.currentSessionType
                })
            });

            if (!response.ok) {
                throw new Error('Failed to get response');
            }

            const data = await response.json();
            
            // Add AI response to chat
            this.addMessage(data.response, 'ai', data.timestamp);
            
        } catch (error) {
            console.error('Error sending message:', error);
            this.addMessage(
                "I'm having trouble connecting right now. Please try again in a moment.", 
                'ai'
            );
        } finally {
            this.setLoading(false);
        }
    }

    addMessage(content, type, timestamp = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.innerHTML = `<p>${this.formatMessage(content)}</p>`;
        
        const messageTime = document.createElement('div');
        messageTime.className = 'message-time';
        messageTime.textContent = timestamp ? 
            new Date(timestamp).toLocaleTimeString() : 
            new Date().toLocaleTimeString();
        
        messageDiv.appendChild(messageContent);
        messageDiv.appendChild(messageTime);
        
        this.messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    }

    formatMessage(message) {
        // Basic formatting - convert line breaks to <br>
        return message.replace(/\n/g, '<br>');
    }

    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    setLoading(loading) {
        this.isLoading = loading;
        this.sendBtn.disabled = loading;
        this.messageInput.disabled = loading;
        
        if (loading) {
            this.sendBtn.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"></path>
                </svg>
            `;
        } else {
            this.sendBtn.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22,2 15,22 11,13 2,9"></polygon>
                </svg>
            `;
        }
    }

    switchSessionType(type) {
        if (type === this.currentSessionType) return;
        
        this.currentSessionType = type;
        
        // Update active nav button
        this.navBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === type);
        });
        
        // Start new session with the selected type
        this.startNewSession();
    }

    async startNewSession() {
        try {
            const response = await fetch('/start-session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    type: this.currentSessionType
                })
            });

            if (!response.ok) {
                throw new Error('Failed to start new session');
            }

            const data = await response.json();
            
            // Clear messages and add initial AI message
            this.messagesContainer.innerHTML = '';
            this.addMessage(data.message, 'ai');
            
        } catch (error) {
            console.error('Error starting new session:', error);
            // Fallback to default messages
            this.messagesContainer.innerHTML = '';
            const defaultMessages = {
                reflection: "Hi! I'm here to help you reflect on your day. What's been on your mind today?",
                planning: "Let's plan ahead! What are you thinking about for tomorrow or the coming days?",
                notes: "Ready for a brain dump? Tell me everything that's on your mind - I'll help you organize it.",
                goals: "Let's talk about your goals. What would you like to work on or review?"
            };
            this.addMessage(defaultMessages[this.currentSessionType], 'ai');
        }
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new JournalApp();
});
