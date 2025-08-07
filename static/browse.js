class BrowseApp {
    constructor() {
        this.entries = [];
        this.filteredEntries = [];
        this.initializeElements();
        this.attachEventListeners();
        this.loadEntries();
    }

    initializeElements() {
        this.entriesContainer = document.getElementById('entriesContainer');
        this.dateFilter = document.getElementById('dateFilter');
        this.clearFilterBtn = document.getElementById('clearFilter');
        this.clearDatabaseBtn = document.getElementById('clearDatabase');
    }

    attachEventListeners() {
        this.dateFilter.addEventListener('change', () => this.filterByDate());
        this.clearFilterBtn.addEventListener('click', () => this.clearFilter());
        this.clearDatabaseBtn.addEventListener('click', () => this.clearDatabase());
    }

    async loadEntries() {
        try {
            this.showLoading();
            
            const response = await fetch('/entries');
            if (!response.ok) {
                throw new Error('Failed to load entries');
            }

            this.entries = await response.json();
            this.filteredEntries = [...this.entries];
            this.renderEntries();
            
        } catch (error) {
            console.error('Error loading entries:', error);
            this.showError('Failed to load journal entries. Please try again.');
        }
    }

    async filterByDate() {
        const selectedDate = this.dateFilter.value;
        if (!selectedDate) return;

        try {
            this.showLoading();
            
            const response = await fetch(`/entries?date_filter=${selectedDate}`);
            if (!response.ok) {
                throw new Error('Failed to filter entries');
            }

            this.filteredEntries = await response.json();
            this.renderEntries();
            
        } catch (error) {
            console.error('Error filtering entries:', error);
            this.showError('Failed to filter entries. Please try again.');
        }
    }

    clearFilter() {
        this.dateFilter.value = '';
        this.filteredEntries = [...this.entries];
        this.renderEntries();
    }

    async clearDatabase() {
        // Confirm with user
        const confirmed = confirm('Are you sure you want to clear ALL journal entries? This action cannot be undone.');
        if (!confirmed) return;

        // Double confirmation for safety
        const doubleConfirmed = confirm('This will permanently delete all your journal entries and conversations. Are you absolutely sure?');
        if (!doubleConfirmed) return;

        try {
            this.showLoading();
            
            const response = await fetch('/api/clear-database', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            const result = await response.json();
            
            if (result.success) {
                // Clear local data
                this.entries = [];
                this.filteredEntries = [];
                this.dateFilter.value = '';
                
                // Show success message
                this.entriesContainer.innerHTML = `
                    <div class="no-entries" style="color: #38a169;">
                        ✅ Database cleared successfully! All journal entries have been deleted.
                    </div>
                `;
                
                // Show confirmation for a few seconds, then show empty state
                setTimeout(() => {
                    this.showNoEntries();
                }, 3000);
                
            } else {
                throw new Error(result.error || 'Failed to clear database');
            }
            
        } catch (error) {
            console.error('Error clearing database:', error);
            this.showError('Failed to clear database. Please try again.');
        }
    }

    renderEntries() {
        if (this.filteredEntries.length === 0) {
            this.showNoEntries();
            return;
        }

        const entriesHTML = this.filteredEntries.map(entry => this.createEntryHTML(entry)).join('');
        this.entriesContainer.innerHTML = entriesHTML;
    }

    createEntryHTML(entry) {
        const date = new Date(entry.created_at).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const time = new Date(entry.created_at).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });

        // Create conversation HTML if AI prompts exist
        let conversationHTML = '';
        if (entry.ai_prompts && entry.ai_prompts.length > 0) {
            conversationHTML = `
                <div class="conversation">
                    ${entry.ai_prompts.map(prompt => {
                        // Handle different data formats
                        if (prompt.user && prompt.ai) {
                            // Regular chat format
                            return `
                                <div class="conversation-item user">
                                    <strong>You:</strong> ${this.formatText(prompt.user)}
                                </div>
                                <div class="conversation-item ai">
                                    <strong>AI:</strong> ${this.formatText(prompt.ai)}
                                </div>
                            `;
                        } else if (prompt.role && prompt.content) {
                            // Voice transcript format
                            const roleLabel = prompt.role === 'user' ? 'You:' : 'AI:';
                            const itemClass = prompt.role === 'user' ? 'user' : 'ai';
                            return `
                                <div class="conversation-item ${itemClass}">
                                    <strong>${roleLabel}</strong> ${this.formatText(prompt.content)}
                                </div>
                            `;
                        } else {
                            // Unknown format, skip
                            return '';
                        }
                    }).filter(html => html).join('')}
                </div>
            `;
        }

        return `
            <div class="entry-card">
                <div class="entry-header">
                    <div class="entry-date">${date} at ${time}</div>
                    <div class="entry-type ${entry.type}">${entry.type}</div>
                </div>
                <div class="entry-content">
                    ${this.formatText(entry.content)}
                    ${conversationHTML}
                </div>
            </div>
        `;
    }

    formatText(text) {
        // Handle null/undefined text
        if (!text || typeof text !== 'string') {
            return '';
        }
        
        // Basic text formatting - convert line breaks and escape HTML
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
    }

    showLoading() {
        this.entriesContainer.innerHTML = '<div class="loading">Loading entries...</div>';
    }

    showError(message) {
        this.entriesContainer.innerHTML = `<div class="loading">${message}</div>`;
    }

    showNoEntries() {
        const message = this.dateFilter.value ? 
            'No entries found for the selected date.' : 
            'No journal entries yet. Start journaling to see your entries here!';
        
        this.entriesContainer.innerHTML = `<div class="no-entries">${message}</div>`;
    }
}

// Initialize the browse app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new BrowseApp();
});
