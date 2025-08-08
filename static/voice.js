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
        
        // Buffer for incremental text events
        this.pendingText = '';
        // Track whether we've already requested a model response for the current buffer
        this.awaitingResponse = false;
        this.responseRetryTimer = null;
        this.responseRetrySent = false;
        this.responseTextCommitted = false;
        this.commitRetryTimer = null;
        
        // Silence detection
        this.silenceThreshold = 0.02; // Increased from 0.01 to reduce false positives
        this.silenceTimeout = null;
        this.silenceDuration = 1500; // 1.5 seconds of silence before commit
        this.lastAudioTime = 0;
        
        // Audio buffer management
        this.accumulatedBytes = 0;
        this.MIN_BUFFER_BYTES = 2400; // ~50ms at 24kHz (2 bytes/sample). Lower to avoid clipping tail
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
        this.navButtons = document.querySelectorAll('.nav-btn');
        console.log('Found nav buttons:', this.navButtons.length);
        this.navButtons.forEach((btn, index) => {
            console.log(`Nav button ${index}:`, btn.textContent, btn.dataset.type);
        });
        
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
        // Session selection (old big cards)
        this.sessionButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.startVoiceSession(btn.dataset.type);
            });
        });

        // Session selection (new nav buttons)
        this.navButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                // Update active state
                this.navButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Start voice session
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
        
        // Require secure context for microphone except localhost
        const hostname = window.location.hostname;
        const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
        if (!window.isSecureContext && !isLocalhost) {
            this.showError('Microphone requires a secure context. Open this app via HTTPS (e.g. your deployed URL or an HTTPS tunnel like ngrok/Cloudflare Tunnel) or use http://localhost.');
            return false;
        }
        
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

            // Ensure audio context is running (required by autoplay policies)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

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

            // Cancel any pending commit retry since speech resumed
            if (this.commitRetryTimer) {
                clearTimeout(this.commitRetryTimer);
                this.commitRetryTimer = null;
                console.log('Canceled pending commit retry due to resumed speech');
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
            // Do NOT reset: keep the tail so we don't clip the last word.
            // Instead, schedule a short retry to allow remaining frames to arrive.
            if (this.commitRetryTimer) {
                clearTimeout(this.commitRetryTimer);
            }
            console.log(`Scheduling commit retry in 250ms (bytes=${this.accumulatedBytes})`);
            this.commitRetryTimer = setTimeout(() => {
                if (this.openaiWebSocket && this.openaiWebSocket.readyState === WebSocket.OPEN) {
                    console.log('Commit retry firing');
                    this.commitAudioBuffer();
                }
            }, 250);
            return;
        }
        
        console.log(`Committing audio buffer: ${this.accumulatedBytes} bytes`);
        this.updateStatusMessage('Processing your message...');
        
        // Commit the audio buffer
        this.openaiWebSocket.send(JSON.stringify({
            type: "input_audio_buffer.commit"
        }));
        
        // Trigger response generation (guard against double requests)
        if (!this.awaitingResponse) {
            this.awaitingResponse = true;
            console.log('Client → OpenAI: response.create (after commit)');
            this.openaiWebSocket.send(JSON.stringify({
                type: "response.create",
                response: {
                    modalities: ["text", "audio"]
                }
            }));
            if (this.responseRetryTimer) { clearTimeout(this.responseRetryTimer); }
            this.responseRetrySent = false;
            this.responseRetryTimer = setTimeout(() => {
                if (this.awaitingResponse && !this.responseRetrySent && this.openaiWebSocket && this.openaiWebSocket.readyState === WebSocket.OPEN) {
                    console.log('Client → OpenAI: response.create (retry)');
                    this.openaiWebSocket.send(JSON.stringify({
                        type: "response.create",
                        response: { modalities: ["text", "audio"] }
                    }));
                    this.responseRetrySent = true;
                }
            }, 2000);
        }
        
        // Reset audio buffer tracking
        this.resetAudioBuffer();
    }

    resetAudioBuffer() {
        // Cancel any pending commit retry
        if (this.commitRetryTimer) {
            clearTimeout(this.commitRetryTimer);
            this.commitRetryTimer = null;
        }

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

            case 'input_audio_buffer.committed':
                console.log('OpenAI buffer committed');
                if (!this.awaitingResponse && this.openaiWebSocket && this.openaiWebSocket.readyState === WebSocket.OPEN) {
                    this.awaitingResponse = true;
                    console.log('Client → OpenAI: response.create (after committed event)');
                    this.openaiWebSocket.send(JSON.stringify({
                        type: 'response.create',
                        response: {
                            modalities: ['text', 'audio']
                        }
                    }));
                    if (this.responseRetryTimer) { clearTimeout(this.responseRetryTimer); }
                    this.responseRetrySent = false;
                    this.responseRetryTimer = setTimeout(() => {
                        if (this.awaitingResponse && !this.responseRetrySent && this.openaiWebSocket && this.openaiWebSocket.readyState === WebSocket.OPEN) {
                            console.log('Client → OpenAI: response.create (retry after committed)');
                            this.openaiWebSocket.send(JSON.stringify({
                                type: 'response.create',
                                response: { modalities: ['text', 'audio'] }
                            }));
                            this.responseRetrySent = true;
                        }
                    }, 2000);
                }
                break;

            case 'conversation.item.created':
                console.log('OpenAI conversation item created');
                break;

            case 'response.created':
                console.log('OpenAI response created', data);
                this.pendingText = '';
                this.responseTextCommitted = false;
                break;

            case 'response.completed':
                console.log('OpenAI response completed');
                this.updateStatusMessage('Listening...');
                this.resetAudioPlayback();
                this.awaitingResponse = false;
                this.clearResponseRetry();
                break;

            case 'response.done':
                console.log('OpenAI response done', data);
                // Commit any accumulated text first; otherwise, extract from the final response payload
                if (!this.responseTextCommitted) {
                    const finalText = (this.pendingText && this.pendingText.trim())
                        ? this.pendingText
                        : this.extractTextFromResponse(data);
                    if (finalText && finalText.trim()) {
                        this.commitAssistantText(finalText.trim());
                        this.responseTextCommitted = true;
                    }
                }
                this.pendingText = '';
                this.updateStatusMessage('Listening...');
                this.resetAudioPlayback();
                this.awaitingResponse = false;
                this.clearResponseRetry();
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
            case 'response.output_audio.delta':
                this.clearResponseRetry();
                if (data.delta && !this.isMuted) {
                    this.playAudioChunk(data.delta);
                }
                break;

            case 'response.audio.done':
            case 'response.output_audio.done':
                this.updateStatusMessage('Listening...');
                this.resetAudioPlayback(); // Reset for next response
                this.awaitingResponse = false;
                this.clearResponseRetry();
                break;

            case 'response.text.delta':
                this.clearResponseRetry();
                if (typeof data.delta === 'string') {
                    this.pendingText += data.delta;
                }
                break;

            case 'response.output_text.delta':
                this.clearResponseRetry();
                if (typeof data.delta === 'string') {
                    this.pendingText += data.delta;
                }
                break;

            // Some responses only provide an audio transcript stream without output_text deltas
            case 'response.audio_transcript.delta':
                this.clearResponseRetry();
                if (typeof data.transcript === 'string') {
                    this.pendingText += data.transcript;
                } else if (typeof data.delta === 'string') {
                    this.pendingText += data.delta;
                }
                break;

            case 'response.audio_transcript.done':
                this.clearResponseRetry();
                if (!this.pendingText) {
                    const t = (typeof data.transcript === 'string' && data.transcript) ||
                              (typeof data.text === 'string' && data.text) || '';
                    if (t) this.pendingText += t;
                }
                // Commit transcript to UI if not yet committed
                if (!this.responseTextCommitted) {
                    const text = (this.pendingText || '').trim();
                    if (text) {
                        this.commitAssistantText(text);
                        this.responseTextCommitted = true;
                    }
                }
                break;

            // Content parts API: capture text parts if present
            case 'response.content_part.added':
                this.clearResponseRetry();
                try {
                    const part = data.part || (data.item && Array.isArray(data.item.content) ? data.item.content[0] : null);
                    if (part) {
                        const isTextPart = part.type === 'output_text' || part.type === 'text' || part.type === 'audio_transcript';
                        const text = (typeof part.text === 'string' && part.text) ||
                                     (typeof part.transcript === 'string' && part.transcript) ||
                                     (typeof part.content === 'string' && part.content) || '';
                        if (isTextPart && text) {
                            this.pendingText += text;
                        }
                    }
                } catch (e) {
                    console.warn('Failed to process content_part.added', e);
                }
                break;

            case 'response.content_part.done':
                this.clearResponseRetry();
                try {
                    const part = data.part || (data.item && Array.isArray(data.item.content) ? data.item.content[0] : null);
                    if (part) {
                        const isTextPart = part.type === 'output_text' || part.type === 'text' || part.type === 'audio_transcript';
                        const text = (typeof part.text === 'string' && part.text) ||
                                     (typeof part.transcript === 'string' && part.transcript) ||
                                     (typeof part.content === 'string' && part.content) || '';
                        if (isTextPart && text) {
                            this.pendingText += text;
                        }
                    }
                } catch (e) {
                    console.warn('Failed to process content_part.done', e);
                }
                break;

            // Output item API: whole assistant message objects
            case 'response.output_item.added':
                this.clearResponseRetry();
                try {
                    const item = data.item || data.output_item;
                    if (item) {
                        const text = this.extractTextFromItem(item);
                        if (text) this.pendingText += (this.pendingText ? ' ' : '') + text;
                    }
                } catch (e) {
                    console.warn('Failed to process output_item.added', e);
                }
                break;

            case 'response.output_item.done':
                this.clearResponseRetry();
                try {
                    const item = data.item || data.output_item;
                    if (item) {
                        const text = this.extractTextFromItem(item);
                        if (text) this.pendingText += (this.pendingText ? ' ' : '') + text;
                    }
                } catch (e) {
                    console.warn('Failed to process output_item.done', e);
                }
                if (!this.responseTextCommitted) {
                    const text = (this.pendingText || '').trim();
                    if (text) {
                        this.commitAssistantText(text);
                        this.responseTextCommitted = true;
                    }
                }
                break;

            case 'response.text.done':
            case 'response.output_text.done':
                const aiText = (typeof data.text === 'string' && data.text) || this.pendingText || (typeof data.output_text === 'string' ? data.output_text : '');
                if (aiText) {
                    this.commitAssistantText(aiText);
                    this.responseTextCommitted = true;
                }
                this.pendingText = '';
                this.awaitingResponse = false;
                this.clearResponseRetry();
                break;

            case 'error':
                console.error('OpenAI error:', data);
                this.showError('OpenAI error: ' + (data.error?.message || 'Unknown error'));
                this.awaitingResponse = false;
                break;
        }
    }

    async playAudioChunk(base64Audio) {
        try {
            // Ensure audio context is running
            if (this.audioContext && this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
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

    clearResponseRetry() {
        if (this.responseRetryTimer) {
            clearTimeout(this.responseRetryTimer);
            this.responseRetryTimer = null;
        }
        this.responseRetrySent = false;
    }

    commitAssistantText(text) {
        const clean = (text || '').trim();
        console.log('Committing assistant text length:', clean.length, 'preview:', clean.slice(0, 80));
        if (!clean) return;
        this.addTranscript('assistant', clean);
        this.conversationTranscript.push({
            role: 'assistant',
            content: clean,
            timestamp: new Date().toISOString()
        });
    }

    // Extract text from a single realtime.item (assistant message with content parts)
    extractTextFromItem(item) {
        try {
            const texts = [];
            if (!item) return '';
            const parts = Array.isArray(item.content) ? item.content : [];
            for (const part of parts) {
                if (!part) continue;
                const isTextPart = part.type === 'output_text' || part.type === 'text' || part.type === 'audio_transcript';
                const text = (typeof part.text === 'string' && part.text)
                    || (typeof part.transcript === 'string' && part.transcript)
                    || (typeof part.content === 'string' && part.content)
                    || '';
                if (isTextPart && text && text.trim()) {
                    texts.push(text.trim());
                }
            }
            return texts.join(' ').trim();
        } catch (e) {
            console.warn('extractTextFromItem failed', e);
            return '';
        }
    }
    
    // Fallback extractor for 'response.done' payloads that contain the whole response
    extractTextFromResponse(respEvent) {
        try {
            const resp = respEvent && respEvent.response ? respEvent.response : respEvent;
            const output = (resp && Array.isArray(resp.output)) ? resp.output : [];
            const texts = [];

            for (const item of output) {
                // Expect items like: { type: 'message', role: 'assistant', content: [ { type:'output_text', text:'...' }, ... ] }
                if (!item || item.type !== 'message' || item.role !== 'assistant') continue;
                const parts = Array.isArray(item.content) ? item.content : [];
                for (const part of parts) {
                    if (!part) continue;
                    const isTextPart = part.type === 'output_text' || part.type === 'text' || part.type === 'audio_transcript';
                    const text = (typeof part.text === 'string' && part.text)
                        || (typeof part.transcript === 'string' && part.transcript)
                        || (typeof part.content === 'string' && part.content)
                        || '';
                    if (isTextPart && text && text.trim()) {
                        texts.push(text.trim());
                    }
                }
            }

            const joined = texts.join(' ').trim();
            console.log('extractTextFromResponse collected chars:', joined.length, 'preview:', joined.slice(0, 80));
            return joined;
        } catch (e) {
            console.warn('Failed to extract text from response:', e);
            return '';
        }
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
