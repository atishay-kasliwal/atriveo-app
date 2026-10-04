#!/usr/bin/env node
// Run on the production sidecar host. No credential is printed or committed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
const args = process.argv.slice(2);
if (args.some(a => a !== '--rotate')) throw new Error('Usage: node scripts/setup-muse.mjs [--rotate]');
const dir = path.join(process.env.PLAYATRIVEO_HOME || path.join(os.homedir(), '.playatriveo'), 'integrations');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700);
const clientFile = path.join(dir, 'muse.env');
let token;
if (fs.existsSync(clientFile) && !args.includes('--rotate')) {
  token = fs.readFileSync(clientFile, 'utf8').match(/^MUSE_API_TOKEN=([a-f0-9]{64})$/m)?.[1];
  if (!token) throw new Error('Invalid existing Muse credential file; inspect locally');
} else {
  token = randomBytes(32).toString('hex');
  fs.writeFileSync(clientFile, `MUSE_API_BASE_URL=https://tailor-relay.atriveo.com\nMUSE_API_TOKEN=${token}\n`, { mode: 0o600 });
}
fs.chmodSync(clientFile, 0o600);
const envFile = path.resolve('.env.tailor');
const env = fs.readFileSync(envFile, 'utf8');
const line = `MUSE_TOKEN_SHA256=${createHash('sha256').update(token).digest('hex')}`;
fs.writeFileSync(envFile, /^MUSE_TOKEN_SHA256=.*$/m.test(env) ? env.replace(/^MUSE_TOKEN_SHA256=.*$/m, line) : `${env.trimEnd()}\n${line}\n`, { mode: 0o600 });
fs.chmodSync(envFile, 0o600);
console.log(`Muse client credential stored locally at ${clientFile} (owner-only). Sidecar hash configured. Restart the sidecar to activate; use a private credential transfer to Muse. No secret printed.`);
