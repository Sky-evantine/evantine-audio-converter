import { chromium } from "playwright";
import { spawn } from "node:child_process";

const port = 4173;
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { stdio: "ignore" });

function makeWav(seconds = 0.25, sampleRate = 8000) {
    const samples = Math.floor(seconds * sampleRate);
    const dataSize = samples * 2;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write("WAVE", 8);
    buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 6000), 44 + i * 2);
    return buffer;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
page.on("console", message => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
page.on("requestfailed", request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText || "unknown"}`));

async function assertDownload(extension) {
    const link = page.locator("#downloadArea a");
    try {
        await link.waitFor({ state: "attached", timeout: 15000 });
    } catch (error) {
        const state = await page.evaluate(() => ({
            status: document.querySelector("#status")?.textContent,
            buttonDisabled: document.querySelector("#convertButton")?.disabled,
            selectedFile: document.querySelector("#fileName")?.textContent,
            outputFormat: document.querySelector("#format")?.value,
            downloadCount: document.querySelectorAll("#downloadArea a").length
        }));
        throw new Error(`No ${extension.toUpperCase()} download link. State: ${JSON.stringify(state)}. Errors: ${errors.join(" | ")}. Original: ${error.message}`);
    }
    const result = await link.evaluate(anchor => ({ href: anchor.href, download: anchor.download }));
    if (!result.href.startsWith("blob:")) throw new Error(`${extension.toUpperCase()} conversion did not create a blob download`);
    if (result.download !== `smoke-test.${extension}`) throw new Error(`Unexpected ${extension.toUpperCase()} filename: ${result.download}`);
}

try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 120000 });
    await page.locator("#fileInput").setInputFiles({ name: "smoke-test.wav", mimeType: "audio/wav", buffer: makeWav() });

    await page.locator("#fileName").waitFor({ state: "attached" });
    await page.waitForFunction(() => document.querySelector("#convertButton")?.disabled === false);
    const selectedName = await page.locator("#fileName").textContent();
    if (selectedName !== "Selected: smoke-test.wav") throw new Error(`File selection failed: ${selectedName}`);

    await page.selectOption("#format", "wav");
    await page.locator("#convertButton").click();
    await assertDownload("wav");

    await page.selectOption("#format", "mp3");
    await page.locator("#convertButton").click();
    await assertDownload("mp3");

    if (errors.length) throw new Error(`Browser reported errors: ${errors.join(" | ")}`);
    console.log("Browser smoke test passed: WAV and MP3 conversion produced downloads.");
} finally {
    await browser.close();
    server.kill();
}
