const FFmpegClass = FFmpegWASM.FFmpeg;

const ffmpeg = new FFmpegClass();

const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");
const format = document.getElementById("format");
const convertButton = document.getElementById("convertButton");
const status = document.getElementById("status");
const downloadArea = document.getElementById("downloadArea");

let selectedFile = null;
let ffmpegLoaded = false;


async function toBlobURL(url, mimeType) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error("Could not load FFmpeg.");
    }

    const blob = await response.blob();

    return URL.createObjectURL(
        new Blob([blob], { type: mimeType })
    );
}


async function loadFFmpeg() {

    if (ffmpegLoaded) {
        return;
    }

    status.textContent = "Loading converter...";

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

    status.textContent = "Converter ready.";
}


fileInput.addEventListener("change", function () {

    selectedFile = fileInput.files[0];

    if (!selectedFile) {
        return;
    }

    fileName.textContent =
        "Selected: " + selectedFile.name;

    convertButton.disabled = false;

    status.textContent = "Ready to convert.";

    downloadArea.innerHTML = "";
});


convertButton.addEventListener("click", async function () {

    if (!selectedFile) {
        status.textContent = "Please choose an audio file.";
        return;
    }

    try {

        convertButton.disabled = true;

        await loadFFmpeg();

        status.textContent = "Converting...";

        const inputName = "input";

        const outputFormat = format.value;

        const outputName = `output.${outputFormat}`;

        const data = await selectedFile.arrayBuffer();

        await ffmpeg.writeFile(
            inputName,
            new Uint8Array(data)
        );

        await ffmpeg.exec([
            "-i",
            inputName,
            outputName
        ]);

        const output = await ffmpeg.readFile(outputName);

        const blob = new Blob(
            [output.buffer],
            { type: `audio/${outputFormat}` }
        );

        const url = URL.createObjectURL(blob);

        const downloadButton = document.createElement("a");

        downloadButton.href = url;
        downloadButton.download =
            selectedFile.name.replace(/\.[^/.]+$/, "") +
            "." +
            outputFormat;

        downloadButton.textContent =
            "Download Converted Audio";

        downloadButton.className =
            "download-button";

        downloadArea.innerHTML = "";

        downloadArea.appendChild(downloadButton);

        status.textContent = "Conversion complete!";

        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);

    } catch (error) {

        console.error(error);

        status.textContent =
            "Conversion failed. Check the browser console.";

    }

    convertButton.disabled = false;
});