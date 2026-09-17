const { FFmpeg } = FFmpegWASM;

const ffmpeg = new FFmpeg();

const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");
const format = document.getElementById("format");
const convertButton = document.getElementById("convertButton");
const status = document.getElementById("status");
const downloadArea = document.getElementById("downloadArea");

let selectedFile = null;
let ffmpegLoaded = false;
let downloadUrl = null;
let inputName = null;
let outputName = null;

const VIDEO_FORMATS = new Set([
    "mp4", "webm", "mkv", "mov", "avi", "mpeg", "mpg", "ogv"
]);

const MIME_TYPES = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    opus: "audio/opus",
    flac: "audio/flac",
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

function isVideoFile(file) {
    if (file.type.startsWith("video/")) return true;
    const extension = file.name.split(".").pop()?.toLowerCase();
    return ["mp4", "webm", "mkv", "mov", "avi", "mpeg", "mpg", "ogv", "m4v"].includes(extension);
}

function getBaseName(name) {
    return name.replace(/\.[^/.]+$/, "");
}

function revokeDownloadUrl() {
    if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
        downloadUrl = null;
    }
}

async function toBlobURL(url, mimeType) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Could not load FFmpeg resource (${response.status}).`);
    }
    const data = await response.arrayBuffer();
    return URL.createObjectURL(new Blob([data], { type: mimeType }));
}

async function loadFFmpeg() {
    if (ffmpegLoaded) return;

    setStatus("Loading converter... This can take a moment the first time.");

    const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
    const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript");
    const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm");

    await ffmpeg.load({ coreURL, wasmURL });
    ffmpegLoaded = true;
    setStatus("Converter ready.");
}

ffmpeg.on("progress", ({ progress }) => {
    const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
    setStatus(`Converting... ${percent}%`);
});

ffmpeg.on("log", ({ message }) => {
    console.debug("FFmpeg:", message);
});

fileInput.addEventListener("change", () => {
    selectedFile = fileInput.files?.[0] ?? null;
    revokeDownloadUrl();
    downloadArea.replaceChildren();

    if (!selectedFile) {
        fileName.textContent = "";
        convertButton.disabled = true;
        setStatus("Choose a file to begin.");
        return;
    }

    fileName.textContent = `Selected: ${selectedFile.name}`;
    convertButton.disabled = false;
    setStatus(isVideoFile(selectedFile) ? "Video selected. Choose an output format." : "File selected. Choose an output format.");
});

convertButton.addEventListener("click", async () => {
    if (!selectedFile) {
        setStatus("Please choose a file first.");
        return;
    }

    convertButton.disabled = true;
    revokeDownloadUrl();
    downloadArea.replaceChildren();

    try {
        await loadFFmpeg();

        const inputExtension = selectedFile.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
        const outputFormat = format.value.toLowerCase();
        inputName = `input.${inputExtension}`;
        outputName = `output.${outputFormat}`;

        setStatus("Reading file...");
        const data = new Uint8Array(await selectedFile.arrayBuffer());
        await ffmpeg.writeFile(inputName, data);

        const sourceIsVideo = isVideoFile(selectedFile);
        const targetIsVideo = VIDEO_FORMATS.has(outputFormat);
        const args = ["-i", inputName, "-y"];

        if (targetIsVideo) {
            if (!sourceIsVideo) {
                args.push("-loop", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p");
            } else if (outputFormat === "webm") {
                args.push("-c:v", "libvpx-vp9", "-c:a", "libopus");
            } else {
                args.push("-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
            }
        } else {
            args.push("-vn");
            if (outputFormat === "mp3") args.push("-c:a", "libmp3lame", "-q:a", "2");
            else if (outputFormat === "opus") args.push("-c:a", "libopus", "-b:a", "160k");
            else if (outputFormat === "aac") args.push("-c:a", "aac", "-b:a", "192k");
            else if (outputFormat === "flac") args.push("-c:a", "flac");
            else if (outputFormat === "wav") args.push("-c:a", "pcm_s16le");
        }

        args.push(outputName);
        setStatus("Converting...");
        await ffmpeg.exec(args);

        const output = await ffmpeg.readFile(outputName);
        const blob = new Blob([output], { type: MIME_TYPES[outputFormat] || "application/octet-stream" });
        downloadUrl = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = `${getBaseName(selectedFile.name)}.${outputFormat}`;
        link.textContent = `Download ${outputFormat.toUpperCase()}`;
        link.className = "download-button";
        downloadArea.appendChild(link);

        setStatus("Conversion complete! Your file is ready.");
    } catch (error) {
        console.error("Evantine conversion error:", error);
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Conversion failed: ${message}`);
    } finally {
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
        inputName = null;
        outputName = null;
        convertButton.disabled = false;
    }
});