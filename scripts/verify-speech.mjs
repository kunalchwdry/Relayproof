// Checks the in-browser speech model end to end, outside the browser:
// reads a 16 kHz mono 16-bit WAV, runs the same Whisper model and options the page uses, prints the transcript and timestamps.
// Usage: node scripts/verify-speech.mjs path/to/clip.wav
import { readFileSync } from 'node:fs';
import { pipeline } from '@huggingface/transformers';

const path = process.argv[2];
if (!path) { console.error('usage: node scripts/verify-speech.mjs clip.wav'); process.exit(2); }

function readWav16Mono(file) {
  const buf = readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let offset = 12, dataStart = -1, dataLength = 0, channels = 1, bits = 16, rate = 16000;
  while (offset < buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') { channels = buf.readUInt16LE(offset + 10); rate = buf.readUInt32LE(offset + 12); bits = buf.readUInt16LE(offset + 22); }
    if (id === 'data') { dataStart = offset + 8; dataLength = size; break; }
    offset += 8 + size + (size % 2);
  }
  if (dataStart < 0 || bits !== 16 || channels !== 1 || rate !== 16000) throw new Error('need 16-bit mono 16 kHz WAV');
  const samples = new Float32Array(dataLength / 2);
  for (let i = 0; i < samples.length; i += 1) samples[i] = buf.readInt16LE(dataStart + i * 2) / 32768;
  return samples;
}

const samples = readWav16Mono(path);
console.log(`audio: ${(samples.length / 16000).toFixed(1)} s`);
const t0 = Date.now();
const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', { dtype: 'q8' });
console.log(`model ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const t1 = Date.now();
const output = await asr(samples, { language: 'english', task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
console.log(`transcribed in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
console.log('text:', output.text);
for (const chunk of output.chunks || []) console.log(`  [${Number(chunk.timestamp[0]).toFixed(1)}-${Number(chunk.timestamp[1]).toFixed(1)}] ${chunk.text.trim()}`);
