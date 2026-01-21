// util.js — browser/worker + node-friendly local "RPC"

let bitcoin = null;
let walletUtils = null;

try {
  bitcoin = require('../bitcoinjs.js');
} catch (e) {
  if (typeof self !== 'undefined' && self.bitcoin) {
    bitcoin = self.bitcoin;
  }
}

try {
  walletUtils = require('../walletUtils.js');
} catch (e) {
  if (typeof self !== 'undefined' && self.walletUtils) {
    walletUtils = self.walletUtils;
  }
}

function ensureBitcoin() {
  if (!bitcoin) throw new Error('bitcoinjs bundle not loaded');
  return bitcoin;
}

// try extension signer first
async function tryExtensionSign(psbtBase64) {
  if (!walletUtils) return null;
  if (typeof walletUtils.getActiveWallet === 'function') {
    const w = await walletUtils.getActiveWallet();
    if (w && typeof w.signTx === 'function') {
      return w.signTx(psbtBase64);
    }
  }
  if (typeof walletUtils.signTx === 'function') {
    return walletUtils.signTx(psbtBase64);
  }
  return null;
}

// local psbt signer
function localSignPsbt(psbtBase64, netName) {
  const btc = ensureBitcoin();
  const { Psbt, ECPair, networks } = btc;
  const net =
    (netName && networks[netName.toLowerCase?.()]) ||
    networks.testnet;

  const psbt = Psbt.fromBase64(psbtBase64, { network: net });
  const kp = ECPair.makeRandom({ network: net });
  psbt.signAllInputs(kp);
  psbt.finalizeAllInputs();
  return psbt.extractTransaction().toHex();
}

/**
 * Make a brand new address + keypair locally.
 * Shape is similar to what a node RPC would return.
 */
function makeNewAddress(netName) {
  const btc = ensureBitcoin();
  const { ECPair, payments, networks } = btc;
  const net =
    (netName && networks[netName.toLowerCase?.()]) ||
    networks.testnet;

  const kp = ECPair.makeRandom({ network: net });
  const { address } = payments.p2wpkh({ pubkey: kp.publicKey, network: net });

  return {
    address,
    wif: kp.toWIF(),
    pubkey: kp.publicKey.toString('hex'),
    network: net,
  };
}

/**
 * Local multisig generator.
 * args: { m, pubkeys: [hex,...], network?: 'ltctest'|'ltc' }
 */
function makeMultisig({ m, pubkeys, network: netName }) {
  const btc = ensureBitcoin();
  const { payments, networks } = btc;
  const net =
    (netName && networks[netName.toLowerCase?.()]) ||
    networks.testnet;

  const pubBuffers = pubkeys.map((hex) => Buffer.from(hex, 'hex'));

  // P2SH-multisig (most compatible)
  const p2ms = payments.p2ms({ m, pubkeys: pubBuffers, network: net });
  const p2sh = payments.p2sh({ redeem: p2ms, network: net });

  return {
    address: p2sh.address,
    redeemScript: p2ms.output.toString('hex'),
    scriptPubKey: p2sh.output.toString('hex'),
    network: net,
  };
}

function makeLocalRpc(opts = {}) {
  const netName = opts.network || 'LTCTEST';

  return {
    // REAL-ish: sign
    signrawtransactionwithwalletAsync: async (psbtBase64) => {
      const ext = await tryExtensionSign(psbtBase64);
      if (ext) return { hex: ext, complete: true };
      const hex = localSignPsbt(psbtBase64, netName);
      return { hex, complete: true };
    },

    signrawtransactionwithkeyAsync: async (psbtBase64 /*, keys */) => {
      const hex = localSignPsbt(psbtBase64, netName);
      return { hex, complete: true };
    },

    // REAL: getNewAddress – local
    getNewAddressAsync: async () => {
      return makeNewAddress(netName);
    },

    // REAL: addMultisigAddress – local
    addMultisigAddressAsync: async (m, pubkeys) => {
      // some callers pass 1 object; support both
      if (typeof m === 'object' && m !== null) {
        return makeMultisig(m);
      }
      return makeMultisig({ m, pubkeys, network: netName });
    },

    // decode
    decoderawtransactionAsync: async (hex) => {
      const btc = ensureBitcoin();
      const tx = btc.Transaction.fromHex(hex);
      return {
        txid: tx.getId(),
        version: tx.version,
        locktime: tx.locktime,
        vin: tx.ins.map((i) => ({
          txid: Buffer.from(i.hash).reverse().toString('hex'),
          vout: i.index,
        })),
        vout: tx.outs.map((o, n) => ({
          n,
          value: o.value,
          scriptPubKey: { hex: o.script.toString('hex') },
        })),
      };
    },

    validateAddress: async (address) => ({ isvalid: true, address }),

    // stubs
    getRawTransactionAsync: async () => null,
    getBlockDataAsync: async () => null,
    createRawTransactionAsync: async () => {
      throw new Error('createRawTransactionAsync not available in browser runtime');
    },
    listUnspentAsync: async () => [],
    dumpprivkeyAsync: async () => {
      throw new Error('dumpprivkeyAsync not available in browser runtime');
    },
    sendrawtransactionAsync: async (hex) => {
      console.warn('[local rpc] sendrawtransactionAsync called; no real RPC available');
      return { txid: 'local-' + Date.now(), hex };
    },
    getBlockCountAsync: async () => 0,
    importmultiAsync: async () => ({}),
  };
}

module.exports = {
  makeLocalRpc,
  makeNewAddress,
  makeMultisig,
};
