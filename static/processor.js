class PCMWorkletProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 1024; // Process in chunks
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        
        if (input && input.length > 0) {
            const inputChannel = input[0]; // Get first channel (mono)
            
            if (inputChannel && inputChannel.length > 0) {
                // Send the Float32Array data to the main thread
                this.port.postMessage({
                    type: 'audioData',
                    data: inputChannel
                });
            }
        }
        
        return true; // Keep the processor alive
    }
}

registerProcessor('pcm-worklet', PCMWorkletProcessor);
