import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeProvenance, NO_CREDENTIALS_NOTE } from '../src/analysis/provenance.js';

const signedManifest = (extra = {}) => ({
  claim_generator: 'Camera App/1.2',
  claim_generator_info: [{ name: 'Camera App', version: '1.2' }],
  signature_info: { common_name: 'Example Newsroom', issuer: 'Example CA', time: '2026-10-01T10:00:00Z' },
  assertions: [],
  ...extra,
});

test('a file with no manifest is reported as no credentials, with the not-evidence note', () => {
  const result = describeProvenance({ active_manifest: null, manifests: {} });
  assert.equal(result.status, 'none');
  assert.equal(result.note, NO_CREDENTIALS_NOTE);
  assert.match(result.note, /not evidence either way/);
  assert.equal(describeProvenance(null).status, 'none');
});

test('a signed file shows the signer, tool, and a valid signature with no trust check', () => {
  const result = describeProvenance({
    active_manifest: 'urn:1',
    manifests: { 'urn:1': signedManifest() },
    validation_state: 'Valid',
    validation_status: [],
  });
  assert.equal(result.status, 'present');
  assert.equal(result.signer, 'Example Newsroom');
  assert.equal(result.generator, 'Camera App');
  assert.equal(result.validation, 'valid');
  assert.equal(result.aiDeclared, null);
  assert.equal(result.headline, 'Content Credentials present');
  assert.match(result.details.find(d => d.label === 'Check result').value, /not checked against a trust list/);
});

test('an AI-generated source type is declared, even when nested in an action list', () => {
  const result = describeProvenance({
    active_manifest: 'urn:2',
    manifests: {
      'urn:2': signedManifest({
        assertions: [{
          label: 'c2pa.actions.v2',
          data: { actions: [{ action: 'c2pa.created', digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia' }] },
        }],
      }),
    },
    validation_state: 'Valid',
  });
  assert.equal(result.aiDeclared, 'generated');
  assert.equal(result.headline, 'Declares AI generation');
  assert.match(result.note, /claim of the signer/);
});

test('AI-assisted editing is reported separately from full generation', () => {
  const result = describeProvenance({
    active_manifest: 'urn:3',
    manifests: {
      'urn:3': signedManifest({
        assertions: [{
          label: 'c2pa.actions',
          data: { actions: [
            { action: 'c2pa.edited', digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia' },
            { action: 'c2pa.cropped' },
          ] },
        }],
      }),
    },
    validation_state: 'Valid',
  });
  assert.equal(result.aiDeclared, 'edited');
  assert.deepEqual(result.editActions, ['c2pa.edited', 'c2pa.cropped']);
});

test('a digital capture declaration is not treated as AI', () => {
  const result = describeProvenance({
    active_manifest: 'urn:4',
    manifests: {
      'urn:4': signedManifest({
        assertions: [{ label: 'c2pa.actions', data: { actions: [{ action: 'c2pa.created', digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture' }] } }],
      }),
    },
    validation_state: 'Trusted',
  });
  assert.equal(result.aiDeclared, null);
  assert.equal(result.validation, 'trusted');
});

test('a failed signature or hash check is listed as a failure and marked invalid', () => {
  const result = describeProvenance({
    active_manifest: 'urn:5',
    manifests: { 'urn:5': signedManifest() },
    validation_state: 'Invalid',
    validation_status: [
      { code: 'claimSignature.validated', success: true },
      { code: 'assertion.dataHash.mismatch', success: false, explanation: 'hash of the asset does not match' },
    ],
  });
  assert.equal(result.validation, 'invalid');
  assert.deepEqual(result.failures, ['hash of the asset does not match']);
});

test('missing signer fields are shown as unknown, not invented', () => {
  const result = describeProvenance({
    active_manifest: 'urn:6',
    manifests: { 'urn:6': { assertions: [] } },
    validation_state: 'Valid',
  });
  assert.equal(result.signer, null);
  assert.equal(result.details.find(d => d.label === 'Signed by').value, 'Unknown signer');
  assert.equal(result.details.find(d => d.label === 'Made with').value, 'Not stated');
});

// Real output of the C2PA library (c2pa-python 0.38, rs 0.91) for two test files signed with a local test root.
import { readFile } from 'node:fs/promises';
const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').then(JSON.parse);

test('real library output: AI generation declared in a signed file is shown', async () => {
  const result = describeProvenance(await fixture('c2pa-ai-declared.json'));
  assert.equal(result.status, 'present');
  assert.equal(result.aiDeclared, 'generated');
  assert.equal(result.signer, 'RelayProof Test Signer');
  assert.equal(result.generator, 'RelayProof test signer');
  assert.equal(result.validation, 'valid');
  assert.deepEqual(result.failures, [], 'an untrusted signer is not a failed check');
});

test('real library output: a camera-declared file is not labelled as AI', async () => {
  const result = describeProvenance(await fixture('c2pa-camera-declared.json'));
  assert.equal(result.status, 'present');
  assert.equal(result.aiDeclared, null);
  assert.equal(result.validation, 'valid');
});
