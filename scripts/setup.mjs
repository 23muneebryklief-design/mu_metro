import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('Existing .env preserved. Update its settings if needed.');
} else {
  const example = readFileSync('.env.example', 'utf8');
  writeFileSync('.env', example.replace('replace-with-a-random-secret-of-at-least-32-characters', randomBytes(48).toString('hex')), { flag: 'wx', mode: 0o600 });
  console.log('Created ignored .env with a random JWT secret and demo payments enabled. No administrator was created.');
}
