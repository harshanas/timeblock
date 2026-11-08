#!/usr/bin/env node
// Hashes your password locally (PBKDF2-SHA256) and stores it as the PASSWORD_HASH Worker secret.
// The plain password never leaves this machine.
//   npm run set-password            -> wrangler secret put PASSWORD_HASH (production)
//   npm run set-password -- --print -> just print the hash
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';

const ITERATIONS = 100000; // Cloudflare Workers caps PBKDF2 at 100k iterations.

function askHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const pw = await askHidden('New password: ');
if (pw.length < 6) { console.error('Password must be at least 6 characters.'); process.exit(1); }
const again = await askHidden('Repeat password: ');
if (pw !== again) { console.error('Passwords do not match.'); process.exit(1); }

const salt = randomBytes(16);
const hash = pbkdf2Sync(pw, salt, ITERATIONS, 32, 'sha256');
const value = `pbkdf2$sha256$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;

if (process.argv.includes('--print')) {
  console.log(value);
} else {
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', 'PASSWORD_HASH'], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
  process.exit(r.status ?? 1);
}
