import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';
import * as L from '../../scripts/loops.mjs';
import { cleanTranscript, providerFromEnv, runCommand, whisperCppProvider } from '../../scripts/loops-transcribe.mjs';

// The whisper.cpp provider is tested with stand-in ffmpeg and whisper-cli scripts, so the real process handling, temp files and
// pipeline run without installing the engine.
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'loops-bins-'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loops-tmp-'));
const script = (name, body) => { const p = path.join(bin, name); fs.writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return p; };
// ffmpeg: copies the input (-i <file>) to the last argument and records its arguments.
const ffmpeg = script('ffmpeg', `echo "$@" >> "${bin}/ffmpeg.args"\nfor last; do :; done\nwhile [ "$1" != "-i" ]; do shift; done\ncp "$2" "$last"`);
const whisper = script('whisper-cli', `echo "$@" >> "${bin}/whisper.args"\nprintf ' Hello, it is Sarah at NVIDIA.\\n [BLANK_AUDIO]\\n'`);
const model = path.join(bin, 'ggml-small.en.bin'); fs.writeFileSync(model, 'x');
const U = 'me@example.com';
let mongo, client;
before(async () => { mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); });
after(async () => { await client.close(); await mongo.stop(); });

test('whisper noise markers are not speech', () => {
  assert.equal(cleanTranscript(' Hello [BLANK_AUDIO]\n there (music) '), 'Hello there');
  assert.equal(cleanTranscript('[ Silence ]'), '');
  assert.equal(cleanTranscript('I paid $5 [now] ok'), 'I paid $5 [now] ok', 'real brackets with lower-case words are kept');
});

test('the provider converts to 16 kHz mono, runs whisper at low priority with the right flags, and cleans up its files', async () => {
  const p = whisperCppProvider({ whisperBin: whisper, model, ffmpegBin: ffmpeg, tmpDir: tmp });
  const text = await p.transcribe(Buffer.from('fake audio'), 'audio/webm;codecs=opus');
  assert.equal(text, 'Hello, it is Sarah at NVIDIA.');
  assert.match(fs.readFileSync(path.join(bin, 'ffmpeg.args'), 'utf8'), /-ar 16000 -ac 1 -c:a pcm_s16le/);
  const args = fs.readFileSync(path.join(bin, 'whisper.args'), 'utf8');
  assert.match(args, new RegExp(`-m ${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -f .*out\\.wav -t 1 -l en -nt -np`));
  assert.deepEqual(fs.readdirSync(tmp), [], 'the temporary audio is removed');
});

test('a failing engine, a missing engine and a hang each reject with a short message and leave nothing behind', async () => {
  const bad = script('whisper-bad', 'echo "model is corrupt" >&2; exit 3');
  await assert.rejects(whisperCppProvider({ whisperBin: bad, model, ffmpegBin: ffmpeg, tmpDir: tmp }).transcribe(Buffer.from('a'), 'audio/mp4'), /whisper-bad failed \(exit 3\): model is corrupt/);
  await assert.rejects(whisperCppProvider({ whisperBin: path.join(bin, 'nope'), model, ffmpegBin: ffmpeg, tmpDir: tmp, niceLevel: null }).transcribe(Buffer.from('a'), 'audio/mp4'), /could not be started/);
  const slow = script('whisper-slow', 'sleep 30');
  await assert.rejects(runCommand(slow, [], { timeoutMs: 300 }), /took longer/);
  assert.deepEqual(fs.readdirSync(tmp), []);
});

test('the environment picks the provider, or says exactly what is missing', () => {
  assert.match(providerFromEnv({}).reason, /not set/);
  assert.match(providerFromEnv({ LOOPS_TRANSCRIBER: 'cloud' }).reason, /Unknown/);
  assert.match(providerFromEnv({ LOOPS_TRANSCRIBER: 'whisper-cpp', LOOPS_WHISPER_BIN: '/nope', LOOPS_WHISPER_MODEL: model }).reason, /whisper-cli/);
  assert.match(providerFromEnv({ LOOPS_TRANSCRIBER: 'whisper-cpp', LOOPS_WHISPER_BIN: whisper, LOOPS_WHISPER_MODEL: '/nope' }).reason, /model/);
  assert.equal(providerFromEnv({ LOOPS_TRANSCRIBER: 'whisper-cpp', LOOPS_WHISPER_BIN: whisper, LOOPS_WHISPER_MODEL: model }).provider.name, 'whisper.cpp');
});

test('recordings are transcribed in turn through the pipeline; silence fails kindly; a restart mid-way is recovered', async () => {
  const db = client.db(`tr${Date.now()}`);
  await L.ensureLoopsIndexes(db);
  const provider = whisperCppProvider({ whisperBin: whisper, model, ffmpegBin: ffmpeg, tmpDir: tmp });
  const T0 = new Date('2026-10-30T15:00:00Z');
  for (const [i, id] of ['cap_voice001', 'cap_voice002'].entries()) await L.captureAudio(db, U, { id, bytes: Buffer.from('audio bytes'), mime: 'audio/webm', durationMs: 5000 }, new Date(+T0 + i * 1000));
  assert.deepEqual(await L.transcribePending(db, provider, { now: T0 }), { done: 1, failed: 0 }, 'one at a time');
  assert.equal((await db.collection('captures').findOne({ _id: 'cap_voice001' })).status, 'WAITING_FOR_CODEX');
  assert.equal((await db.collection('captures').findOne({ _id: 'cap_voice001' })).transcript, 'Hello, it is Sarah at NVIDIA.');
  // The second: an engine that hears nothing.
  const silent = whisperCppProvider({ whisperBin: script('whisper-silent', "printf ' [BLANK_AUDIO]\\n'"), model, ffmpegBin: ffmpeg, tmpDir: tmp });
  assert.deepEqual(await L.transcribePending(db, silent, { now: T0 }), { done: 0, failed: 1 });
  const failed = await db.collection('captures').findOne({ _id: 'cap_voice002' });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.error.stage, 'transcribe');
  assert.ok((await L.readAudio(db, U, 'cap_voice002')).size > 0, 'the recording is kept');
  // A transcriber killed mid-recording: stuck TRANSCRIBING goes back in the queue after 45 minutes, and is then done.
  await db.collection('captures').updateOne({ _id: 'cap_voice002' }, { $set: { status: 'TRANSCRIBING', updatedAt: T0 } });
  assert.deepEqual(await L.transcribePending(db, provider, { now: new Date(+T0 + 10 * 60_000) }), { done: 0, failed: 0 }, 'not yet');
  assert.deepEqual(await L.transcribePending(db, provider, { now: new Date(+T0 + 60 * 60_000) }), { done: 1, failed: 0 });
  assert.equal((await db.collection('captures').findOne({ _id: 'cap_voice002' })).status, 'WAITING_FOR_CODEX');
});

test('the transcriber process with no engine configured stays up and says why (no crash loop)', async () => {
  const child = spawn(process.execPath, ['scripts/loops-transcriber.mjs'], { env: { PATH: process.env.PATH, MONGO_URI: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => { out += c; });
  await new Promise((resolve) => { const t = setInterval(() => { if (/Transcription is off: LOOPS_TRANSCRIBER is not set/.test(out)) { clearInterval(t); resolve(); } }, 50); setTimeout(() => { clearInterval(t); resolve(); }, 8000); });
  assert.equal(child.exitCode, null, 'still running');
  child.kill('SIGTERM');
  await new Promise((r) => child.on('close', r));
  assert.match(out, /Transcription is off: LOOPS_TRANSCRIBER is not set/);
});
