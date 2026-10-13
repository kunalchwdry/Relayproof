const LEGACY_AUDIO_SCHEMA = 'relayproof.audio-credential.v1';
const LEGACY_AUDIO_TYPE = 'RelayProofAudioOriginClaim';
const MEDIA_SCHEMA = 'relayproof.media-credential.v1';
const MEDIA_TYPE = 'RelayProofMediaOriginClaim';

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Sidecar contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  throw new TypeError(`Unsupported sidecar value: ${typeof value}`);
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function keyId(publicJwk) {
  const publicPart = { crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x, y: publicJwk.y };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(publicPart)));
  const hex = [...new Uint8Array(digest)].slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `rp-p256-${hex}`;
}

export function isRelayProofCredential(value) {
  return Boolean(value && typeof value === 'object' && (
    (value.schema === LEGACY_AUDIO_SCHEMA && value.credentialType === LEGACY_AUDIO_TYPE)
    || (value.schema === MEDIA_SCHEMA && value.credentialType === MEDIA_TYPE)
  ));
}

export async function verifyCredentialSignature(credential) {
  try {
    if (!isRelayProofCredential(credential)) return { valid: false, reason: 'Unsupported RelayProof sidecar schema.' };
    if (credential.schema === MEDIA_SCHEMA && !['audio', 'video'].includes(credential.mediaKind)) {
      return { valid: false, reason: 'Media sidecar is missing its audio/video kind.' };
    }
    if (!credential.credentialId || !credential.issuedAt || !credential.issuer?.name || !credential.asset?.title || !/^[a-f0-9]{64}$/i.test(credential.asset?.sha256 || '') || credential.binding?.type !== 'exact-file-bytes' || !credential.claim || typeof credential.claim !== 'object') {
      return { valid: false, reason: 'Sidecar is missing required signed fields.' };
    }
    if (credential.proof?.algorithm !== 'ECDSA-P256-SHA256' || credential.proof?.canonicalization !== 'relayproof-canonical-json-v1') {
      return { valid: false, reason: 'Unsupported signature algorithm or canonicalization.' };
    }
    const jwk = credential.issuer?.publicKeyJwk;
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || jwk.d) return { valid: false, reason: 'Sidecar has no valid public P-256 key.' };
    const calculatedKeyId = await keyId(jwk);
    if (calculatedKeyId !== credential.issuer.keyId || calculatedKeyId !== credential.proof.verificationMethod) {
      return { valid: false, reason: 'Issuer key fingerprint does not match the signed key reference.' };
    }
    const unsigned = { ...credential };
    delete unsigned.proof;
    const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      fromBase64Url(credential.proof.proofValue || ''),
      new TextEncoder().encode(canonicalize(unsigned)),
    );
    return { valid, reason: valid ? '' : 'Sidecar signature check failed.', keyId: calculatedKeyId };
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : 'Could not verify this sidecar.' };
  }
}
