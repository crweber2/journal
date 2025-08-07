class VoiceJournal {
    constructor() {
        this.openaiWebSocket = null;
        this.audioContext = null;
        this.audioWorkletNode = null;
        this.audioStream = null;
        this.isRecording = false;
        this.isPaused = false;
        this.isMuted = false;
        this.currentSessionType = null;
        this.conversationTranscript = [];
        
        // Silence detection
        this.silenceThreshold = 0.02; // Increased from 0.01 to reduce false positives
        this.silenceTimeout = null;
        this.silenceDuration = 1500; // 1.5 seconds of silence before commit
        this.lastAudioTime = 0;
        
        // Audio buffer management
        this.accumulatedBytes = 0;
        this.MIN_BUFFER_BYTES = 4800; // 100ms at 24kHz (minimum for OpenAI)
        this.isCommitting = false; // Prevent duplicate commits
        this.hasAudioInBuffer = false; // Track if we have any audio to commit
        
        // Audio playback queue
        this.nextPlayTime = 0;
        this.audioQueue = [];
        
        this.initializeElements();
        this.attachEventListeners();
        this.checkBrowserSupport();
    }

    initializeElements() {
        // Main containers
        this.sessionSelector = document.getElementById('sessionSelector');
        this.voiceInterface = document.getElementById('voiceInterface');
        this.loadingScreen = document.getElementById('loadingScreen');
        this.errorScreen = document.getElementById('errorScreen');
        
        // Status elements
        this.connectionStatus = document.getElementById('connectionStatus');
        this.statusDot = this.connectionStatus.querySelector('.status-dot');
        this.statusText = this.connectionStatus.querySelector('.status-text');
        this.voiceStatus = document.getElementById('voiceStatus');
        this.statusMessage = this.voiceStatus.querySelector('.status-message');
        
        // Controls
        this.sessionButtons = document.querySelectorAll('.session-btn');
        this.muteBtn = document.getElementById('muteBtn');
        this.pauseBtn = document.getElementById('pauseBtn');
        this.endBtn = document.getElementById('endBtn');
        this.retryBtn = document.getElementById('retryBtn');
        
        // Transcript
        this.transcriptScroll = document.getElementById('transcriptScroll');
        
        // Audio visualization
        this.audioVisualizer = document.getElementById('audioVisualizer');
        this.waves = this.audioVisualizer.querySelectorAll('.wave');
    }

    attachEventListeners() {
        // Session selection
        this.sessionButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.startVoiceSession(btn.dataset.type);
            });
        });

        // Control buttons
        this.muteBtn.addEventListener('click', () => this.toggleMute());
        this.pauseBtn.addEventListener('click', () => this.togglePause());
        this.endBtn.addEventListener('click', () => this.endSession());
        this.retryBtn.addEventListener('click', () => this.retry());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
                e.preventDefault();
                this.togglePause();
            } else if (e.code === 'KeyM' && e.ctrlKey) {
                e.preventDefault();
                this.toggleMute();
            } else if (e.code === 'Escape') {
                this.endSession();
            }
        });

        // Prevent accidental page refresh
        window.addEventListener('beforeunload', (e) => {
            if (this.openaiWebSocket && this.openaiWebSocket.readyState === WebSocket.OPEN) {
                e.preventDefault();
                e.returnValue = 'You have an active voice session. Are you sure you want to leave?';
            }
        });
    }

    checkBrowserSupport() {
        const unsupportedFeatures = [];
        
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            unsupportedFeatures.push('Microphone access');
        }
        
        if (!window.WebSocket) {
            unsupportedFeatures.push('WebSocket');
        }
        
        if (!window.AudioContext && !window.webkitAudioContext) {
            unsupportedFeatures.push('Web Audio API');
        }

        if (unsupportedFeatures.length > 0) {
            this.showError(`Your browser doesn't support: ${unsupportedFeatures.join(', ')}. Please use a modern browser like Chrome, Firefox, or Safari.`);
            return false;
        }
        
        return true;
    }

    async startVoiceSession(sessionType) {
        this.currentSessionType = sessionType;
        this.showLoading('Starting voice session...');
        
        try {
            // Setup audio first
            await this.setupAudio();
            
            // Connect to voice service
            await this.connectToVoiceService();
            
            // Configure the session
            await this.configureSession();
            
            // Start recording
            this.startRecording();
            
            // Show voice interface
            this.showVoiceInterface();
            
        } catch (error) {
            console.error('Failed to start voice session:', error);
            this.showError(error.message || 'Failed to start voice session');
        }
    }

    async setupAudio() {
        try {
            // Get microphone access
            this.audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 24000, // OpenAI prefers 24kHz
                    channelCount: 1
                }
            });

            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 24000
            });

            // Load the audio worklet processor
            await this.audioContext.audioWorklet.addModule('/static/processor.js');

            // Create audio worklet node
            this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'pcm-worklet');
            
            // Handle audio data from worklet
            this.audioWorkletNode.port.onmessage = (event) => {
                if (event.data.type === 'audioData' && this.isRecording && !this.isPaused) {
                    this.processAudioData(event.data.data);
                }
            };

            // Connect audio stream to worklet
            const source = this.audioContext.createMediaStreamSource(this.audioStream);
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 256;
            
            source.connect(analyser);
            source.connect(this.audioWorkletNode);
            this.audioWorkletNode.connect(this.audioContext.destination);

            // Start audio visualization
            this.startAudioVisualization(analyser);

        } catch (error) {
            throw new Error('Failed to setup audio: ' + error.message);
        }
    }

    async connectToVoiceService() {
        return new Promise((resolve, reject) => {
            console.log('Connecting to voice service...');
            
            // Connect to our server's WebSocket relay
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/voice`;
            
            this.openaiWebSocket = new WebSocket(wsUrl);
            this.setupWebSocketHandlers(resolve, reject);
        });
    }

    setupWebSocketHandlers(resolve, reject) {
        this.openaiWebSocket.onopen = () => {
            console.log('Connected to OpenAI Realtime API');
            this.updateConnectionStatus('connected', 'Connected');
            resolve();
        };

        this.openaiWebSocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleOpenAIMessage(data);
            } catch (error) {
                console.error('Failed to parse OpenAI message:', error);
            }
        };

        this.openaiWebSocket.onerror = (error) => {
            console.error('OpenAI WebSocket error:', error);
            reject(new Error('Failed to connect to OpenAI'));
        };

        this.openaiWebSocket.onclose = () => {
            console.log('OpenAI WebSocket closed');
            this.updateConnectionStatus('disconnected', 'Disconnected');
        };

        // Timeout after 10 seconds
        setTimeout(() => {
            if (this.openaiWebSocket.readyState !== WebSocket.OPEN) {
                reject(new Error('Connection timeout'));
            }
        }, 10000);
    }

    async configureSession() {
        // Send session type to server
        const sessionConfig = {
            session_type: this.currentSessionType
        };

        this.openaiWebSocket.send(JSON.stringify(sessionConfig));
        
        // The server will handle the OpenAI session configuration
        // and send us a "ready" message when it's done
    }

    processAudioData(float32Data) {
        if (!this.openaiWebSocket || this.openaiWebSocket.readyState !== WebSocket.OPEN) {
            return;
        }

        // Calculate max amplitude for silence detection
        const maxAmplitude = Math.max(...float32Data.map(Math.abs));
        const currentTime = Date.now();
        
        // Check if we have speech (above silence threshold)
        const hasSpeech = maxAmplitude > this.silenceThreshold;
        
        if (hasSpeech) {
            // Clear any pending silence timeout
            if (this.silenceTimeout) {
                clearTimeout(this.silenceTimeout);
                this.silenceTimeout = null;
            }
            
            this.lastAudioTime = currentTime;
            console.log(`Processing speech: ${float32Data.length} samples, amplitude: ${maxAmplitude.toFixed(4)}`);
            
            // Convert Float32 to PCM16
            const pcm16 = new Int16Array(float32Data.length);
            for (let i = 0; i < float32Data.length; i++) {
                const sample = Math.max(-1, Math.min(1, float32Data[i]));
                pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            }

            // Convert to base64
            const bytes = new Uint8Array(pcm16.buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64Audio = btoa(binary);

            // Track accumulated audio bytes
            this.accumulatedBytes += bytes.length;
            this.hasAudioInBuffer = true;

            // Send to OpenAI
            const audioMessage = {
                type: "input_audio_buffer.append",
                audio: base64Audio
            };

            this.openaiWebSocket.send(JSON.stringify(audioMessage));
            
            console.log(`Audio buffer: ${this.accumulatedBytes} bytes (need ${this.MIN_BUFFER_BYTES} minimum)`);
            
        } else if (this.lastAudioTime > 0 && !this.silenceTimeout) {
            // We had speech before, now we have silence - start silence timer
            console.log(`Silence detected, starting timer...`);
            this.silenceTimeout = setTimeout(() => {
                this.commitAudioBuffer();
            }, this.silenceDuration);
        }
    }

    commitAudioBuffer() {
        if (!this.openaiWebSocket || this.openaiWebSocket.readyState !== WebSocket.OPEN) {
            return;
        }
        
        // Check if we have sufficient audio to commit
        if (!this.hasAudioInBuffer || this.accumulatedBytes < this.MIN_BUFFER_BYTES) {
            console.log(`Skipping commit: insufficient audio (${this.accumulatedBytes} bytes, need ${this.MIN_BUFFER_BYTES})`);
            this.resetAudioBuffer();
            return;
        }
        
        console.log(`Committing audio buffer: ${this.accumulatedBytes} bytes`);
        this.updateStatusMessage('Processing your message...');
        
        // Commit the audio buffer
        this.openaiWebSocket.send(JSON.stringify({
            type: "input_audio_buffer.commit"
        }));
        
        // Trigger response generation
        this.openaiWebSocket.send(JSON.stringify({
            type: "response.create"
        }));
        
        // Reset audio buffer tracking
        this.resetAudioBuffer();
    }

    resetAudioBuffer() {
        // Reset audio buffer tracking
        this.accumulatedBytes = 0;
        this.hasAudioInBuffer = false;
        this.silenceTimeout = null;
        this.lastAudioTime = 0;
        console.log('Audio buffer tracking reset');
    }

    handleOpenAIMessage(data) {
        console.log('OpenAI message:', data.type);

        switch (data.type) {
            case 'ready':
                console.log('Voice session ready');
                this.updateStatusMessage('Listening... Start speaking!');
                break;

            case 'session.created':
                console.log('Session created');
                break;

            case 'session.updated':
                console.log('Session updated');
                break;

            case 'input_audio_buffer.speech_started':
                console.log('OpenAI detected speech start');
                break;

            case 'input_audio_buffer.speech_stopped':
                console.log('OpenAI detected speech stop (ignoring - using client-side detection)');
                // Don't process here - we're using client-side silence detection instead
                break;

            case 'conversation.item.input_audio_transcription.completed':
                const userTranscript = data.transcript;
                this.addTranscript('user', userTranscript);
                this.conversationTranscript.push({
                    role: 'user',
                    content: userTranscript,
                    timestamp: new Date().toISOString()
                });
                break;

            case 'response.audio.delta':
                if (data.delta && !this.isMuted) {
                    this.playAudioChunk(data.delta);
                }
                break;

            case 'response.audio.done':
                this.updateStatusMessage('Listening...');
                this.resetAudioPlayback(); // Reset for next response
                break;

            case 'response.text.done':
                const aiResponse = data.text;
                this.addTranscript('assistant', aiResponse);
                this.conversationTranscript.push({
                    role: 'assistant',
                    content: aiResponse,
                    timestamp: new Date().toISOString()
                });
                break;

            case 'error':
                console.error('OpenAI error:', data);
                this.showError('OpenAI error: ' + (data.error?.message || 'Unknown error'));
                break;
        }
    }

    async playAudioChunk(base64Audio) {
        try {
            // Decode base64 to binary
            const binaryString = atob(base64Audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Convert PCM16 to Float32 for Web Audio API
            const pcm16 = new Int16Array(bytes.buffer);
            const float32 = new Float32Array(pcm16.length);
            for (let i = 0; i < pcm16.length; i++) {
                float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7FFF);
            }

            // Create audio buffer
            const audioBuffer = this.audioContext.createBuffer(1, float32.length, 24000);
            audioBuffer.copyToChannel(float32, 0);

            // Initialize nextPlayTime if not set
            if (this.nextPlayTime === 0) {
                this.nextPlayTime = this.audioContext.currentTime + 0.05; // 50ms lead-in
            }

            // Create source and schedule it at the cursor position
            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.audioContext.destination);
            
            // Schedule playback at the cursor time
            source.start(this.nextPlayTime);
            
            // Advance the cursor for the next chunk
            this.nextPlayTime += audioBuffer.duration;
            
            console.log(`Scheduled audio chunk: duration=${audioBuffer.duration.toFixed(3)}s, nextPlayTime=${this.nextPlayTime.toFixed(3)}s`);

        } catch (error) {
            console.error('Failed to play audio chunk:', error);
        }
    }

    resetAudioPlayback() {
        // Reset the audio playback cursor
        this.nextPlayTime = 0;
        this.audioQueue = [];
        console.log('Audio playback reset');
    }

    startRecording() {
        this.isRecording = true;
        this.updateStatusMessage('Listening...');
    }

    stopRecording() {
        this.isRecording = false;
    }

    startAudioVisualization(analyser) {
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        const animate = () => {
            if (!this.audioContext) return;
            
            analyser.getByteFrequencyData(dataArray);
            
            // Update wave heights based on audio levels
            this.waves.forEach((wave, index) => {
                const value = dataArray[index * 10] || 0;
                const height = Math.max(20, (value / 255) * 80);
                wave.style.height = `${height}px`;
            });
            
            requestAnimationFrame(animate);
        };
        
        animate();
    }

    addTranscript(role, content) {
        const transcriptItem = document.createElement('div');
        transcriptItem.className = `transcript-item ${role}`;
        
        const roleElement = document.createElement('div');
        roleElement.className = 'transcript-role';
        roleElement.textContent = role === 'user' ? 'You:' : 'AI:';
        
        const contentElement = document.createElement('div');
        contentElement.className = 'transcript-content';
        contentElement.textContent = content;
        
        transcriptItem.appendChild(roleElement);
        transcriptItem.appendChild(contentElement);
        
        this.transcriptScroll.appendChild(transcriptItem);
        this.transcriptScroll.scrollTop = this.transcriptScroll.scrollHeight;
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        
        if (this.isMuted) {
            this.muteBtn.classList.add('active');
            this.muteBtn.querySelector('.btn-icon').textContent = '🔇';
            this.muteBtn.querySelector('.btn-text').textContent = 'Unmute';
        } else {
            this.muteBtn.classList.remove('active');
            this.muteBtn.querySelector('.btn-icon').textContent = '🔊';
            this.muteBtn.querySelector('.btn-text').textContent = 'Mute';
        }
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        
        if (this.isPaused) {
            this.pauseBtn.classList.add('active');
            this.pauseBtn.querySelector('.btn-icon').textContent = '▶️';
            this.pauseBtn.querySelector('.btn-text').textContent = 'Resume';
            this.updateStatusMessage('Paused');
        } else {
            this.pauseBtn.classList.remove('active');
            this.pauseBtn.querySelector('.btn-icon').textContent = '⏸️';
            this.pauseBtn.querySelector('.btn-text').textContent = 'Pause';
            this.updateStatusMessage('Listening...');
        }
    }

    async endSession() {
        // Save conversation to our server
        if (this.conversationTranscript.length > 0) {
            await this.saveConversation();
        }
        
        // Clean up resources
        this.cleanup();
        
        // Show session selector
        this.showSessionSelector();
    }

    async saveConversation() {
        try {
            const userContent = this.conversationTranscript
                .filter(item => item.role === 'user')
                .map(item => item.content)
                .join(' ');

            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: userContent,
                    type: `voice_${this.currentSessionType}`
                })
            });

            if (response.ok) {
                console.log('Conversation saved successfully');
            }
        } catch (error) {
            console.error('Failed to save conversation:', error);
        }
    }

    cleanup() {
        // Stop recording
        this.stopRecording();
        
        // Close OpenAI WebSocket
        if (this.openaiWebSocket) {
            this.openaiWebSocket.close();
            this.openaiWebSocket = null;
        }
        
        // Stop audio stream
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
        }
        
        // Close audio context
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        // Reset state
        this.isRecording = false;
        this.isPaused = false;
        this.isMuted = false;
        this.currentSessionType = null;
        this.conversationTranscript = [];
    }

    retry() {
        this.cleanup();
        this.showSessionSelector();
    }

    // UI State Management
    showSessionSelector() {
        this.sessionSelector.classList.remove('hidden');
        this.voiceInterface.classList.add('hidden');
        this.loadingScreen.classList.add('hidden');
        this.errorScreen.classList.add('hidden');
        this.updateConnectionStatus('disconnected', 'Select a mode');
    }

    showVoiceInterface() {
        this.sessionSelector.classList.add('hidden');
        this.voiceInterface.classList.remove('hidden');
        this.loadingScreen.classList.add('hidden');
        this.errorScreen.classList.add('hidden');
    }

    showLoading(message) {
        this.sessionSelector.classList.add('hidden');
        this.voiceInterface.classList.add('hidden');
        this.loadingScreen.classList.remove('hidden');
        this.errorScreen.classList.add('hidden');
        
        const loadingText = this.loadingScreen.querySelector('.loading-text');
        if (loadingText) {
            loadingText.textContent = message;
        }
    }

    showError(message) {
        this.sessionSelector.classList.add('hidden');
        this.voiceInterface.classList.add('hidden');
        this.loadingScreen.classList.add('hidden');
        this.errorScreen.classList.remove('hidden');
        
        const errorMessage = document.getElementById('errorMessage');
        if (errorMessage) {
            errorMessage.textContent = message;
        }
        
        this.updateConnectionStatus('error', 'Error');
        this.cleanup();
    }

    updateConnectionStatus(status, text) {
        this.statusDot.className = `status-dot ${status}`;
        this.statusText.textContent = text;
    }

    updateStatusMessage(message) {
        if (this.statusMessage) {
            this.statusMessage.textContent = message;
        }
    }
}

// Initialize the voice journal when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new VoiceJournal();
});
