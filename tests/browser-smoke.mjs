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
const errors = [];
page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
page.on("console", message => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 120000 });
    await page.locator("#fileInput").setInputFiles({ name: "smoke-test.wav", mimeType: "audio/wav", buffer: makeWav() });

    await page.selectOption("#format", "wav");
    await page.locator("#convertButton").click();
    await page.locator("#downloadArea a").waitFor({ state: "visible", timeout: 30000 });
    const wavResult = await page.locator("#downloadArea a").evaluate(link => ({ href: link.href, download: link.download }));
    if (!wavResult.href.startsWith("blob:")) throw new Error("WAV conversion did not create a blob download");
    if (wavResult.download !== "smoke-test.wav") throw new Error(`Unexpected WAV filename: ${wavResult.download}`);

    await page.selectOption("#format", "mp3");
    await page.locator("#convertButton").click();
    await page.locator("#downloadArea a").waitFor({ state: "visible", timeout: 60000 });
    const mp3Result = await page.locator("#downloadArea a").evaluate(link => ({ href: link.href, download: link.download }));
    if (!mp3Result.href.startsWith("blob:")) throw new Error("MP3 conversion did not create a blob download");
    if (mp3Result.download !== "smoke-test.mp3") throw new Error(`Unexpected MP3 filename: ${mp3Result.download}`);

    if (errors.length) throw new Error(`Browser reported errors: ${errors.join(" | ")}`);
    console.log("Browser smoke test passed: WAV and MP3 conversion produced downloads.");
} finally {
    await browser.close();
    server.kill();
}
