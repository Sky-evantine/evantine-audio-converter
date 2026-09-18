const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");
const format = document.getElementById("format");
const convertButton = document.getElementById("convertButton");
const status = document.getElementById("status");
const progressBar = document.getElementById("progressBar");
const downloadArea = document.getElementById("downloadArea");

let selectedFile = null;
let downloadUrl = null;
let mp3EncoderPromise = null;
let converting = false;

const MP3_BITRATE = 192;
const ENCODE_BLOCK_SIZE = 131072;
const YIELD_EVERY_BLOCKS = 16;
const MAX_FILE_SIZE = 250 * 1024 * 1024;

function setStatus(message) {
  status.textContent = message;
}

function setProgress(value) {
  progressBar.style.width = `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`;
}

function baseName(name) {
  return name.replace(/\.[^/.]+$/, "");
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
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("MP3 engine could not load.")), { once: true });
      if (window.WasmMediaEncoder) resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error("MP3 engine could not load."));
    document.head.appendChild(script);
  });
}

async function getMp3Encoder() {
  if (!mp3EncoderPromise) {
    mp3EncoderPromise = (async () => {
      if (!window.WasmMediaEncoder) {
        await loadScript("https://unpkg.com/wasm-media-encoders@0.7.0/dist/umd/WasmMediaEncoder.min.js");
      }
      if (!window.WasmMediaEncoder?.createMp3Encoder) {
        throw new Error("MP3 engine is unavailable.");
      }
      return window.WasmMediaEncoder.createMp3Encoder();
    })().catch(error => {
      mp3EncoderPromise = null;
      throw error;
    });
  }

  return mp3EncoderPromise;
}

function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function decodeAudio(file) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("This browser cannot decode audio files.");

  setStatus("Decoding audio...");
  setProgress(0.04);

  const context = new AudioContextClass();
  try {
    const data = await file.arrayBuffer();
    return await context.decodeAudioData(data);
  } finally {
    await context.close().catch(() => {});
  }
}

async function audioBufferToWav(buffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const dataSize = frames * channels * 2;
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);

  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);

  const channelData = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  const pcm = new Int16Array(output, 44);
  const chunkFrames = 524288;

  for (let start = 0; start < frames; start += chunkFrames) {
    const end = Math.min(start + chunkFrames, frames);
    let out = (start * channels);

    for (let frame = start; frame < end; frame++) {
      for (let channel = 0; channel < channels; channel++) {
        const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
        pcm[out++] = sample < 0 ? sample * 32768 : sample * 32767;
      }
    }

    const progress = end / frames;
    setProgress(0.05 + progress * 0.9);
    setStatus(`Building WAV... ${Math.round(progress * 100)}%`);

    if (end < frames) await yieldToBrowser();
  }

  return new Blob([output], { type: "audio/wav" });
}

async function convertToMp3(buffer) {
  setStatus("Starting MP3 encoder...");
  setProgress(0.05);

  const encoder = await getMp3Encoder();
  const channels = Math.min(2, buffer.numberOfChannels);
  const data = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));

  encoder.configure({
    sampleRate: buffer.sampleRate,
    channels,
    bitrate: MP3_BITRATE
  });

  const chunks = [];

  for (let offset = 0, block = 0; offset < buffer.length; offset += ENCODE_BLOCK_SIZE, block++) {
    const end = Math.min(offset + ENCODE_BLOCK_SIZE, buffer.length);
    const samples = data.map(channel => channel.subarray(offset, end));
    const encoded = encoder.encode(samples);

    if (encoded.length) chunks.push(new Uint8Array(encoded));

    const progress = end / buffer.length;
    setProgress(0.05 + progress * 0.9);
    setStatus(`Converting to MP3... ${Math.round(progress * 100)}%`);

    if (block % YIELD_EVERY_BLOCKS === 0 && end < buffer.length) {
      await yieldToBrowser();
    }
  }

  const finalChunk = encoder.finalize();
  if (finalChunk.length) chunks.push(new Uint8Array(finalChunk));

  return new Blob(chunks, { type: "audio/mpeg" });
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0] || null;

  if (file && file.size > MAX_FILE_SIZE) {
    selectedFile = null;
    fileInput.value = "";
    revokeDownload();
    downloadArea.replaceChildren();
    convertButton.disabled = true;
    setProgress(0);
    fileName.textContent = "File is too large (250 MB max).";
    setStatus("Choose a smaller MP3 or WAV file.");
    return;
  }

  selectedFile = file;
  revokeDownload();
  downloadArea.replaceChildren();
  setProgress(0);
  convertButton.disabled = !selectedFile;
  fileName.textContent = selectedFile ? `Selected: ${selectedFile.name}` : "No file selected";

  if (!selectedFile) {
    setStatus("Choose an audio file to begin.");
    return;
  }

  const inputFormat = inputExtension(selectedFile);

  if (!["mp3", "wav"].includes(inputFormat)) {
    selectedFile = null;
    convertButton.disabled = true;
    setStatus("Please choose an MP3 or WAV file.");
    return;
  }

  format.value = inputFormat === "mp3" ? "wav" : "mp3";
  setStatus(`Ready. ${format.value.toUpperCase()} is selected.`);
});

convertButton.addEventListener("click", async () => {
  if (!selectedFile || converting) return;

  converting = true;
  convertButton.disabled = true;
  downloadArea.replaceChildren();
  setProgress(0);
  status.classList.remove("status-done");

  try {
    const outputFormat = format.value;
    const inputFormat = inputExtension(selectedFile);

    if (inputFormat === outputFormat) {
      setStatus("Preparing download...");
      const blob = new Blob([await selectedFile.arrayBuffer()], {
        type: outputFormat === "mp3" ? "audio/mpeg" : "audio/wav"
      });
      makeDownload(blob, outputFormat);
      setProgress(1);
      setStatus(`Already ${outputFormat.toUpperCase()}. Ready to download.`);
      status.classList.add("status-done");
      return;
    }

    if (outputFormat === "mp3") {
      setStatus("Loading MP3 engine...");
      await getMp3Encoder();
    }

    const buffer = await decodeAudio(selectedFile);
    const blob = outputFormat === "wav"
      ? await audioBufferToWav(buffer)
      : await convertToMp3(buffer);

    makeDownload(blob, outputFormat);
    setProgress(1);
    setStatus(`Done. Your ${outputFormat.toUpperCase()} is ready.`);
    status.classList.add("status-done");
  } catch (error) {
    console.error("Evantine conversion error:", error);
    setProgress(0);
    setStatus(`Conversion failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    converting = false;
    convertButton.disabled = !selectedFile;
  }
});
