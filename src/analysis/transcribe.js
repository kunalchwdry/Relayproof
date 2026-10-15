// In-browser speech-to-text. Runs on the device: the audio never leaves the browser.
// Model: Xenova/whisper-tiny (Whisper, Apache 2.0), 8-bit quantized, about 41 MB, downloaded once and cached by the browser.
// Language is set to English. Hindi and Hinglish speech will be poor, so type or paste a transcript for those.

export const SPEECH_MODEL = {
  id: 'Xenova/whisper-tiny',
  label: 'Whisper tiny (in-browser)',
  license: 'Apache 2.0',
  approxDownloadMb: 41,
  dtype: 'q8',
  language: 'english',
};

// Longer clips are slow on a laptop CPU and hold a lot of audio in memory. Above this, the user pastes a transcript instead.
export const MAX_SPEECH_SECONDS = 40 * 60;
const SAMPLE_RATE = 16000;

let asrPromise = null;

function loadAsr(onProgress) {
  if (!asrPromise) {
    asrPromise = import('@huggingface/transformers')
      .then(({ pipeline, env }) => {
        // One thread: this page is not cross-origin isolated, and extra workers cost memory on laptops.
        env.backends.onnx.wasm.numThreads = 1;
        return pipeline('automatic-speech-recognition', SPEECH_MODEL.id, {
        device: 'wasm', // CPU WebAssembly only: no WebGPU setup, which costs a lot of memory on some machines
        dtype: SPEECH_MODEL.dtype,
        progress_callback: onProgress,
        });
      })
      .catch(error => {
        asrPromise = null; // allow a retry on the next analysis
        throw error;
      });
  }
  return asrPromise;
}

// Decodes the audio track of a video or audio file to 16 kHz mono PCM.
// Returns { samples: Float32Array, seconds }. Samples are empty if the file has no audio track.
export async function decodeAudio(file) {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channels = buffer.numberOfChannels;
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < channels; c += 1) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / channels;
    }
    return { samples: mono, seconds: buffer.length / SAMPLE_RATE };
  } catch {
    return { samples: new Float32Array(0), seconds: 0 };
  } finally {
    await context.close();
  }
}

// Returns { text, segments: [{ start, end, text }] }. Throws if the model cannot load.
export async function transcribeAudio(samples, { onStatus } = {}) {
  onStatus?.('Loading the speech model. The first run downloads about 41 MB; later runs use the browser cache.');
  const asr = await loadAsr(event => {
    if (event?.status === 'progress' && event.total) {
      onStatus?.(`Downloading the speech model: ${Math.round((event.loaded / event.total) * 100)}%`);
    }
  });
  onStatus?.('Transcribing the speech in this browser. Long clips take a few minutes.');
  const output = await asr(samples, {
    language: SPEECH_MODEL.language,
    task: 'transcribe',
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  const chunks = Array.isArray(output.chunks) ? output.chunks : [];
  const segments = chunks
    .map(chunk => ({
      start: Number(chunk.timestamp?.[0] ?? 0),
      end: Number(chunk.timestamp?.[1] ?? chunk.timestamp?.[0] ?? 0),
      text: String(chunk.text || '').trim(),
    }))
    .filter(segment => segment.text);
  const text = segments.length ? segments.map(segment => segment.text).join(' ') : String(output.text || '').trim();
  return { text, segments };
}
