import { chromium } from "playwright";
import { spawn } from "node:child_process";

const port = 4173;
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  stdio: "ignore"
});

function makeWav(seconds = 0.25, sampleRate = 8000) {
  const samples = Math.floor(seconds * sampleRate);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;

  buffer.write("RIFF", offset); offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
  buffer.write("WAVE", offset); offset += 4;
  buffer.write("fmt ", offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;
  buffer.writeUInt16LE(1, offset); offset += 2;
  buffer.writeUInt16LE(1, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(sampleRate * 2, offset); offset += 4;
  buffer.writeUInt16LE(2, offset); offset += 2;
  buffer.writeUInt16LE(16, offset); offset += 2;
  buffer.write("data", offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  for (let i = 0; i < samples; i += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 6000);
    buffer.writeInt16LE(sample, offset);
    offset += 2;
  }

  return buffer;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(500);

  const libraryState = await page.evaluate(() => ({
    hasGlobal: Boolean(window.FFmpegWASM),
    hasConstructor: Boolean(window.FFmpegWASM?.FFmpeg)
  }));

  if (!libraryState.hasConstructor) {
    throw new Error(`FFmpeg UMD did not initialize: ${JSON.stringify(libraryState)}${errors.length ? `; ${errors.join(" | ")}` : ""}`);
  }

  const wav = makeWav();
  await page.locator("#fileInput").setInputFiles({
    name: "smoke-test.wav",
    mimeType: "audio/wav",
    buffer: wav
  });

  await page.selectOption("#format", "mp3");
  await page.locator("#convertButton").click();

  await page.locator("#downloadArea a").waitFor({ state: "visible", timeout: 180000 });

  const result = await page.locator("#downloadArea a").evaluate((link) => ({
    text: link.textContent,
    href: link.href,
    download: link.download
  }));

  if (!result.href.startsWith("blob:")) {
    throw new Error(`Conversion did not produce a blob download: ${result.href}`);
  }
  if (result.download !== "smoke-test.mp3") {
    throw new Error(`Unexpected output filename: ${result.download}`);
  }
  if (errors.length) {
    throw new Error(`Browser reported errors: ${errors.join(" | ")}`);
  }

  console.log("Browser smoke test passed:", result);
} finally {
  await browser.close();
  server.kill();
}
