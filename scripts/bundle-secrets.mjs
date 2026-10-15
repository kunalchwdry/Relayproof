// Fails if the built client bundle contains a credential. Keys are server-only; they must never reach dist/.
// Pattern checks catch the token formats we use. Value checks catch the exact keys in the environment when they are set
// (locally or from GitHub Actions secrets), so a key that has no recognisable prefix is still caught.
import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TOKEN_PATTERNS = [
  { name: 'NVIDIA API key', re: /nvapi-[A-Za-z0-9_-]{16,}/ },
  { name: 'Hugging Face token', re: /hf_[A-Za-z0-9]{30,}/ },
  { name: 'Vercel token', re: /vcp_[A-Za-z0-9]{20,}/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{30,}/ },
];

export const SECRET_ENV_NAMES = ['NVIDIA_API_KEY', 'HF_TOKEN', 'VERCEL_TOKEN', 'SERPAPI_KEY', 'FACT_CHECK_API_KEY'];

// Returns [{ file, rule }] for every match. `secrets` is [{ name, value }].
export function scanText(file, text, secrets = []) {
  const hits = [];
  for (const { name, re } of TOKEN_PATTERNS) {
    if (re.test(text)) hits.push({ file, rule: name });
  }
  for (const { name, value } of secrets) {
    if (value && value.length >= 12 && text.includes(value)) hits.push({ file, rule: `value of ${name}` });
  }
  return hits;
}

export function secretsFromEnv(env = process.env) {
  return SECRET_ENV_NAMES
    .map(name => ({ name, value: (env[name] || '').trim() }))
    .filter(item => item.value);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path));
    else out.push(path);
  }
  return out;
}

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.json', '.map', '.txt', '.svg', '.wasm']);

export async function scanDirectory(dir, secrets = secretsFromEnv()) {
  const hits = [];
  for (const file of await walk(dir)) {
    if (!TEXT_EXTENSIONS.has(extname(file))) continue;
    const text = await readFile(file, 'utf8').catch(() => '');
    hits.push(...scanText(file, text, secrets));
  }
  return hits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] || 'dist';
  const secrets = secretsFromEnv();
  const hits = await scanDirectory(dir, secrets);
  console.log(`Scanned ${dir} for credentials (${secrets.length} exact values checked from the environment).`);
  if (hits.length) {
    for (const hit of hits) console.error(`LEAK: ${hit.rule} found in ${hit.file}`);
    process.exit(1);
  }
  console.log('No credentials found in the bundle.');
}
