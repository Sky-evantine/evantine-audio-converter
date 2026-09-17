const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");
const format = document.getElementById("format");
const convertButton = document.getElementById("convertButton");
const status = document.getElementById("status");
const progressBar = document.getElementById("progressBar");
const downloadArea = document.getElementById("downloadArea");

let ffmpeg = null;
let ffmpegLoaded = false;
let selectedFile = null;
let downloadUrl = null;
let inputName = null;
let outputName = null;
let fastAudioEncoderPromise = null;

const VIDEO_FORMATS = new Set([
    "mp4", "webm", "mkv", "mov", "avi", "mpeg", "mpg", "ogv"
]);

const IMAGE_EXTENSIONS = new Set([
    "jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff"
]);

const MIME_TYPES = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    opus: "audio/opus",
    aac: "audio/aac",
    m4a: "audio/mp4",
    aiff: "audio/aiff",
    mp4: "video/mp4",
    webm: "video/webm",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
    ogv: "video/ogg"
};

function setStatus(message) {
    status.textContent = message;
}

function setProgress(value) {
    const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
    progressBar.style.width = `${percent}%`;
}

function getExtension(name) {
    return name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
}

function getBaseName(name) {
    return name.replace(/\.[^/.]+$/, "");
}

function isVideoFile(file) {
    if (file.type?.startsWith("video/")) return true;
    return VIDEO_FORMATS.has(getExtension(file.name)) || getExtension(file.name) === "m4v";
}

function isImageFile(file) {
    if (file.type?.startsWith("image/")) return true;
    return IMAGE_EXTENSIONS.has(getExtension(file.name));
}

function revokeDownloadUrl() {
    if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
        downloadUrl = null;
    }
}

function makeDownload(blob, outputFormat) {
    downloadUrl = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `${getBaseName(selectedFile.name)}.${outputFormat}`;
    link.textContent = `Download ${outputFormat.toUpperCase()}`;
    link.className = "download-button";
    link.setAttribute("aria-label", `Download converted ${outputFormat} file`);
    downloadArea.appendChild(link);
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Could not load ${src}`));
        document.head.appendChild(script);
    });
}

async function getFFmpegConstructor() {
    if (window.FFmpegWASM?.FFmpeg) return window.FFmpegWASM.FFmpeg;

    try {
        await loadScript("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/umd/ffmpeg.js?v=20260917");
    } catch (error) {
        console.debug("FFmpeg CDN fallback failed:", error);
    }

    const Constructor = window.FFmpegWASM?.FFmpeg;
    if (!Constructor) {
        throw new Error("FFmpeg library did not load. Check your connection and refresh the page.");
    }
    return Constructor;
}

async function getFastAudioEncoder() {
    if (!fastAudioEncoderPromise) {
        fastAudioEncoderPromise = (async () => {
            if (!window.WasmMediaEncoder) {
                await loadScript("https://unpkg.com/wasm-media-encoders@0.7.0/dist/umd/WasmMediaEncoder.min.js?v=20260917");
            }
            if (!window.WasmMediaEncoder?.createMp3Encoder || !window.WasmMediaEncoder?.createOggEncoder) {
                throw new Error("Fast audio encoder is unavailable.");
            }
            return window.WasmMediaEncoder;
        })().catch((error) => {
            fastAudioEncoderPromise = null;
            throw error;
        });
    }
    return fastAudioEncoderPromise;
}

async function decodeAudioFile(file) {
    if (!window.AudioContext && !window.webkitAudioContext) {
        throw new Error("This browser does not provide a native audio decoder.");
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass();

    try {
        if (context.state === "suspended") {
            await context.resume();
        }
        return await context.decodeAudioData(await file.arrayBuffer());
    } finally {
        await context.close().catch(() => {});
    }
}

function audioBufferToPcm(audioBuffer) {
    const channels = Math.min(2, audioBuffer.numberOfChannels);
    const data = [];

    for (let channel = 0; channel < channels; channel += 1) {
        data.push(audioBuffer.getChannelData(channel));
    }

    if (channels === 1) data.push(data[0]);
    return data;
}

async function convertAudioFastPath(outputFormat) {
    if (outputFormat !== "mp3" && outputFormat !== "ogg") return false;
    if (isVideoFile(selectedFile) || isImageFile(selectedFile)) return false;

    const inputFormat = getExtension(selectedFile.name);
    if (inputFormat === outputFormat) {
        const blob = new Blob([await selectedFile.arrayBuffer()], { type: MIME_TYPES[outputFormat] });
        makeDownload(blob, outputFormat);
        setProgress(1);
        setStatus(`Already ${outputFormat.toUpperCase()}. Your file is ready.`);
        return true;
    }

    try {
        setStatus("Starting fast audio engine...");
        const [encoderLib, audioBuffer] = await Promise.all([
            getFastAudioEncoder(),
            decodeAudioFile(selectedFile)
        ]);

        const channels = Math.min(2, audioBuffer.numberOfChannels);
        const pcm = audioBufferToPcm(audioBuffer);
        const encoder = outputFormat === "mp3"
            ? await encoderLib.createMp3Encoder()
            : await encoderLib.createOggEncoder();
        encoder.configure({
            sampleRate: audioBuffer.sampleRate,
            channels,
            ...(outputFormat === "mp3" ? { bitrate: 192 } : { vbrQuality: 4 })
        });

        const chunks = [];
        const blockSize = 65536;
        const total = audioBuffer.length;

        for (let offset = 0; offset < total; offset += blockSize) {
            const end = Math.min(offset + blockSize, total);
            const encoded = encoder.encode([
                pcm[0].subarray(offset, end),
                pcm[1].subarray(offset, end)
            ]);
            if (encoded.length) chunks.push(new Uint8Array(encoded));
            setProgress((end / total) * 0.95);
            setStatus(`Fast ${outputFormat.toUpperCase()} conversion... ${Math.round((end / total) * 100)}%`);
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        const finalChunk = encoder.finalize();
        if (finalChunk.length) chunks.push(new Uint8Array(finalChunk));

        makeDownload(new Blob(chunks, { type: MIME_TYPES[outputFormat] }), outputFormat);
        setProgress(1);
        setStatus(`Conversion complete! Your ${outputFormat.toUpperCase()} is ready.`);
        return true;
    } catch (error) {
        console.warn(`Fast ${outputFormat.toUpperCase()} path unavailable; falling back to FFmpeg:`, error);
        setProgress(0);
        return false;
    }
}

async function toBlobURL(url, mimeType) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Could not load FFmpeg resource (${response.status}).`);
    }
    const data = await response.arrayBuffer();
    return URL.createObjectURL(new Blob([data], { type: mimeType }));
}

async function loadFFmpeg() {
    if (ffmpegLoaded) return;

    setStatus("Loading full converter... This only happens when the fast engine cannot be used.");
    setProgress(0);

    const FFmpegConstructor = await getFFmpegConstructor();
    ffmpeg = new FFmpegConstructor();

    ffmpeg.on("progress", ({ progress }) => {
        setProgress(progress);
        setStatus(`Converting... ${Math.round(progress * 100)}%`);
    });

    ffmpeg.on("log", ({ message }) => {
        console.debug("FFmpeg:", message);
    });

    const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
    let coreURL = null;
    let wasmURL = null;

    try {
        [coreURL, wasmURL] = await Promise.all([
            toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
            toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm")
        ]);

        await ffmpeg.load({ coreURL, wasmURL });
        ffmpegLoaded = true;
        setStatus("Converter ready.");
    } catch (error) {
        ffmpeg = null;
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`FFmpeg could not start: ${message}`);
    } finally {
        if (coreURL) URL.revokeObjectURL(coreURL);
        if (wasmURL) URL.revokeObjectURL(wasmURL);
    }
}

fileInput.addEventListener("change", () => {
    selectedFile = fileInput.files?.[0] ?? null;
    revokeDownloadUrl();
    downloadArea.replaceChildren();
    setProgress(0);

    if (!selectedFile) {
        fileName.textContent = "No file selected";
        convertButton.disabled = true;
        setStatus("Choose a file to begin.");
        return;
    }

    fileName.textContent = `Selected: ${selectedFile.name}`;
    convertButton.disabled = false;

    if (isImageFile(selectedFile)) {
        setStatus("Image selected. Video output is available.");
    } else if (isVideoFile(selectedFile)) {
        setStatus("Video selected. Choose an output format.");
    } else {
        setStatus("File selected. Choose an output format.");
    }
});

convertButton.addEventListener("click", async () => {
    if (!selectedFile) {
        setStatus("Please choose a file first.");
        return;
    }

    convertButton.disabled = true;
    revokeDownloadUrl();
    downloadArea.replaceChildren();
    setProgress(0);

    try {
        const outputFormat = format.value.toLowerCase();
        const sourceIsVideo = isVideoFile(selectedFile);
        const sourceIsImage = isImageFile(selectedFile);
        const targetIsVideo = VIDEO_FORMATS.has(outputFormat);

        if (targetIsVideo && !sourceIsVideo && !sourceIsImage) {
            throw new Error("Audio to video conversion needs a visual source. Choose an audio format, or select an image/video for a video output.");
        }

        if (await convertAudioFastPath(outputFormat)) return;

        await loadFFmpeg();

        const inputExtension = getExtension(selectedFile.name);
        inputName = `input.${inputExtension}`;
        outputName = `output.${outputFormat}`;

        setStatus("Reading file...");
        await ffmpeg.writeFile(inputName, new Uint8Array(await selectedFile.arrayBuffer()));

        let args;

        if (targetIsVideo && sourceIsImage) {
            args = [
                "-loop", "1",
                "-framerate", "30",
                "-i", inputName,
                "-c:v", outputFormat === "webm" ? "libvpx-vp9" : outputFormat === "ogv" ? "libtheora" : "libx264",
                "-pix_fmt", "yuv420p",
                "-t", "5",
                "-an"
            ];
            if (outputFormat === "webm") args.push("-deadline", "realtime", "-cpu-used", "8", "-b:v", "1M");
            else if (outputFormat !== "ogv") args.push("-preset", "ultrafast", "-crf", "28");
            args.push("-y", outputName);
        } else if (targetIsVideo) {
            args = ["-i", inputName];

            if (outputFormat === "webm") {
                args.push("-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-b:v", "2M", "-c:a", "libopus", "-b:a", "128k");
            } else if (outputFormat === "ogv") {
                args.push("-c:v", "libtheora", "-q:v", "5", "-c:a", "libvorbis", "-q:a", "4");
            } else if (outputFormat === "avi") {
                args.push("-c:v", "mpeg4", "-q:v", "6", "-c:a", "mp3", "-q:a", "5");
            } else if (outputFormat === "mpeg" || outputFormat === "mpg") {
                args.push("-c:v", "mpeg2video", "-c:a", "mp2", "-b:v", "3M", "-b:a", "160k");
            } else {
                args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-c:a", "aac", "-b:a", "160k", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
            }

            args.push("-shortest", "-y", outputName);
        } else {
            args = ["-i", inputName, "-vn", "-y"];

            if (outputFormat === "mp3") {
                args.push("-c:a", "libmp3lame", "-b:a", "192k");
            } else if (outputFormat === "opus") {
                args.push("-c:a", "libopus", "-b:a", "160k", "-application", "audio");
            } else if (outputFormat === "aac") {
                args.push("-c:a", "aac", "-b:a", "192k");
            } else if (outputFormat === "flac") {
                args.push("-c:a", "flac", "-compression_level", "2");
            } else if (outputFormat === "wav") {
                args.push("-c:a", "pcm_s16le");
            } else if (outputFormat === "ogg") {
                args.push("-c:a", "libvorbis", "-q:a", "4");
            } else if (outputFormat === "m4a") {
                args.push("-c:a", "aac", "-b:a", "192k");
            } else if (outputFormat === "aiff") {
                args.push("-c:a", "pcm_s16be");
            }

            args.push(outputName);
        }

        setStatus("Converting...");
        await ffmpeg.exec(args);

        const output = await ffmpeg.readFile(outputName);
        const blob = new Blob([output], {
            type: MIME_TYPES[outputFormat] || "application/octet-stream"
        });

        makeDownload(blob, outputFormat);
        setProgress(1);
        setStatus("Conversion complete! Your file is ready.");
    } catch (error) {
        console.error("Evantine conversion error:", error);
        const message = error instanceof Error ? error.message : String(error);
        setProgress(0);
        setStatus(`Conversion failed: ${message}`);
    } finally {
        if (ffmpeg) {
            try {
                if (inputName) await ffmpeg.deleteFile(inputName);
            } catch (error) {
                console.debug("Input cleanup skipped:", error);
            }
            try {
                if (outputName) await ffmpeg.deleteFile(outputName);
            } catch (error) {
                console.debug("Output cleanup skipped:", error);
            }
        }
        inputName = null;
        outputName = null;
        convertButton.disabled = false;
    }
});
