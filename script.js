/* =========================
   EVANTINE AUDIO TOOLS
   MAIN JAVASCRIPT
========================= */


/* =========================
   ELEMENTS
========================= */

const fileInput =
    document.getElementById("fileInput");

const chooseButton =
    document.getElementById("chooseButton");

const dropZone =
    document.getElementById("dropZone");

const fileInfo =
    document.getElementById("fileInfo");

const fileName =
    document.getElementById("fileName");

const fileSize =
    document.getElementById("fileSize");

const fileType =
    document.getElementById("fileType");

const fileDuration =
    document.getElementById("fileDuration");

const audioPreview =
    document.getElementById("audioPreview");

const removeButton =
    document.getElementById("removeButton");

const settings =
    document.getElementById("settings");

const formatSelect =
    document.getElementById("format");

const qualitySelect =
    document.getElementById("quality");

const qualityGroup =
    document.getElementById("qualityGroup");

const convertButton =
    document.getElementById("convertButton");

const progressContainer =
    document.getElementById("progressContainer");

const progressFill =
    document.getElementById("progressFill");

const progressPercent =
    document.getElementById("progressPercent");

const progressText =
    document.getElementById("progressText");

const status =
    document.getElementById("status");

const downloadArea =
    document.getElementById("downloadArea");


/* =========================
   STATE
========================= */

let selectedFile = null;

let previewURL = null;

let downloadURL = null;

let ffmpeg = null;

let ffmpegLoaded = false;

let ffmpegLoading = false;


/* =========================
   FILE BUTTON
========================= */

chooseButton.addEventListener(
    "click",
    function () {

        fileInput.click();

    }
);


/* =========================
   FILE INPUT
========================= */

fileInput.addEventListener(
    "change",
    function () {

        const file =
            fileInput.files[0];

        if (file) {

            loadFile(file);

        }

    }
);


/* =========================
   LOAD FILE
========================= */

function loadFile(file) {


    if (
        !file.type.startsWith("audio/") &&
        !isSupportedAudio(file.name)
    ) {

        showStatus(
            "Please select a supported audio file."
        );

        return;

    }


    selectedFile = file;


    fileName.textContent =
        file.name;


    fileSize.textContent =
        formatFileSize(file.size);


    fileType.textContent =
        getFileExtension(file.name)
            .toUpperCase();


    fileInfo.hidden = false;

    settings.hidden = false;

    convertButton.disabled = false;


    downloadArea.innerHTML = "";

    progressContainer.hidden = true;

    updateProgress(0);


    if (previewURL) {

        URL.revokeObjectURL(
            previewURL
        );

    }


    previewURL =
        URL.createObjectURL(file);


    audioPreview.src =
        previewURL;


    audioPreview.load();


    audioPreview.addEventListener(
        "loadedmetadata",
        function () {

            if (
                Number.isFinite(
                    audioPreview.duration
                )
            ) {

                fileDuration.textContent =
                    formatDuration(
                        audioPreview.duration
                    );

            }

        },
        {
            once: true
        }
    );


    showStatus("");

}


/* =========================
   REMOVE FILE
========================= */

removeButton.addEventListener(
    "click",
    resetConverter
);


function resetConverter() {


    selectedFile = null;


    fileInput.value = "";


    fileInfo.hidden = true;

    settings.hidden = true;


    convertButton.disabled = true;


    progressContainer.hidden = true;


    downloadArea.innerHTML = "";


    audioPreview.pause();

    audioPreview.removeAttribute(
        "src"
    );

    audioPreview.load();


    if (previewURL) {

        URL.revokeObjectURL(
            previewURL
        );

        previewURL = null;

    }


    if (downloadURL) {

        URL.revokeObjectURL(
            downloadURL
        );

        downloadURL = null;

    }


    updateProgress(0);

    showStatus("");

}


/* =========================
   DRAG AND DROP
========================= */

dropZone.addEventListener(
    "dragover",
    function (event) {

        event.preventDefault();

        dropZone.classList.add(
            "dragging"
        );

    }
);


dropZone.addEventListener(
    "dragleave",
    function () {

        dropZone.classList.remove(
            "dragging"
        );

    }
);


dropZone.addEventListener(
    "drop",
    function (event) {

        event.preventDefault();


        dropZone.classList.remove(
            "dragging"
        );


        const file =
            event.dataTransfer.files[0];


        if (file) {

            loadFile(file);

        }

    }
);


/* =========================
   FORMAT SETTINGS
========================= */

formatSelect.addEventListener(
    "change",
    updateQualitySetting
);


function updateQualitySetting() {


    const format =
        formatSelect.value;


    if (
        format === "wav" ||
        format === "flac"
    ) {

        qualityGroup.style.display =
            "none";

    }

    else {

        qualityGroup.style.display =
            "flex";

    }

}


/* =========================
   LOAD FFMPEG
========================= */

async function loadFFmpeg() {


    if (ffmpegLoaded) {

        return;

    }


    if (ffmpegLoading) {

        while (ffmpegLoading) {

            await wait(100);

        }

        return;

    }


    ffmpegLoading = true;


    showStatus(
        "Loading converter engine..."
    );


    progressContainer.hidden =
        false;


    progressText.textContent =
        "Loading converter";


    updateProgress(5);


    try {


        if (
            typeof FFmpeg ===
            "undefined"
        ) {

            throw new Error(
                "FFmpeg library was not loaded."
            );

        }


        const {
            FFmpeg
        } = window.FFmpeg;


        ffmpeg =
            new FFmpeg();


        ffmpeg.on(
            "progress",
            function ({
                progress
            }) {

                const percent =
                    Math.round(
                        progress * 100
                    );


                updateProgress(
                    Math.max(
                        10,
                        Math.min(
                            95,
                            percent
                        )
                    )
                );

            }
        );


        ffmpeg.on(
            "log",
            function ({
                message
            }) {

                console.log(
                    "FFmpeg:",
                    message
                );

            }
        );


        const baseURL =
            "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";


        await ffmpeg.load({

            coreURL:
                baseURL +
                "/ffmpeg-core.js",

            wasmURL:
                baseURL +
                "/ffmpeg-core.wasm"

        });


        ffmpegLoaded =
            true;


        showStatus(
            "Converter ready."
        );


    }

    catch (error) {

        console.error(error);


        ffmpegLoaded =
            false;


        showStatus(
            "The converter engine could not load."
        );


        throw error;

    }

    finally {

        ffmpegLoading =
            false;

    }

}


/* =========================
   CONVERT
========================= */

convertButton.addEventListener(
    "click",
    convertAudio
);


async function convertAudio() {


    if (!selectedFile) {

        showStatus(
            "Choose an audio file first."
        );

        return;

    }


    convertButton.disabled =
        true;


    downloadArea.innerHTML =
        "";


    progressContainer.hidden =
        false;


    updateProgress(1);


    try {


        await loadFFmpeg();


        progressText.textContent =
            "Preparing audio";


        updateProgress(10);


        const extension =
            getFileExtension(
                selectedFile.name
            );


        const inputName =
            "evantine_input_" +
            Date.now() +
            "." +
            extension;


        const format =
            formatSelect.value;


        const outputName =
            "evantine_output_" +
            Date.now() +
            "." +
            format;


        const fileData =
            new Uint8Array(
                await selectedFile.arrayBuffer()
            );


        await ffmpeg.writeFile(
            inputName,
            fileData
        );


        updateProgress(15);


        progressText.textContent =
            "Converting audio";


        const command =
            buildFFmpegCommand(
                inputName,
                outputName,
                format
            );


        await ffmpeg.exec(
            command
        );


        updateProgress(95);


        progressText.textContent =
            "Preparing download";


        const outputData =
            await ffmpeg.readFile(
                outputName
            );


        const mimeType =
            getMimeType(format);


        const blob =
            new Blob(
                [outputData.buffer],
                {
                    type: mimeType
                }
            );


        if (downloadURL) {

            URL.revokeObjectURL(
                downloadURL
            );

        }


        downloadURL =
            URL.createObjectURL(
                blob
            );


        const originalName =
            selectedFile.name
                .replace(
                    /\.[^/.]+$/,
                    ""
                );


        const finalName =
            originalName +
            "." +
            format;


        createDownloadButton(
            downloadURL,
            finalName
        );


        updateProgress(100);


        progressText.textContent =
            "Complete";


        showStatus(
            "Your audio is ready."
        );


        try {

            await ffmpeg.deleteFile(
                inputName
            );

            await ffmpeg.deleteFile(
                outputName
            );

        }

        catch (cleanupError) {

            console.warn(
                "Cleanup warning:",
                cleanupError
            );

        }


    }

    catch (error) {

        console.error(
            "Conversion error:",
            error
        );


        progressContainer.hidden =
            false;


        progressText.textContent =
            "Conversion failed";


        showStatus(
            "Conversion failed. Try a different file or format."
        );

    }

    finally {

        convertButton.disabled =
            false;

    }

}


/* =========================
   FFMPEG COMMANDS
========================= */

function buildFFmpegCommand(
    input,
    output,
    format
) {


    const quality =
        qualitySelect.value;


    switch (format) {


        case "mp3":

            return [

                "-i",
                input,

                "-vn",

                "-c:a",
                "libmp3lame",

                "-b:a",
                quality + "k",

                output

            ];


        case "wav":

            return [

                "-i",
                input,

                "-vn",

                "-c:a",
                "pcm_s16le",

                output

            ];


        case "flac":

            return [

                "-i",
                input,

                "-vn",

                "-c:a",
                "flac",

                output

            ];


        case "ogg":

            return [

                "-i",
                input,

                "-vn",

                "-c:a",
                "libvorbis",

                "-b:a",
                quality + "k",

                output

            ];


        case "m4a":

            return [

                "-i",
                input,

                "-vn",

                "-c:a",
                "aac",

                "-b:a",
                quality + "k",

                output

            ];


        case "aac":

            return [

                "-i",
                input,

                "-vn",

                "-c:a",
                "aac",

                "-b:a",
                quality + "k",

                "-f",
                "adts",

                output

            ];


        case "opus":

            return [

                "-i",
                input,

                "-vn",

                "-c:a",
                "libopus",

                "-b:a",
                quality + "k",

                output

            ];


        default:

            throw new Error(
                "Unsupported format."
            );

    }

}


/* =========================
   DOWNLOAD BUTTON
========================= */

function createDownloadButton(
    url,
    filename
) {


    const link =
        document.createElement(
            "a"
        );


    link.href =
        url;


    link.download =
        filename;


    link.className =
        "download-button";


    link.textContent =
        "Download " +
        filename;


    downloadArea.appendChild(
        link
    );

}


/* =========================
   MIME TYPES
========================= */

function getMimeType(format) {


    const types = {

        mp3:
            "audio/mpeg",

        wav:
            "audio/wav",

        flac:
            "audio/flac",

        ogg:
            "audio/ogg",

        m4a:
            "audio/mp4",

        aac:
            "audio/aac",

        opus:
            "audio/opus"

    };


    return (
        types[format] ||
        "application/octet-stream"
    );

}


/* =========================
   FILE HELPERS
========================= */

function getFileExtension(
    filename
) {


    const match =
        filename.match(
            /\.([^.]+)$/
        );


    if (!match) {

        return "audio";

    }


    return match[1]
        .toLowerCase();

}


function isSupportedAudio(
    filename
) {


    const extension =
        getFileExtension(
            filename
        );


    const supported = [

        "mp3",
        "wav",
        "flac",
        "ogg",
        "m4a",
        "aac",
        "opus",
        "wma",
        "aiff",
        "aif",
        "webm"

    ];


    return supported.includes(
        extension
    );

}


function formatFileSize(
    bytes
) {


    if (bytes === 0) {

        return "0 Bytes";

    }


    const units = [

        "Bytes",
        "KB",
        "MB",
        "GB"

    ];


    const index =
        Math.floor(
            Math.log(bytes) /
            Math.log(1024)
        );


    return (

        parseFloat(

            (
                bytes /
                Math.pow(
                    1024,
                    index
                )
            ).toFixed(2)

        )

        +

        " " +

        units[index]

    );

}


function formatDuration(
    seconds
) {


    if (
        !Number.isFinite(
            seconds
        )
    ) {

        return "0:00";

    }


    const minutes =
        Math.floor(
            seconds / 60
        );


    const remainingSeconds =
        Math.floor(
            seconds % 60
        );


    return (

        minutes +
        ":" +
        String(
            remainingSeconds
        ).padStart(
            2,
            "0"
        )

    );

}


/* =========================
   PROGRESS
========================= */

function updateProgress(
    percent
) {


    percent =
        Math.max(
            0,
            Math.min(
                100,
                percent
            )
        );


    progressFill.style.width =
        percent + "%";


    progressPercent.textContent =
        percent + "%";

}


/* =========================
   STATUS
========================= */

function showStatus(
    message
) {

    status.textContent =
        message;

}


/* =========================
   WAIT
========================= */

function wait(
    milliseconds
) {

    return new Promise(
        function (resolve) {

            setTimeout(
                resolve,
                milliseconds
            );

        }
    );

}


/* =========================
   INITIAL STATE
========================= */

updateQualitySetting();