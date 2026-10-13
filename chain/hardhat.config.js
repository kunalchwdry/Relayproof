// Hardhat config for the RelayProof registry prototype.
// Testnet only. The deployer key is read from RELAYPROOF_TESTNET_KEY or from a
// local key file outside the project (never committed, never printed).
require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
const fs = require('fs');
const os = require('os');
const path = require('path');

function testnetKey() {
  if (process.env.RELAYPROOF_TESTNET_KEY) return process.env.RELAYPROOF_TESTNET_KEY.trim();
  const keyFile = path.join(os.homedir(), '.relayproof-testnet.key');
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf8').trim();
  return null;
}

const key = testnetKey();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: {},
    monadTestnet: {
      url: process.env.MONAD_TESTNET_RPC || 'https://testnet-rpc.monad.xyz',
      chainId: 10143,
      accounts: key ? [key] : [],
    },
  },
};
