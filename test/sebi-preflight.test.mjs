import test from 'node:test';
import assert from 'node:assert/strict';
import { runSebiPreflight } from '../src/sebiPreflight.js';

test('phrase scan flags risky promises and possible stock calls without declaring a violation', () => {
  const report = runSebiPreflight('Guaranteed returns. Buy XYZ with a target price of ₹250.', { publisherRole: 'unknown' });
  assert.equal(report.status, 'review-required');
  assert.ok(report.flags.some(flag => flag.id === 'return-promise'));
  assert.ok(report.flags.some(flag => flag.id === 'specific-recommendation'));
  assert.equal(report.checks.factualClaimsVerified, false);
  assert.ok(report.limitations.some(text => text.includes('not a legal opinion')));
});

test('clean-looking text is never labelled approved or fact-checked', () => {
  const report = runSebiPreflight('This video explains how a mutual fund works.');
  assert.equal(report.status, 'no-obvious-flags');
  assert.equal(report.checks.factualClaimsVerified, false);
  assert.equal(report.checks.registrationVerified, false);
});

test('numeric, date, and security claims are surfaced for human evidence checks', () => {
  const report = runSebiPreflight('NIFTY returned 12% in 2025. The share price was ₹120.');
  assert.equal(report.claimsNeedingEvidence.length, 2);
  assert.match(report.claimsNeedingEvidence[0], /12%/);
  assert.equal(report.checks.visualDisclosuresChecked, false);
});
