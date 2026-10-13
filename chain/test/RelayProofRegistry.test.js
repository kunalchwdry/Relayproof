const { expect } = require('chai');
const { anyValue } = require('@nomicfoundation/hardhat-chai-matchers/withArgs');
const { ethers } = require('hardhat');

const ID = ethers.id('credential-1');
const DIGEST = ethers.id('canonical-manifest-1');
const KEY = ethers.id('rp-p256-keyid-1');

describe('RelayProofRegistry', function () {
  let registry, issuer, other;

  beforeEach(async function () {
    [issuer, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('RelayProofRegistry');
    registry = await Factory.deploy();
    await registry.waitForDeployment();
  });

  it('reports unknown for an unregistered ID', async function () {
    expect(await registry.status(ID)).to.equal(0n);
  });

  it('registers a digest with issuer, key reference, watermark hint, and timestamp', async function () {
    const tx = await registry.connect(issuer).register(ID, DIGEST, KEY, 4242);
    await expect(tx)
      .to.emit(registry, 'Registered')
      .withArgs(ID, issuer.address, 4242, DIGEST, KEY, anyValue);
    const record = await registry.getRecord(ID);
    expect(record.issuer).to.equal(issuer.address);
    expect(record.manifestDigest).to.equal(DIGEST);
    expect(record.issuerKeyHash).to.equal(KEY);
    expect(record.watermarkId).to.equal(4242n);
    expect(record.registeredAt).to.be.gt(0n);
    expect(record.revokedAt).to.equal(0n);
    expect(await registry.status(ID)).to.equal(1n);
  });

  it('rejects a second registration of the same ID (first registration wins)', async function () {
    await registry.connect(issuer).register(ID, DIGEST, KEY, 1);
    await expect(registry.connect(other).register(ID, ethers.id('other'), KEY, 2))
      .to.be.revertedWithCustomError(registry, 'AlreadyRegistered');
    expect((await registry.getRecord(ID)).manifestDigest).to.equal(DIGEST);
  });

  it('rejects zero IDs and zero digests', async function () {
    await expect(registry.register(ethers.ZeroHash, DIGEST, KEY, 1))
      .to.be.revertedWithCustomError(registry, 'ZeroCredentialId');
    await expect(registry.register(ID, ethers.ZeroHash, KEY, 1))
      .to.be.revertedWithCustomError(registry, 'ZeroManifestDigest');
  });

  it('lets only the issuer revoke, and only once', async function () {
    await registry.connect(issuer).register(ID, DIGEST, KEY, 1);
    await expect(registry.connect(other).revoke(ID))
      .to.be.revertedWithCustomError(registry, 'NotIssuer');
    await expect(registry.connect(issuer).revoke(ID)).to.emit(registry, 'Revoked');
    expect(await registry.status(ID)).to.equal(2n);
    await expect(registry.connect(issuer).revoke(ID))
      .to.be.revertedWithCustomError(registry, 'AlreadyRevoked');
  });

  it('cannot revoke an unknown ID', async function () {
    await expect(registry.revoke(ID))
      .to.be.revertedWithCustomError(registry, 'NotRegistered');
  });

  it('keeps the revoked record readable with its original digest', async function () {
    await registry.connect(issuer).register(ID, DIGEST, KEY, 9);
    await registry.connect(issuer).revoke(ID);
    const record = await registry.getRecord(ID);
    expect(record.manifestDigest).to.equal(DIGEST);
    expect(record.revokedAt).to.be.gt(0n);
  });
});
