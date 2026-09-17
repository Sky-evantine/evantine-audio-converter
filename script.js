const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");
const format = document.getElementById("format");
const convertButton = document.getElementById("convertButton");
const status = document.getElementById("status");
const progressBar = document.getElementById("progressBar");
const downloadArea = document.getElementById("downloadArea");
const youtubeUrl = document.getElementById("youtubeUrl");
const youtubeFormat = document.getElementById("youtubeFormat");
const youtubeButton = document.getElementById("youtubeButton");
const youtubeStatus = document.getElementById("youtubeStatus");

// Set this to your deployed server URL when the backend is deployed.
const YOUTUBE_API_BASE = window.EVANTINE_YOUTUBE_API || "https://evantine-youtube-downloader.onrender.com";

let selectedFile = null;
let downloadUrl = null;
let mp3EncoderPromise = null;

function setStatus(message) { status.textContent = message; }
function setProgress(value) { progressBar.style.width = `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`; }
function baseName(name) { return name.replace(/\.[^/.]+$/, ""); }

function revokeDownload() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
}

function makeDownload(blob, extension) {
    revokeDownload();
    downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `${baseName(selectedFile.name)}.${extension}`;
    link.className = "download-button";
    link.textContent = `Download ${extension.toUpperCase()}`;
    downloadArea.replaceChildren(link);
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Fast MP3 engine could not load."));
        document.head.appendChild(script);
    });
}

async function getMp3Encoder() {
    if (!mp3EncoderPromise) {
        mp3EncoderPromise = (async () => {
            if (!window.WasmMediaEncoder) {
                await loadScript("https://unpkg.com/wasm-media-encoders@0.7.0/dist/umd/WasmMediaEncoder.min.js");
            }
            if (!window.WasmMediaEncoder?.createMp3Encoder) throw new Error("Fast MP3 engine is unavailable.");
            return window.WasmMediaEncoder;
        })().catch(error => { mp3EncoderPromise = null; throw error; });
    }
    return mp3EncoderPromise;
}

async function decodeAudio(file) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser cannot decode audio files.");
    const context = new AudioContextClass();
    try { return await context.decodeAudioData(await file.arrayBuffer()); }
    finally { await context.close().catch(() => {}); }
}

function audioBufferToWav(buffer) {
    const channels = Math.min(2, buffer.numberOfChannels);
    const frames = buffer.length;
    const dataSize = frames * channels * 2;
    const output = new ArrayBuffer(44 + dataSize);
    const view = new DataView(output);
    const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };

    write(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); write(8, "WAVE"); write(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, dataSize, true);

    const channelData = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
    let offset = 44;
    for (let frame = 0; frame < frames; frame++) {
        for (let channel = 0; channel < channels; channel++) {
            const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
            view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
            offset += 2;
        }
        if (frame % 8192 === 0) setProgress((frame / frames) * 0.95);
    }
    return new Blob([output], { type: "audio/wav" });
}

async function convertToMp3(buffer) {
    const library = await getMp3Encoder();
    const channels = Math.min(2, buffer.numberOfChannels);
    const data = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
    if (channels === 1) data.push(data[0]);

    const encoder = await library.createMp3Encoder();
    encoder.configure({ sampleRate: buffer.sampleRate, channels, bitrate: 192 });
    const chunks = [];
    const blockSize = 65536;

    for (let offset = 0; offset < buffer.length; offset += blockSize) {
        const end = Math.min(offset + blockSize, buffer.length);
        const encoded = encoder.encode([data[0].subarray(offset, end), data[1].subarray(offset, end)]);
        if (encoded.length) chunks.push(new Uint8Array(encoded));
        setProgress((end / buffer.length) * 0.95);
        setStatus(`Converting to MP3... ${Math.round((end / buffer.length) * 100)}%`);
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    const finalChunk = encoder.finalize();
    if (finalChunk.length) chunks.push(new Uint8Array(finalChunk));
    return new Blob(chunks, { type: "audio/mpeg" });
}

fileInput.addEventListener("change", () => {
    selectedFile = fileInput.files?.[0] || null;
    revokeDownload();
    downloadArea.replaceChildren();
    setProgress(0);
    convertButton.disabled = !selectedFile;
    fileName.textContent = selectedFile ? `Selected: ${selectedFile.name}` : "No file selected";
    setStatus(selectedFile ? "Ready. Choose MP3 or WAV." : "Choose an audio file to begin.");
});

convertButton.addEventListener("click", async () => {
    if (!selectedFile) return;
    convertButton.disabled = true;
    setProgress(0);
    downloadArea.replaceChildren();
    try {
        const outputFormat = format.value;
        const inputFormat = selectedFile.name.split(".").pop()?.toLowerCase();
        if (inputFormat === outputFormat) {
            makeDownload(new Blob([await selectedFile.arrayBuffer()], { type: outputFormat === "mp3" ? "audio/mpeg" : "audio/wav" }), outputFormat);
            setProgress(1); setStatus(`Already ${outputFormat.toUpperCase()}. Ready to download.`); return;
        }
        setStatus("Reading audio...");
        const buffer = await decodeAudio(selectedFile);
        const blob = outputFormat === "wav" ? audioBufferToWav(buffer) : await convertToMp3(buffer);
        makeDownload(blob, outputFormat);
        setProgress(1); setStatus(`Done. Your ${outputFormat.toUpperCase()} is ready.`);
    } catch (error) {
        console.error("Evantine conversion error:", error);
        setProgress(0); setStatus(`Conversion failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally { convertButton.disabled = false; }
});

function isYouTubeUrl(value) {
    try {
        const url = new URL(value);
        return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(url.hostname);
    } catch {
        return false;
    }
}

youtubeButton.addEventListener("click", async () => {
    const value = youtubeUrl.value.trim();
    const outputFormat = youtubeFormat.value;

    if (!isYouTubeUrl(value)) {
        youtubeStatus.textContent = "Please enter a valid YouTube URL.";
        return;
    }

    youtubeButton.disabled = true;
    youtubeStatus.textContent = `Preparing ${outputFormat.toUpperCase()} download...`;

    try {
        const endpoint = new URL("/api/youtube", YOUTUBE_API_BASE);
        endpoint.searchParams.set("url", value);
        endpoint.searchParams.set("format", outputFormat);

        const response = await fetch(endpoint.href);
        if (!response.ok) {
            let message = `Server returned ${response.status}.`;
            try {
                const payload = await response.json();
                if (payload.detail) message = payload.detail;
            } catch {}
            throw new Error(message);
        }

        const blob = await response.blob();
        if (!blob.size) throw new Error("The downloader returned an empty file.");

        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = `evantine-youtube.${outputFormat}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        youtubeStatus.textContent = `Done. Your ${outputFormat.toUpperCase()} download should start now.`;
    } catch (error) {
        console.error("Evantine YouTube error:", error);
        youtubeStatus.textContent = `Download failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
        youtubeButton.disabled = false;
    }
});
