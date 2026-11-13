import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

// Loops transcription: a provider turns a recording into text (scripts/loops.mjs `transcribePending` is the interface; nothing else
// knows which engine is used). The first provider is whisper.cpp run on the server as a slow, low-priority background job:
// audio is converted to 16 kHz mono WAV with ffmpeg, then read by whisper-cli. Nothing is sent to any outside service.

const EXTENSION = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/mpeg": "mp3", "audio/wav": "wav" };

/** Run a command at low priority (nice) and resolve with its stdout; reject with a short message (never the audio or the text) on failure. */
export function runCommand(command, args, { niceLevel = 19, timeoutMs = 45 * 60_000, spawnFn = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const useNice = niceLevel != null && process.platform !== "win32";
    const child = spawnFn(useNice ? "nice" : command, useNice ? ["-n", String(niceLevel), command, ...args] : args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "", done = false;
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(reject, new Error(`${path.basename(command)} took longer than ${Math.round(timeoutMs / 60_000)} minutes`)); }, timeoutMs);
    child.stdout.on("data", (c) => { out += c; if (out.length > 5e6) { child.kill("SIGKILL"); finish(reject, new Error("The transcript was unexpectedly large")); } });
    child.stderr.on("data", (c) => { err = (err + c).slice(-2000); });
    child.on("error", () => finish(reject, new Error(`${path.basename(command)} could not be started`)));
    child.on("close", (code) => (code === 0 ? finish(resolve, out) : finish(reject, new Error(`${path.basename(command)} failed (exit ${code}): ${err.trim().split("\n").pop()?.slice(0, 160) ?? ""}`))));
  });
}

/** Whisper's own markers for silence and noise ("[BLANK_AUDIO]", "[ Silence ]", "(music)") are not speech. */
export function cleanTranscript(raw) {
  return String(raw ?? "").replace(/\[\s*(?:blank_audio|silence|music|noise|applause|laughter|inaudible)\s*\]|\(\s*(?:music|silence|noise|applause|laughter)\s*\)/gi, " ").replace(/\s+/g, " ").trim();
}

export function whisperCppProvider({ whisperBin, model, ffmpegBin = "ffmpeg", threads = 1, language = "en", niceLevel = 19, timeoutMs = 45 * 60_000, tmpDir = os.tmpdir(), run = runCommand } = {}) {
  return {
    name: "whisper.cpp",
    async transcribe(buffer, mime) {
      const dir = await fs.mkdtemp(path.join(tmpDir, "loops-whisper-"));
      try {
        const input = path.join(dir, `in.${EXTENSION[String(mime).split(";")[0].toLowerCase()] ?? "audio"}`), wav = path.join(dir, "out.wav");
        await fs.writeFile(input, buffer, { mode: 0o600 });
        await run(ffmpegBin, ["-nostdin", "-loglevel", "error", "-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], { niceLevel, timeoutMs: 10 * 60_000 });
        const out = await run(whisperBin, ["-m", model, "-f", wav, "-t", String(threads), "-l", language, "-nt", "-np"], { niceLevel, timeoutMs });
        return cleanTranscript(out);
      } finally { await fs.rm(dir, { recursive: true, force: true }); }
    },
  };
}

/**
 * The provider the environment asks for, or { provider: null, reason }. LOOPS_TRANSCRIBER=whisper-cpp with LOOPS_WHISPER_BIN and
 * LOOPS_WHISPER_MODEL (files that exist); optional LOOPS_FFMPEG_BIN, LOOPS_WHISPER_THREADS (default 1), LOOPS_WHISPER_LANG (default en).
 */
export function providerFromEnv(env = process.env) {
  const kind = String(env.LOOPS_TRANSCRIBER ?? "").trim();
  if (!kind) return { provider: null, reason: "LOOPS_TRANSCRIBER is not set" };
  if (kind !== "whisper-cpp") return { provider: null, reason: `Unknown transcriber "${kind}"` };
  const whisperBin = env.LOOPS_WHISPER_BIN, model = env.LOOPS_WHISPER_MODEL;
  if (!whisperBin || !existsSync(whisperBin)) return { provider: null, reason: "LOOPS_WHISPER_BIN does not point to whisper-cli" };
  if (!model || !existsSync(model)) return { provider: null, reason: "LOOPS_WHISPER_MODEL does not point to a model file" };
  return { provider: whisperCppProvider({ whisperBin, model, ffmpegBin: env.LOOPS_FFMPEG_BIN || "ffmpeg", threads: Math.max(1, Number(env.LOOPS_WHISPER_THREADS) || 1), language: env.LOOPS_WHISPER_LANG || "en" }), reason: null };
}
