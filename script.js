(function () {
    "use strict";

    /** @typedef {{ extension: string, mime: string, args: string[] }} OutputType */
    /** @typedef {{ state?: "default" | "error" | "success", progress?: number }} StatusOptions */

    const ffmpegCoreVersion = "0.12.10";
    const ffmpegCoreBaseUrl = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${ffmpegCoreVersion}/dist/umd`;

    /** @type {Record<string, OutputType>} */
    const outputTypes = {
        mp3: { extension: "mp3", mime: "audio/mpeg", args: ["-codec:a", "libmp3lame", "-b:a", "192k"] },
        wav: { extension: "wav", mime: "audio/wav", args: ["-codec:a", "pcm_s16le"] },
        ogg: { extension: "ogg", mime: "audio/ogg", args: ["-codec:a", "libvorbis", "-q:a", "5"] },
        flac: { extension: "flac", mime: "audio/flac", args: ["-codec:a", "flac"] },
        aac: { extension: "aac", mime: "audio/aac", args: ["-codec:a", "aac", "-b:a", "192k"] },
        m4a: { extension: "m4a", mime: "audio/mp4", args: ["-codec:a", "aac", "-b:a", "192k"] }
    };

    /**
     * @template {HTMLElement} T
     * @param {string} id
     * @param {new (...args: any[]) => T} elementType
     * @returns {T}
     */
    function getRequiredElement(id, elementType) {
        const element = document.getElementById(id);

        if (!(element instanceof elementType)) {
            throw new Error(`Missing required page element: ${id}`);
        }

        return element;
    }

    const elements = {
        dropZone: getRequiredElement("dropZone", HTMLDivElement),
        fileInput: getRequiredElement("fileInput", HTMLInputElement),
        fileDetails: getRequiredElement("fileDetails", HTMLParagraphElement),
        format: getRequiredElement("format", HTMLSelectElement),
        convertButton: getRequiredElement("convertButton", HTMLButtonElement),
        statusLabel: getRequiredElement("statusLabel", HTMLSpanElement),
        progressText: getRequiredElement("progressText", HTMLSpanElement),
        progressBar: getRequiredElement("progressBar", HTMLSpanElement),
        downloadArea: getRequiredElement("downloadArea", HTMLDivElement)
    };

    /** @type {Window & { FFmpegWASM?: { FFmpeg: new () => any } }} */
    const browserWindow = window;
    /** @type {File | null} */
    let selectedFile = null;
    /** @type {any} */
    let ffmpeg = null;
    let ffmpegReady = false;
    /** @type {string | null} */
    let activeDownloadUrl = null;

    /**
     * @param {string} message
     * @param {StatusOptions=} options
     */
    function setStatus(message, options) {
        const state = options && options.state ? options.state : "default";
        const progress = options && typeof options.progress === "number" ? options.progress : null;

        elements.statusLabel.textContent = message;
        elements.statusLabel.classList.toggle("status-error", state === "error");
        elements.statusLabel.classList.toggle("status-success", state === "success");

        if (progress !== null) {
            const safeProgress = Math.max(0, Math.min(100, Math.round(progress)));
            elements.progressBar.style.width = `${safeProgress}%`;
            elements.progressText.textContent = `${safeProgress}%`;
        }
    }

    function clearDownload() {
        if (activeDownloadUrl) {
            URL.revokeObjectURL(activeDownloadUrl);
            activeDownloadUrl = null;
        }

        elements.downloadArea.replaceChildren();
    }

    /**
     * @param {number} bytes
     * @returns {string}
     */
    function formatFileSize(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) {
            return "Unknown size";
        }

        const units = ["B", "KB", "MB", "GB"];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex += 1;
        }

        return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
    }

    /**
     * @param {string} fileName
     * @returns {string}
     */
    function sanitizeBaseName(fileName) {
        const withoutExtension = fileName.replace(/\.[^/.]+$/, "");
        const normalized = withoutExtension
            .trim()
            .replace(/[^a-z0-9-_]+/gi, "-")
            .replace(/^-+|-+$/g, "");

        return normalized || "converted-audio";
    }

    /**
     * @param {string} url
     * @param {string} mimeType
     * @returns {Promise<string>}
     */
    async function toBlobUrl(url, mimeType) {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Could not load ${url}`);
        }

        const blob = await response.blob();
        return URL.createObjectURL(new Blob([blob], { type: mimeType }));
    }

    async function loadConverter() {
        if (ffmpegReady) {
            return;
        }

        if (!browserWindow.FFmpegWASM || !browserWindow.FFmpegWASM.FFmpeg) {
            throw new Error("The converter library did not load. Check the network connection or content blockers.");
        }

        setStatus("Loading converter engine...", { progress: 8 });

        /** @param {{ progress?: number }} event */
        const updateProgress = function (event) {
            if (typeof event.progress === "number") {
                setStatus("Converting file...", { progress: 15 + event.progress * 80 });
            }
        };

        ffmpeg = new browserWindow.FFmpegWASM.FFmpeg();
        ffmpeg.on("progress", updateProgress);

        const coreUrl = await toBlobUrl(`${ffmpegCoreBaseUrl}/ffmpeg-core.js`, "text/javascript");
        const wasmUrl = await toBlobUrl(`${ffmpegCoreBaseUrl}/ffmpeg-core.wasm`, "application/wasm");

        await ffmpeg.load({
            coreURL: coreUrl,
            wasmURL: wasmUrl
        });

        ffmpegReady = true;
        setStatus("Converter ready", { progress: 12 });
    }

    /**
     * @param {File | undefined | null} file
     */
    function setSelectedFile(file) {
        clearDownload();

        if (!file) {
            selectedFile = null;
            elements.fileDetails.textContent = "No file selected";
            elements.convertButton.disabled = true;
            setStatus("Waiting for a file", { progress: 0 });
            return;
        }

        if (!file.type.startsWith("audio/")) {
            selectedFile = null;
            elements.fileInput.value = "";
            elements.fileDetails.textContent = "No file selected";
            elements.convertButton.disabled = true;
            setStatus("Choose an audio file to continue.", { state: "error", progress: 0 });
            return;
        }

        selectedFile = file;
        elements.fileDetails.textContent = `${file.name} (${formatFileSize(file.size)})`;
        elements.convertButton.disabled = false;
        setStatus("Ready to convert", { progress: 0 });
    }

    /**
     * @param {string} fileName
     */
    async function removeVirtualFile(fileName) {
        try {
            await ffmpeg.deleteFile(fileName);
        } catch (error) {
            console.warn(`Could not remove ${fileName} from the converter workspace.`, error);
        }
    }

    async function convertSelectedFile() {
        if (!selectedFile) {
            setStatus("Choose an audio file to continue.", { state: "error", progress: 0 });
            return;
        }

        const outputType = outputTypes[elements.format.value];

        if (!outputType) {
            setStatus("Choose a supported output format.", { state: "error", progress: 0 });
            return;
        }

        const inputName = `input-${Date.now()}`;
        const outputName = `output.${outputType.extension}`;

        elements.convertButton.disabled = true;
        clearDownload();

        try {
            await loadConverter();

            setStatus("Preparing file...", { progress: 14 });

            const inputData = new Uint8Array(await selectedFile.arrayBuffer());
            await ffmpeg.writeFile(inputName, inputData);

            const command = [
                "-hide_banner",
                "-y",
                "-i",
                inputName,
                ...outputType.args,
                outputName
            ];

            setStatus("Converting file...", { progress: 18 });
            await ffmpeg.exec(command);

            const outputData = await ffmpeg.readFile(outputName);
            const blob = new Blob([outputData], { type: outputType.mime });
            const downloadName = `${sanitizeBaseName(selectedFile.name)}.${outputType.extension}`;

            activeDownloadUrl = URL.createObjectURL(blob);

            const downloadButton = document.createElement("a");
            downloadButton.className = "download-button";
            downloadButton.href = activeDownloadUrl;
            downloadButton.download = downloadName;
            downloadButton.textContent = `Download ${downloadName}`;

            const meta = document.createElement("p");
            meta.className = "download-meta";
            meta.textContent = `Converted file size: ${formatFileSize(blob.size)}`;

            elements.downloadArea.replaceChildren(downloadButton, meta);
            setStatus("Conversion complete", { state: "success", progress: 100 });
        } catch (error) {
            console.error(error);
            const message = error instanceof Error
                ? error.message
                : "Conversion failed. Try a different file or format.";

            setStatus(message, {
                state: "error",
                progress: 0
            });
        } finally {
            if (ffmpegReady) {
                await removeVirtualFile(inputName);
                await removeVirtualFile(outputName);
            }

            elements.convertButton.disabled = !selectedFile;
        }
    }

    elements.fileInput.addEventListener("change", function () {
        setSelectedFile(elements.fileInput.files && elements.fileInput.files[0]);
    });

    elements.format.addEventListener("change", function () {
        clearDownload();

        if (selectedFile) {
            setStatus("Ready to convert", { progress: 0 });
        }
    });

    elements.convertButton.addEventListener("click", function () {
        convertSelectedFile();
    });

    ["dragenter", "dragover"].forEach(function (eventName) {
        elements.dropZone.addEventListener(eventName, function (event) {
            event.preventDefault();
            elements.dropZone.classList.add("is-dragging");
        });
    });

    ["dragleave", "drop"].forEach(function (eventName) {
        elements.dropZone.addEventListener(eventName, function (event) {
            event.preventDefault();
            elements.dropZone.classList.remove("is-dragging");
        });
    });

    elements.dropZone.addEventListener("drop", function (event) {
        if (!(event instanceof DragEvent)) {
            return;
        }

        const file = event.dataTransfer && event.dataTransfer.files[0];
        setSelectedFile(file);
    });
}());
