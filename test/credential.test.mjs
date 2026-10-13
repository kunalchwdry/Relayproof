import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const {
  canonicalize,
  createSignedCredential,
  generateSigningKeyPair,
  getKeyId,
  isRelayProofCredential,
  sha256Hex,
  toBase64Url,
  verifyCredentialAgainstFile,
  verifyCredentialSignature,
} = await import('../src/credential.js');

async function identity() {
  const pair = await generateSigningKeyPair();
  const publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk, keyId: await getKeyId(publicJwk) };
}

const source = Buffer.from('a small test audio payload\0opus bytes');

async function issue(audioFingerprint, file = new Blob([source], { type: 'audio/ogg' })) {
  return createSignedCredential({
    file,
    issuerName: 'Test Publisher',
    title: 'Test voice note',
    declaredOrigin: 'AI-generated voice',
    tool: 'Test TTS',
    language: 'English',
    note: 'Non-production test fixture.',
    identity: await identity(),
    audioFingerprint,
  });
}

async function legacyAudioIssue() {
  const pair = await generateSigningKeyPair();
  const publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const keyId = await getKeyId(publicJwk);
  const file = new Blob([source], { type: 'audio/ogg' });
  const payload = {
    schema: 'relayproof.audio-credential.v1',
    credentialId: 'rp-legacy-test-fixture',
    credentialType: 'RelayProofAudioOriginClaim',
    issuer: { name: 'Legacy Publisher', keyId, publicKeyJwk: publicJwk },
    asset: { title: 'Legacy voice note', fileName: 'legacy.ogg', mediaType: 'audio/ogg', byteLength: file.size, sha256: await sha256Hex(file) },
    claim: { declaredOrigin: 'Human recording', toolOrModel: 'Not declared', language: 'English', note: '' },
    binding: { type: 'exact-file-bytes', hashAlgorithm: 'SHA-256', scope: 'Exact file bytes only.' },
    issuedAt: new Date().toISOString(),
    limitations: ['Legacy compatibility test fixture.'],
  };
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(canonicalize(payload)));
  return {
    ...payload,
    proof: {
      type: 'RelayProofECDSA',
      algorithm: 'ECDSA-P256-SHA256',
      canonicalization: 'relayproof-canonical-json-v1',
      verificationMethod: keyId,
      proofValue: toBase64Url(signature),
    },
  };
}

test('signed credential verifies and matches the exact issued bytes', async () => {
  const credential = await issue();
  const signature = await verifyCredentialSignature(credential);
  const full = await verifyCredentialAgainstFile(credential, new Blob([source], { type: 'audio/ogg' }));
  assert.equal(signature.valid, true);
  assert.equal(full.valid, true);
  assert.equal(full.digestMatches, true);
  assert.equal(full.submittedDigest, credential.asset.sha256);
});

test('pre-existing RelayProof audio v1 sidecars still verify', async () => {
  const legacy = await legacyAudioIssue();
  assert.equal(isRelayProofCredential(legacy), true);
  assert.equal((await verifyCredentialSignature(legacy)).valid, true);
});

test('video files get a signed media credential and exact-byte verification', async () => {
  const video = new Blob([Buffer.from('tiny synthetic video fixture')], { type: 'video/mp4' });
  const credential = await issue(undefined, video);
  const outcome = await verifyCredentialAgainstFile(credential, video);
  assert.equal(credential.schema, 'relayproof.media-credential.v1');
  assert.equal(credential.credentialType, 'RelayProofMediaOriginClaim');
  assert.equal(credential.mediaKind, 'video');
  assert.equal(outcome.valid, true);
  assert.equal(outcome.digestMatches, true);
});

test('optional Chromaprint reference is included in the signed payload', async () => {
  const reference = { algorithm: 'Chromaprint', fingerprint: 'AQAAUexampleFingerprint', durationSeconds: 18.5, fingerprintedSecondsMax: 120 };
  const credential = await issue(reference);
  assert.equal(credential.audioFingerprint.algorithm, 'Chromaprint');
  assert.equal(credential.audioFingerprint.fingerprint, reference.fingerprint);
  assert.equal((await verifyCredentialSignature(credential)).valid, true);

  const modified = structuredClone(credential);
  modified.audioFingerprint.fingerprint = 'AQAAUalteredFingerprint';
  assert.equal((await verifyCredentialSignature(modified)).valid, false);
});

test('a different file does not match, while its signed sidecar remains valid', async () => {
  const credential = await issue();
  const outcome = await verifyCredentialAgainstFile(credential, new Blob([Buffer.from('transcoded or changed bytes')], { type: 'audio/ogg' }));
  assert.equal(outcome.valid, true);
  assert.equal(outcome.digestMatches, false);
});

test('changing a signed claim invalidates the signature', async () => {
  const credential = await issue();
  const modified = structuredClone(credential);
  modified.claim.note = 'Changed after signing';
  const outcome = await verifyCredentialSignature(modified);
  assert.equal(outcome.valid, false);
  assert.match(outcome.reason, /Signature check failed/);
});

test('wrong public-key fingerprint is rejected before signature acceptance', async () => {
  const credential = await issue();
  const modified = structuredClone(credential);
  modified.issuer.keyId = 'rp-p256-not-the-key';
  const outcome = await verifyCredentialSignature(modified);
  assert.equal(outcome.valid, false);
  assert.match(outcome.reason, /fingerprint/);
});
