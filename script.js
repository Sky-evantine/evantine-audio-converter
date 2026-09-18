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
const MP3_BITRATE = 192;
const ENCODE_BLOCK_SIZE = 65536;
const MAX_FILE_SIZE = 250 * 1024 * 1024;
const YIELD_INTERVAL_MS = 16;

function setStatus(message) { status.textContent = message; }
function setProgress(value) { progressBar.style.width = `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`; }
function baseName(name) { return name.replace(/\.[^/.]+$/, ""); }

function setConverting(isConverting) {
    document.body.classList.toggle("is-converting", isConverting);
}

function showDone(element) {
    element.classList.remove("status-done");
    void element.offsetWidth;
    element.classList.add("status-done");
}

function inputExtension(file) {
    return file?.name.split(".").pop()?.toLowerCase() || "";
}

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
            return window.WasmMediaEncoder.createMp3Encoder();
        })().catch(error => { mp3EncoderPromise = null; throw error; });
    }
    return mp3EncoderPromise;
}

async function yieldToBrowser() {
    await new Promise(resolve => {
        if ("requestIdleCallback" in window) {
            window.requestIdleCallback(resolve, { timeout: YIELD_INTERVAL_MS });
        } else {
            setTimeout(resolve, 0);
        }
    });
}

async function decodeAudio(file) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser cannot decode audio files.");
    const context = new AudioContextClass();
    try { return await context.decodeAudioData(await file.arrayBuffer()); }
    finally { await context.close().catch(() => {}); }
}

async function audioBufferToWav(buffer) {
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
    const yieldEvery = 65536;
    for (let frame = 0; frame < frames; frame++) {
        for (let channel = 0; channel < channels; channel++) {
            const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
            view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
            offset += 2;
        }
        if ((frame + 1) % yieldEvery === 0 || frame === frames - 1) {
            const progress = (frame + 1) / frames;
            setProgress(progress * 0.95);
            setStatus("Building WAV... " + Math.round(progress * 100) + "%");
            await yieldToBrowser();
        }
    }
    return new Blob([output], { type: "audio/wav" });
}

async function convertToMp3(buffer) {
    const encoder = await getMp3Encoder();
    const channels = Math.min(2, buffer.numberOfChannels);
    const data = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
    encoder.configure({ sampleRate: buffer.sampleRate, channels, bitrate: MP3_BITRATE });

    const chunks = [];
    for (let offset = 0; offset < buffer.length; offset += ENCODE_BLOCK_SIZE) {
        const end = Math.min(offset + ENCODE_BLOCK_SIZE, buffer.length);
        const samples = data.map(channel => channel.subarray(offset, end));
        const encoded = encoder.encode(samples);
        if (encoded.length) chunks.push(new Uint8Array(encoded));
        const progress = end / buffer.length;
        setProgress(progress * 0.95);
        setStatus("Converting to MP3... " + Math.round(progress * 100) + "%");
        await yieldToBrowser();
    }

    const finalChunk = encoder.finalize();
    if (finalChunk.length) chunks.push(new Uint8Array(finalChunk));
    return new Blob(chunks, { type: "audio/mpeg" });
}

const hubTrack = document.getElementById("hubTrack");
const hubPrev = document.getElementById("hubPrev");
const hubNext = document.getElementById("hubNext");
const hubDots = document.getElementById("hubDots");

if (hubTrack) {
    const hubs = Array.from(hubTrack.querySelectorAll(".hub"));
    let currentHub = 0;
    let dragStartX = 0;
    let dragStartScroll = 0;
    let dragging = false;

    hubs.forEach((_, index) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "hub-dot" + (index === 0 ? " active" : "");
        dot.setAttribute("aria-label", "Go to section " + (index + 1));
        dot.addEventListener("click", () => goToHub(index));
        hubDots?.appendChild(dot);
    });

    function updateHub(index) {
        currentHub = Math.max(0, Math.min(hubs.length - 1, index));
        hubDots?.querySelectorAll(".hub-dot").forEach((dot, i) => {
            dot.classList.toggle("active", i === currentHub);
        });
    }

    function goToHub(index) {
        updateHub(index);
        hubTrack.scrollTo({ left: hubs[currentHub].offsetLeft - hubTrack.offsetLeft, behavior: "smooth" });
    }

    hubPrev?.addEventListener("click", () => goToHub(currentHub - 1));
    hubNext?.addEventListener("click", () => goToHub(currentHub + 1));

    hubTrack.addEventListener("scroll", () => {
        const center = hubTrack.scrollLeft + hubTrack.clientWidth / 2;
        let nearest = 0;
        let distance = Infinity;
        hubs.forEach((hub, i) => {
            const hubCenter = hub.offsetLeft - hubTrack.offsetLeft + hub.offsetWidth / 2;
            const d = Math.abs(center - hubCenter);
            if (d < distance) { distance = d; nearest = i; }
        });
        updateHub(nearest);
    }, { passive: true });

    hubTrack.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        dragging = true;
        dragStartX = event.clientX;
        dragStartScroll = hubTrack.scrollLeft;
        hubTrack.classList.add("is-dragging");
        hubTrack.setPointerCapture?.(event.pointerId);
    });

    hubTrack.addEventListener("pointermove", event => {
        if (!dragging) return;
        hubTrack.scrollLeft = dragStartScroll - (event.clientX - dragStartX);
    });

    const endDrag = event => {
        if (!dragging) return;
        dragging = false;
        hubTrack.classList.remove("is-dragging");
        hubTrack.releasePointerCapture?.(event.pointerId);
        const moved = event.clientX - dragStartX;
        if (Math.abs(moved) > 45) {
            goToHub(currentHub + (moved < 0 ? 1 : -1));
        } else {
            goToHub(currentHub);
        }
    };
    hubTrack.addEventListener("pointerup", endDrag);
    hubTrack.addEventListener("pointercancel", endDrag);
}

fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0] || null;
    if (file && file.size > MAX_FILE_SIZE) {
        selectedFile = null;
        fileInput.value = "";
        revokeDownload();
        downloadArea.replaceChildren();
        setProgress(0);
        convertButton.disabled = true;
        fileName.textContent = "File is too large (250 MB max).";
        fileName.classList.remove("file-selected");
        setStatus("Choose a smaller MP3 or WAV file.");
        return;
    }
    selectedFile = file;
    revokeDownload();
    downloadArea.replaceChildren();
    setProgress(0);
    convertButton.disabled = !selectedFile;
    fileName.textContent = selectedFile ? `Selected: ${selectedFile.name}` : "No file selected";
    fileName.classList.remove("file-selected");
    if (selectedFile) {
        void fileName.offsetWidth;
        fileName.classList.add("file-selected");

        // Pick the useful opposite format automatically.
        const inputFormat = inputExtension(selectedFile);
        if (inputFormat === "mp3") format.value = "wav";
        if (inputFormat === "wav") {
            format.value = "mp3";
        }
    }
    if (!selectedFile) {
        setStatus("Choose an audio file to begin.");
    } else if (inputExtension(selectedFile) !== "wav") {
        setStatus("Ready. WAV is selected.");
    }
});

convertButton.addEventListener("click", async () => {
    if (!selectedFile) return;
    convertButton.disabled = true;
    setConverting(true);
    setProgress(0);
    downloadArea.replaceChildren();
    status.classList.remove("status-done");
    try {
        const outputFormat = format.value;
        const inputFormat = inputExtension(selectedFile);
        if (!["mp3", "wav"].includes(inputFormat)) {
            throw new Error("Please choose an MP3 or WAV file.");
        }
        if (inputFormat === outputFormat) {
            makeDownload(new Blob([await selectedFile.arrayBuffer()], { type: outputFormat === "mp3" ? "audio/mpeg" : "audio/wav" }), outputFormat);
            setProgress(1); setStatus(`Already ${outputFormat.toUpperCase()}. Ready to download.`); showDone(status); return;
        }
        setStatus("Reading audio...");
        if (outputFormat === "mp3") {
            setStatus("Preparing MP3 encoder...");
            await getMp3Encoder();
        }
        const buffer = await decodeAudio(selectedFile);
        const blob = outputFormat === "wav" ? await audioBufferToWav(buffer) : await convertToMp3(buffer);
        makeDownload(blob, outputFormat);
        setProgress(1); setStatus(`Done. Your ${outputFormat.toUpperCase()} is ready.`); showDone(status);
    } catch (error) {
        console.error("Evantine conversion error:", error);
        setProgress(0); setStatus(`Conversion failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        setConverting(false);
        convertButton.disabled = false;
    }
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
    youtubeStatus.classList.remove("status-done");
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
        showDone(youtubeStatus);
    } catch (error) {
        console.error("Evantine YouTube error:", error);
        youtubeStatus.textContent = `Download failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
        youtubeButton.disabled = false;
    }
});