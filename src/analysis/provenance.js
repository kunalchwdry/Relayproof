// Content Credentials (C2PA) check. Runs in this browser: the file is read locally and is never uploaded.
//
// What it can tell you: who signed the file, which tool made it, whether it declares AI generation or AI editing,
// which edits it records, and whether the signature and content hashes still match.
// What it cannot tell you: whether the content is real. "No credentials" is not evidence either way. Most files have
// none, and most platforms strip them when they re-encode a video.

export const NO_CREDENTIALS_NOTE =
  'No Content Credentials were found. This is not evidence either way: most videos have none, and re-encoding or uploading often strips them.';

const AI_GENERATED = /(^|\/)(trainedAlgorithmicMedia|trainedAlgorithmicData|algorithmicMedia|compositeSynthetic)$/;
const AI_EDITED = /(^|\/)(compositeWithTrainedAlgorithmicMedia|algorithmicallyEnhanced)$/;
const MAX_DEPTH = 6;

// Finds every digitalSourceType string inside an assertion's data, however deeply it is nested.
function collectSourceTypes(value, found = [], depth = 0) {
  if (depth > MAX_DEPTH || value == null) return found;
  if (Array.isArray(value)) {
    for (const item of value) collectSourceTypes(item, found, depth + 1);
  } else if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'digitalSourceType' && typeof item === 'string') found.push(item);
      else collectSourceTypes(item, found, depth + 1);
    }
  }
  return found;
}

function editActionNames(manifest) {
  const names = new Set();
  for (const assertion of manifest.assertions || []) {
    if (!/^c2pa\.actions/.test(assertion.label || '')) continue;
    for (const action of assertion.data?.actions || []) {
      const name = String(action?.action || '');
      if (name && name !== 'c2pa.created' && name !== 'c2pa.opened') names.add(name);
    }
  }
  return [...names];
}

const VALIDATION_LABELS = {
  Trusted: 'Signature valid and the signer is on the trust list.',
  Valid: 'Signature and content hashes match. The signer was not checked against a trust list.',
  Invalid: 'A signature or content check failed. Do not rely on these credentials.',
};

// Pure mapping from a C2PA ManifestStore (as returned by Reader.manifestStore()) to what the user sees.
export function describeProvenance(store) {
  const manifests = store?.manifests || {};
  const activeId = store?.active_manifest;
  const manifest = activeId ? manifests[activeId] : null;
  if (!manifest) {
    return { status: 'none', headline: 'No Content Credentials', note: NO_CREDENTIALS_NOTE, details: [], failures: [] };
  }

  const sourceTypes = (manifest.assertions || []).flatMap(assertion => collectSourceTypes(assertion.data));
  let aiDeclared = null;
  if (sourceTypes.some(type => AI_GENERATED.test(type))) aiDeclared = 'generated';
  else if (sourceTypes.some(type => AI_EDITED.test(type))) aiDeclared = 'edited';

  const failures = (store.validation_status || [])
    .filter(item => item && item.success === false)
    .map(item => item.explanation || item.code || 'unnamed check')
    .slice(0, 6);
  const state = ['Trusted', 'Valid', 'Invalid'].includes(store.validation_state) ? store.validation_state : 'Unknown';
  const validation = state === 'Trusted' ? 'trusted' : state === 'Valid' ? 'valid' : state === 'Invalid' ? 'invalid' : 'unknown';

  const signer = manifest.signature_info?.common_name || manifest.signature_info?.issuer || null;
  const generator = manifest.claim_generator_info?.[0]?.name || manifest.claim_generator || null;
  const editActions = editActionNames(manifest);

  const headline = aiDeclared === 'generated'
    ? 'Declares AI generation'
    : aiDeclared === 'edited'
      ? 'Declares AI-assisted editing'
      : 'Content Credentials present';

  const details = [
    { label: 'Signed by', value: signer || 'Unknown signer' },
    { label: 'Issuer', value: manifest.signature_info?.issuer || 'Not stated' },
    { label: 'Signed at', value: manifest.signature_info?.time || 'Not stated' },
    { label: 'Made with', value: generator || 'Not stated' },
    { label: 'Recorded edits', value: editActions.length ? editActions.join(', ') : 'None recorded' },
    { label: 'Check result', value: VALIDATION_LABELS[state] || 'The check result is not available.' },
  ];

  return {
    status: 'present',
    headline,
    aiDeclared,
    validation,
    signer,
    generator,
    editActions,
    failures,
    details,
    note: aiDeclared
      ? 'The file itself declares how it was made. Credentials can be forged or removed, so treat this as the claim of the signer, not a proof.'
      : 'These credentials describe the file as its signer states. They do not prove what the video shows.',
  };
}

let c2paPromise = null;

// Loads the C2PA reader only when a file is analysed, so the page does not pay for it otherwise.
async function loadC2pa() {
  if (!c2paPromise) {
    c2paPromise = Promise.all([
      import('@contentauth/c2pa-web'),
      import('@contentauth/c2pa-web/resources/c2pa.wasm?url'),
    ])
      .then(async ([lib, wasm]) => ({ Reader: lib.Reader, c2pa: await lib.createC2pa({ wasmSrc: wasm.default }) }))
      .catch(error => {
        c2paPromise = null;
        throw error;
      });
  }
  return c2paPromise;
}

// Reads Content Credentials from a File in this browser. Never throws: returns status 'error' with a message instead.
export async function checkProvenance(file) {
  let reader = null;
  try {
    const { Reader, c2pa } = await loadC2pa();
    reader = await Reader.fromBlob(c2pa, file.type || undefined, file);
    if (!reader) return describeProvenance(null);
    const store = await reader.manifestStore();
    return describeProvenance(store);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'error',
      headline: 'Could not read Content Credentials',
      note: `The check did not finish in this browser (${message.slice(0, 160)}). This is not evidence that the file has no credentials.`,
      details: [],
      failures: [],
    };
  } finally {
    await reader?.free?.().catch(() => {});
  }
}
