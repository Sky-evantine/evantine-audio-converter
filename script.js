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

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Could not load ${src}`));
        document.head.appendChild(script);
    });
}

async function getFFmpegConstructor() {
    if (window.FFmpegWASM?.FFmpeg) return window.FFmpegWASM.FFmpeg;

    // The local copy is preferred. If a phone has an old/corrupt cached copy,
    // fall back to the official UMD build rather than leaving the converter dead.
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

    setStatus("Loading converter... The first load can take a moment.");
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
        await loadFFmpeg();

        const inputExtension = getExtension(selectedFile.name);
        const outputFormat = format.value.toLowerCase();
        const sourceIsVideo = isVideoFile(selectedFile);
        const sourceIsImage = isImageFile(selectedFile);
        const targetIsVideo = VIDEO_FORMATS.has(outputFormat);

        if (targetIsVideo && !sourceIsVideo && !sourceIsImage) {
            throw new Error("Audio to video conversion needs a visual source. Choose an audio format, or select an image/video for a video output.");
        }

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
            if (outputFormat === "webm") args.push("-b:v", "2M");
            args.push(outputName);
        } else if (targetIsVideo) {
            args = ["-i", inputName];

            if (outputFormat === "webm") {
                args.push("-c:v", "libvpx-vp9", "-c:a", "libopus", "-b:v", "2M", "-b:a", "160k");
            } else if (outputFormat === "ogv") {
                args.push("-c:v", "libtheora", "-c:a", "libvorbis", "-q:v", "7", "-q:a", "5");
            } else if (outputFormat === "avi") {
                args.push("-c:v", "mpeg4", "-c:a", "mp3", "-q:v", "5", "-q:a", "3");
            } else if (outputFormat === "mpeg" || outputFormat === "mpg") {
                args.push("-c:v", "mpeg2video", "-c:a", "mp2", "-b:v", "4M", "-b:a", "192k");
            } else {
                args.push("-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
            }

            args.push("-shortest", "-y", outputName);
        } else {
            args = ["-i", inputName, "-vn", "-y"];

            if (outputFormat === "mp3") {
                args.push("-c:a", "libmp3lame", "-q:a", "2");
            } else if (outputFormat === "opus") {
                args.push("-c:a", "libopus", "-b:a", "160k");
            } else if (outputFormat === "aac") {
                args.push("-c:a", "aac", "-b:a", "192k");
            } else if (outputFormat === "flac") {
                args.push("-c:a", "flac");
            } else if (outputFormat === "wav") {
                args.push("-c:a", "pcm_s16le");
            } else if (outputFormat === "ogg") {
                args.push("-c:a", "libvorbis", "-q:a", "5");
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

        downloadUrl = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = `${getBaseName(selectedFile.name)}.${outputFormat}`;
        link.textContent = `Download ${outputFormat.toUpperCase()}`;
        link.className = "download-button";
        link.setAttribute("aria-label", `Download converted ${outputFormat} file`);
        downloadArea.appendChild(link);

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
