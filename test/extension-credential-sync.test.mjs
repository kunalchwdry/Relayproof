// The extension keeps its own copy of the verifier (extension/credential.js) because
// popup.js imports it directly. This test keeps that copy honest: a sidecar signed by
// the main app must verify the same way in the extension, and tampered sidecars must
// fail in both copies.

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const main = await import('../src/credential.js');
const ext = await import('../extension/credential.js');

async function identity() {
  const pair = await main.generateSigningKeyPair();
  const publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk, keyId: await main.getKeyId(publicJwk) };
}

async function issue(fingerprint) {
  return main.createSignedCredential({
    file: new Blob([Buffer.from('voice note bytes')], { type: 'audio/ogg' }),
    issuerName: 'Sync Test Publisher',
    title: 'Sync test clip',
    declaredOrigin: 'AI-generated voice',
    tool: 'Test TTS',
    language: 'English',
    note: 'Test fixture.',
    identity: await identity(),
    audioFingerprint: fingerprint,
  });
}

const fingerprint = {
  algorithm: 'Chromaprint',
  fingerprint: 'AQAAA-sync-test-fingerprint',
  durationSeconds: 12.5,
};

test('a sidecar signed by the main app verifies in the extension copy', async () => {
  const sidecar = await issue(undefined);
  const mainResult = await main.verifyCredentialSignature(sidecar);
  const extResult = await ext.verifyCredentialSignature(sidecar);
  assert.equal(mainResult.valid, true);
  assert.equal(extResult.valid, true);
});

test('a sidecar with a Chromaprint reference verifies in the extension copy', async () => {
  const sidecar = await issue(fingerprint);
  assert.equal((await ext.verifyCredentialSignature(sidecar)).valid, true);
});

test('a tampered claim fails in both copies', async () => {
  const sidecar = await issue(undefined);
  const tampered = structuredClone(sidecar);
  tampered.claim.declaredOrigin = 'Human-recorded';
  assert.equal((await main.verifyCredentialSignature(tampered)).valid, false);
  assert.equal((await ext.verifyCredentialSignature(tampered)).valid, false);
});

test('a tampered Chromaprint reference fails in both copies', async () => {
  const sidecar = await issue(fingerprint);
  const tampered = structuredClone(sidecar);
  tampered.audioFingerprint.fingerprint = 'AQAAA-other';
  assert.equal((await main.verifyCredentialSignature(tampered)).valid, false);
  assert.equal((await ext.verifyCredentialSignature(tampered)).valid, false);
});

test('a non-RelayProof document is rejected by the extension copy', () => {
  assert.equal(ext.isRelayProofCredential({ schema: 'something-else' }), false);
});
