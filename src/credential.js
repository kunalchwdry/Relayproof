const LEGACY_AUDIO_SCHEMA = 'relayproof.audio-credential.v1';
const LEGACY_AUDIO_TYPE = 'RelayProofAudioOriginClaim';
const MEDIA_SCHEMA = 'relayproof.media-credential.v1';
const MEDIA_TYPE = 'RelayProofMediaOriginClaim';
const SIGNATURE_ALGORITHM = 'ECDSA-P256-SHA256';
const BINDING_TYPE = 'exact-file-bytes';
const MAX_MEDIA_BYTES = 128 * 1024 * 1024;
const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg)$/i;

function webCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable. Open RelayProof in a modern browser over HTTPS or localhost.');
  return globalThis.crypto;
}

export function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Credential contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  throw new TypeError(`Unsupported credential value: ${typeof value}`);
}

export function toBase64Url(bytes) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < array.length; i += 0x8000) {
    binary += String.fromCharCode(...array.subarray(i, Math.min(i + 0x8000, array.length)));
  }
  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(array).toString('base64');
  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function fromBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  if (typeof atob === 'function') return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

export async function sha256Hex(input) {
  const crypto = webCrypto();
  let bytes;
  if (input instanceof ArrayBuffer) bytes = input;
  else if (ArrayBuffer.isView(input)) bytes = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  else if (input && typeof input.arrayBuffer === 'function') {
    if (Number.isFinite(input.size) && input.size > MAX_MEDIA_BYTES) {
      throw new Error('For this browser-side verifier, audio/video files must be 128 MB or smaller.');
    }
    bytes = await input.arrayBuffer();
  } else {
    throw new TypeError('Expected a File, Blob, ArrayBuffer, or typed array.');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function getKeyId(publicJwk) {
  const crypto = webCrypto();
  const publicPart = {
    crv: publicJwk.crv,
    kty: publicJwk.kty,
    x: publicJwk.x,
    y: publicJwk.y,
  };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(publicPart)));
  return `rp-p256-${[...new Uint8Array(digest)].slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function generateSigningKeyPair() {
  return webCrypto().subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
}

export function getMediaKind(file) {
  return file?.type?.startsWith('video/') || VIDEO_EXTENSIONS.test(file?.name || '') ? 'video' : 'audio';
}

function validateIssueInput({ file, issuerName, title }) {
  if (!(file instanceof Blob)) throw new TypeError('Choose an audio or video file before issuing a credential.');
  if (file.size > MAX_MEDIA_BYTES) throw new Error('Audio/video files must be 128 MB or smaller in this browser-only MVP.');
  if (!issuerName?.trim()) throw new Error('Enter the publisher / issuer name.');
  if (!title?.trim()) throw new Error('Enter an asset title.');
}

function normalizeAudioFingerprint(value) {
  if (value == null) return undefined;
  if (value.algorithm !== 'Chromaprint' || typeof value.fingerprint !== 'string' || !value.fingerprint || value.fingerprint.length > 100_000) {
    throw new Error('The local Chromaprint service returned an invalid fingerprint.');
  }
  const durationSeconds = Number(value.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 125) {
    throw new Error('The local Chromaprint service returned an invalid duration.');
  }
  return {
    algorithm: 'Chromaprint',
    encoding: 'Chromaprint compressed fingerprint',
    fingerprint: value.fingerprint,
    durationSeconds,
    fingerprintedSecondsMax: Number(value.fingerprintedSecondsMax) || 120,
    purpose: 'Candidate similarity search only; not authentication, identity verification, or claim verification.',
  };
}

export async function createSignedCredential({ file, issuerName, title, declaredOrigin, tool, language, note, identity, audioFingerprint }) {
  validateIssueInput({ file, issuerName, title });
  if (!identity?.privateKey || !identity?.publicJwk || !identity?.keyId) {
    throw new Error('The local signing identity is unavailable. Create or unlock a publisher key first.');
  }
  const normalizedFingerprint = normalizeAudioFingerprint(audioFingerprint);
  const crypto = webCrypto();
  const digest = await sha256Hex(file);
  const issuedAt = new Date().toISOString();
  const mediaKind = getMediaKind(file);
  const payload = {
    schema: MEDIA_SCHEMA,
    credentialId: crypto.randomUUID ? crypto.randomUUID() : `rp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    credentialType: MEDIA_TYPE,
    mediaKind,
    issuer: {
      name: issuerName.trim(),
      keyId: identity.keyId,
      publicKeyJwk: identity.publicJwk,
    },
    asset: {
      title: title.trim(),
      fileName: file.name || 'media-file',
      mediaType: file.type || 'application/octet-stream',
      byteLength: file.size,
      sha256: digest,
    },
    ...(normalizedFingerprint ? { audioFingerprint: normalizedFingerprint } : {}),
    claim: {
      declaredOrigin: declaredOrigin || 'Not declared',
      toolOrModel: (tool || '').trim() || 'Not declared',
      language: (language || '').trim() || 'Not declared',
      note: (note || '').trim(),
    },
    binding: {
      type: BINDING_TYPE,
      hashAlgorithm: 'SHA-256',
      scope: 'Exact file bytes. Optional Chromaprint is only a candidate similarity hint; no watermark/SBR recovery or derivative provenance validation is performed.',
    },
    issuedAt,
    limitations: [
      'This signed record proves that the key included in this credential signed these claims and this exact file digest.',
      'The public key is self-asserted unless the recipient verifies it through a trusted channel or pins it locally.',
      'A valid signature does not prove the truth of the media, speaker identity, consent, or an external timestamp.',
      'This RelayProof sidecar is not a C2PA credential. Chromaprint may surface a similar-audio candidate, but does not recover or authenticate derivative provenance after re-encoding.',
      ...(normalizedFingerprint ? ['The included Chromaprint value is a perceptual candidate-search hint only; its similarity score is not calibrated and is not provenance verification.'] : []),
    ],
  };
  const bytes = new TextEncoder().encode(canonicalize(payload));
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identity.privateKey,
    bytes,
  );
  return {
    ...payload,
    proof: {
      type: 'RelayProofECDSA',
      algorithm: SIGNATURE_ALGORITHM,
      canonicalization: 'relayproof-canonical-json-v1',
      verificationMethod: identity.keyId,
      proofValue: toBase64Url(signature),
    },
  };
}

export async function verifyCredentialSignature(credential) {
  try {
    if (!credential) return { valid: false, reason: 'Unsupported or malformed RelayProof credential schema.' };
    const isLegacyAudio = credential.schema === LEGACY_AUDIO_SCHEMA && credential.credentialType === LEGACY_AUDIO_TYPE;
    const isMediaCredential = credential.schema === MEDIA_SCHEMA && credential.credentialType === MEDIA_TYPE;
    if (!isLegacyAudio && !isMediaCredential) {
      return { valid: false, reason: 'Unsupported or malformed RelayProof credential schema.' };
    }
    if (isMediaCredential && !['audio', 'video'].includes(credential.mediaKind)) {
      return { valid: false, reason: 'Media credential must identify the signed asset as audio or video.' };
    }
    if (!credential.credentialId || !credential.issuedAt || !credential.issuer?.name || !credential.asset?.title || !/^[a-f0-9]{64}$/i.test(credential.asset?.sha256 || '') || credential.binding?.type !== BINDING_TYPE || !credential.claim || typeof credential.claim !== 'object') {
      return { valid: false, reason: 'Credential is missing required issuer, claim, timestamp, or exact-file digest fields.' };
    }
    if (credential.proof?.algorithm !== SIGNATURE_ALGORITHM || credential.proof?.canonicalization !== 'relayproof-canonical-json-v1') {
      return { valid: false, reason: 'Unsupported signature algorithm or canonicalization.' };
    }
    const publicJwk = credential.issuer?.publicKeyJwk;
    if (!publicJwk || publicJwk.kty !== 'EC' || publicJwk.crv !== 'P-256' || publicJwk.d) {
      return { valid: false, reason: 'Credential has no valid public P-256 key.' };
    }
    const calculatedKeyId = await getKeyId(publicJwk);
    if (calculatedKeyId !== credential.issuer?.keyId || calculatedKeyId !== credential.proof?.verificationMethod) {
      return { valid: false, reason: 'Issuer key fingerprint does not match the signed key reference.' };
    }
    const unsigned = { ...credential };
    delete unsigned.proof;
    const publicKey = await webCrypto().subtle.importKey(
      'jwk', publicJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const valid = await webCrypto().subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      fromBase64Url(credential.proof.proofValue || ''),
      new TextEncoder().encode(canonicalize(unsigned)),
    );
    return {
      valid,
      reason: valid ? '' : 'Signature check failed. The credential may have been changed or corrupted.',
      keyId: calculatedKeyId,
      issuerName: credential.issuer.name || 'Unnamed issuer',
    };
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : 'Credential could not be verified.' };
  }
}

export async function verifyCredentialAgainstFile(credential, file) {
  const signature = await verifyCredentialSignature(credential);
  if (!signature.valid) return { ...signature, digestMatches: false, submittedDigest: null };
  if (!(file instanceof Blob)) return { ...signature, digestMatches: null, submittedDigest: null, reason: 'Choose an audio or video file to check exact-byte binding.' };
  try {
    const submittedDigest = await sha256Hex(file);
    const digestMatches = credential.binding?.type === BINDING_TYPE && credential.asset?.sha256 === submittedDigest;
    return {
      ...signature,
      digestMatches,
      submittedDigest,
      issuedDigest: credential.asset?.sha256 || null,
      byteLengthMatches: Number(credential.asset?.byteLength) === file.size,
    };
  } catch (error) {
    return { ...signature, digestMatches: false, submittedDigest: null, reason: error instanceof Error ? error.message : 'Audio digest could not be computed.' };
  }
}

export function isRelayProofCredential(value) {
  return Boolean(value && typeof value === 'object' && (
    (value.schema === LEGACY_AUDIO_SCHEMA && value.credentialType === LEGACY_AUDIO_TYPE)
    || (value.schema === MEDIA_SCHEMA && value.credentialType === MEDIA_TYPE)
  ));
}

export function credentialFileName(credential) {
  const stem = (credential?.asset?.title || credential?.asset?.fileName || 'media-credential')
    .toString().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'media-credential';
  return `${stem}.relayproof.json`;
}

export const CREDENTIAL_SCHEMA = MEDIA_SCHEMA;
export const LEGACY_CREDENTIAL_SCHEMA = LEGACY_AUDIO_SCHEMA;
export const MAX_CREDENTIAL_MEDIA_BYTES = MAX_MEDIA_BYTES;
