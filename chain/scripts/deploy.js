// Deploy RelayProofRegistry to Monad testnet and record the result.
// Usage: npx hardhat run scripts/deploy.js --network monadTestnet
const fs = require('fs');
const path = require('path');
const { ethers, network } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error('No deployer key found. Set RELAYPROOF_TESTNET_KEY or create ~/.relayproof-testnet.key.');
  }
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`network=${network.name} deployer=${deployer.address} balance=${ethers.formatEther(balance)} MON`);
  if (balance === 0n) {
    throw new Error(`Deployer ${deployer.address} has no testnet MON. Fund it at https://faucet.monad.xyz and retry.`);
  }

  const Factory = await ethers.getContractFactory('RelayProofRegistry');
  const registry = await Factory.deploy();
  const receipt = await registry.deploymentTransaction().wait();
  const address = await registry.getAddress();
  const net = await ethers.provider.getNetwork();

  const record = {
    network: network.name,
    chainId: Number(net.chainId),
    rpcUrl: network.config.url,
    contract: 'RelayProofRegistry',
    address,
    deployer: deployer.address,
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    deployedAt: new Date().toISOString(),
    explorer: `https://testnet.monadscan.com/address/${address}`,
    note: 'Prototype registry on testnet. Not audited. Stores digests and status only.',
  };
  const out = path.join(__dirname, '..', 'deployments', `${network.name}.json`);
  fs.writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
