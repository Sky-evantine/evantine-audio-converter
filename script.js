const { FFmpeg } = window.FFmpeg;

let ffmpeg = null;
let ffmpegLoaded = false;
let selectedFile = null;
let previewURL = null;
let downloadURL = null;
let ffmpegLoading = false;

// Elements
const fileInput = document.getElementById("fileInput");
const chooseFileBtn = document.getElementById("chooseFileBtn");
const dropZone = document.getElementById("dropZone");

const fileName = document.getElementById("fileName");
const fileSize = document.getElementById("fileSize");
const fileType = document.getElementById("fileType");
const fileDuration = document.getElementById("fileDuration");

const audioPreview = document.getElementById("audioPreview");
const fileInfo = document.getElementById("fileInfo");
const removeFileBtn = document.getElementById("removeFileBtn");

const outputFormat = document.getElementById("outputFormat");
const quality = document.getElementById("quality");
const qualityGroup = document.getElementById("qualityGroup");

const convertBtn = document.getElementById("convertBtn");
const progressContainer = document.getElementById("progressContainer");
const progressBar = document.getElementById("progressBar");
const statusText = document.getElementById("statusText");

const downloadArea = document.getElementById("downloadArea");
const downloadBtn = document.getElementById("downloadBtn");

// --------------------------------------------------
// File selection
// --------------------------------------------------

chooseFileBtn.addEventListener("click", () => {
fileInput.click();
});

fileInput.addEventListener("change", (event) => {
if (event.target.files.length > 0) {
handleFile(event.target.files[0]);
}
});

// Drag and drop
dropZone.addEventListener("dragover", (event) => {
event.preventDefault();
dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (event) => {
event.preventDefault();
dropZone.classList.remove("dragover");

```
const file = event.dataTransfer.files[0];

if (file) {
    handleFile(file);
}
```

});

// --------------------------------------------------
// Handle selected file
// --------------------------------------------------

function handleFile(file) {
if (!file.type.startsWith("audio/")) {
setStatus("Please choose a valid audio file.", true);
return;
}

```
selectedFile = file;

if (previewURL) {
    URL.revokeObjectURL(previewURL);
}

previewURL = URL.createObjectURL(file);

audioPreview.src = previewURL;

fileName.textContent = file.name;
fileSize.textContent = formatFileSize(file.size);
fileType.textContent = file.type || "Unknown";

fileInfo.style.display = "block";
audioPreview.style.display = "block";
removeFileBtn.style.display = "inline-flex";

downloadArea.style.display = "none";

audioPreview.addEventListener(
    "loadedmetadata",
    () => {
        if (isFinite(audioPreview.duration)) {
            fileDuration.textContent = formatDuration(audioPreview.duration);
        } else {
            fileDuration.textContent = "Unknown";
        }
    },
    { once: true }
);

setStatus("File ready to convert.");
```

}

// --------------------------------------------------
// Remove file
// --------------------------------------------------

removeFileBtn.addEventListener("click", resetFile);

function resetFile() {
selectedFile = null;

```
if (previewURL) {
    URL.revokeObjectURL(previewURL);
    previewURL = null;
}

if (downloadURL) {
    URL.revokeObjectURL(downloadURL);
    downloadURL = null;
}

fileInput.value = "";

audioPreview.pause();
audioPreview.removeAttribute("src");
audioPreview.load();

fileInfo.style.display = "none";
audioPreview.style.display = "none";
removeFileBtn.style.display = "none";
downloadArea.style.display = "none";

progressContainer.style.display = "none";
progressBar.style.width = "0%";

setStatus("Select an audio file to begin.");
```

}

// --------------------------------------------------
// Output format settings
// --------------------------------------------------

outputFormat.addEventListener("change", () => {
const format = outputFormat.value;

```
if (format === "wav" || format === "flac") {
    qualityGroup.style.display = "none";
} else {
    qualityGroup.style.display = "block";
}
```

});

// --------------------------------------------------
// Load FFmpeg
// --------------------------------------------------

async function loadFFmpeg() {
if (ffmpegLoaded) {
return true;
}

```
if (ffmpegLoading) {
    return false;
}

ffmpegLoading = true;

try {
    setStatus("Loading audio converter...");

    const { toBlobURL } = window.FFmpegUtil;

    ffmpeg = new FFmpeg();

    ffmpeg.on("log", ({ message }) => {
        console.log("[FFmpeg]", message);
    });

    ffmpeg.on("progress", ({ progress }) => {
        if (progress >= 0 && progress <= 1) {
            progressBar.style.width = `${Math.round(progress * 100)}%`;
        }
    });

    const baseURL =
        "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";

    const coreURL = await toBlobURL(
        `${baseURL}/ffmpeg-core.js`,
        "text/javascript"
    );

    const wasmURL = await toBlobURL(
        `${baseURL}/ffmpeg-core.wasm`,
        "application/wasm"
    );

    await ffmpeg.load({
        coreURL,
        wasmURL
    });

    ffmpegLoaded = true;
    ffmpegLoading = false;

    return true;

} catch (error) {
    console.error("FFmpeg loading error:", error);

    ffmpegLoading = false;

    setStatus(
        "Could not load the audio converter. Please refresh the page and try again.",
        true
    );

    return false;
}
```

}

// --------------------------------------------------
// Conversion
// --------------------------------------------------

convertBtn.addEventListener("click", async () => {
if (!selectedFile) {
setStatus("Please select an audio file first.", true);
return;
}

```
convertBtn.disabled = true;

progressContainer.style.display = "block";
progressBar.style.width = "0%";
downloadArea.style.display = "none";

try {
    const loaded = await loadFFmpeg();

    if (!loaded || !ffmpegLoaded) {
        throw new Error("FFmpeg could not be loaded.");
    }

    setStatus("Preparing your audio...");

    const inputExtension = getExtension(selectedFile.name);
    const outputExtension = outputFormat.value;

    const inputName = `input.${inputExtension}`;
    const outputName = `evantine-converted.${outputExtension}`;

    const fileData = new Uint8Array(
        await selectedFile.arrayBuffer()
    );

    await ffmpeg.writeFile(inputName, fileData);

    setStatus("Converting audio...");
    progressBar.style.width = "10%";

    const command = buildFFmpegCommand(
        inputName,
        outputName,
        outputExtension
    );

    console.log("FFmpeg command:", command);

    const exitCode = await ffmpeg.exec(command);

    if (exitCode !== 0) {
        throw new Error(`FFmpeg conversion failed with code ${exitCode}`);
    }

    setStatus("Preparing download...");
    progressBar.style.width = "90%";

    const outputData = await ffmpeg.readFile(outputName);

    const mimeType = getMimeType(outputExtension);

    const blob = new Blob([outputData.buffer], {
        type: mimeType
    });

    if (downloadURL) {
        URL.revokeObjectURL(downloadURL);
    }

    downloadURL = URL.createObjectURL(blob);

    downloadBtn.href = downloadURL;
    downloadBtn.download = outputName;

    downloadArea.style.display = "block";

    progressBar.style.width = "100%";

    setStatus("Conversion complete.");

    // Clean up FFmpeg files
    try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
    } catch (cleanupError) {
        console.warn("Cleanup warning:", cleanupError);
    }

} catch (error) {
    console.error("Conversion error:", error);

    progressBar.style.width = "0%";

    setStatus(
        "Conversion failed. Please try another audio file or format.",
        true
    );

} finally {
    convertBtn.disabled = false;
}
```

});

// --------------------------------------------------
// FFmpeg commands
// --------------------------------------------------

function buildFFmpegCommand(inputName, outputName, format) {
const bitrate = quality.value;

```
switch (format) {

    case "mp3":
        return [
            "-i",
            inputName,
            "-vn",
            "-codec:a",
            "libmp3lame",
            "-b:a",
            `${bitrate}k`,
            outputName
        ];

    case "wav":
        return [
            "-i",
            inputName,
            "-vn",
            "-c:a",
            "pcm_s16le",
            outputName
        ];

    case "flac":
        return [
            "-i",
            inputName,
            "-vn",
            "-c:a",
            "flac",
            outputName
        ];

    case "ogg":
        return [
            "-i",
            inputName,
            "-vn",
            "-c:a",
            "libvorbis",
            "-b:a",
            `${bitrate}k`,
            outputName
        ];

    case "m4a":
        return [
            "-i",
            inputName,
            "-vn",
            "-c:a",
            "aac",
            "-b:a",
            `${bitrate}k`,
            outputName
        ];

    case "aac":
        return [
            "-i",
            inputName,
            "-vn",
            "-c:a",
            "aac",
            "-b:a",
            `${bitrate}k`,
            "-f",
            "adts",
            outputName
        ];

    case "opus":
        return [
            "-i",
            inputName,
            "-vn",
            "-c:a",
            "libopus",
            "-b:a",
            `${bitrate}k`,
            outputName
        ];

    default:
        throw new Error("Unsupported output format.");
}
```

}

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function getExtension(filename) {
const parts = filename.split(".");

```
if (parts.length < 2) {
    return "audio";
}

return parts.pop().toLowerCase();
```

}

function getMimeType(format) {
switch (format) {
case "mp3":
return "audio/mpeg";

```
    case "wav":
        return "audio/wav";

    case "flac":
        return "audio/flac";

    case "ogg":
        return "audio/ogg";

    case "m4a":
        return "audio/mp4";

    case "aac":
        return "audio/aac";

    case "opus":
        return "audio/opus";

    default:
        return "application/octet-stream";
}
```

}

function formatFileSize(bytes) {
if (bytes === 0) {
return "0 Bytes";
}

```
const units = [
    "Bytes",
    "KB",
    "MB",
    "GB"
];

const index = Math.floor(
    Math.log(bytes) / Math.log(1024)
);

return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
```

}

function formatDuration(seconds) {
const minutes = Math.floor(seconds / 60);
const remainingSeconds = Math.floor(seconds % 60);

```
return `${minutes}:${remainingSeconds
    .toString()
    .padStart(2, "0")}`;
```

}

function setStatus(message, isError = false) {
if (!statusText) {
return;
}

```
statusText.textContent = message;

if (isError) {
    statusText.classList.add("error");
} else {
    statusText.classList.remove("error");
}
```

}

// Initial state
progressContainer.style.display = "none";
fileInfo.style.display = "none";
audioPreview.style.display = "none";
removeFileBtn.style.display = "none";
downloadArea.style.display = "none";
