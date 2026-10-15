# Test fixtures

- `c2pa-ai-declared.mp4` and `c2pa-camera-declared.mp4`: 20-second test clips, signed with a local test
  certificate chain (not a trusted signer). The first declares `trainedAlgorithmicMedia`; the second declares
  `digitalCapture`. They are for testing only and carry no real identity.
- `c2pa-ai-declared.json` and `c2pa-camera-declared.json`: the manifest output of the C2PA library
  (c2pa-python 0.38, c2pa-rs 0.91) for those two files. Used by `test/provenance.test.mjs`.

The signing keys are not stored in the repository. To regenerate, create a test root and leaf certificate
with OpenSSL (leaf: `extendedKeyUsage=emailProtection`), install `c2pa-python`, and sign a clip with
`Builder.sign_file`. The library rejects self-signed certificates.
