// util.js — browser/worker + node-friendly wallet helpers

let bitcoin = null;
let walletUtils = null;

// 1) try node-style first
try {
  bitcoin = require('./bitcoinjs.js');
} catch (e) {
  // 2) browser / worker
  if (typeof self !== 'undefined' && self.bitcoin) {
    bitcoin = self.bitcoin;
  }
}


const BigNumber = require('bignumber.js');

// tiny guard
function ensureBitcoin() {
  if (!bitcoin) {
    throw new Error('bitcoinlib/bitcoinjs not available in this context');
  }
  return bitcoin;
}


/**
 * Generate a one-off key we can use inside algos.
 * testnet by default.
 */
function makeKey(network) {
  const btc = ensureBitcoin();
  const { bip32, bip39, payments, networks } = btc;

  const net = network || networks.testnet;
  const mnemonic = bip39.generateMnemonic();
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed, net);
  const key = root.derivePath("m/44'/1'/0'/0/0");
  const { address } = payments.p2wpkh({ pubkey: key.publicKey, network: net });

  return {
    mnemonic,
    address,
    privWIF: key.toWIF(),
    pubHex: key.publicKey.toString('hex'),
    network: net,
  };
}

function signRawTransaction(rawtxHex, wif, network = 'LTCTEST') {
  const btc = ensureBitcoin();
  const net =
    (network && btc.networks[network.toLowerCase?.()]) ||
    btc.networks.testnet;

  const keyPair = btc.ECPair.fromWIF(wif, net);
  const tx = btc.Transaction.fromHex(rawtxHex);

  const txb = btc.TransactionBuilder.fromTransaction(tx, net);

  for (let i = 0; i < tx.ins.length; i++) {
    try {
      txb.sign({
        prevOutScriptType: 'p2wpkh',
        vin: i,
        keyPair,
      });
    } catch (err) {
      console.warn(`signRawTransaction: skipped input ${i}`, err);
    }
  }

  const signed = txb.build();
  return signed.toHex();
}


/**
 * Sign a PSBT (base64) locally with a WIF.
 */
function signPsbtLocal(psbtBase64, wif, network) {
  const btc = ensureBitcoin();
  const { Psbt, ECPair, networks } = btc;
  const net = network || networks.testnet;

  const psbt = Psbt.fromBase64(psbtBase64, { network: net });
  const kp = ECPair.fromWIF(wif, net);

  psbt.signAllInputs(kp);
  psbt.finalizeAllInputs();

  return psbt.extractTransaction().toHex();
}

/*async function getUnifiedSigner(preferredNetwork) {
  const ext = await getExtensionSigner();
  if (ext) {
    return {
      type: 'extension',
      sign: ext,
    };
  }
  const eph = makeEphemeralKey(preferredNetwork);
  return {
    type: 'local',
    key: eph,
    signPsbt: (psbtBase64) => signPsbtLocal(psbtBase64, eph.network),
  };
}*/

// ---------------------------------------------------------------------
// NEW STUFF (does NOT overwrite the above)
// ---------------------------------------------------------------------

// 1) local getNewAddress
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

// 2) local addMultisig
function makeMultisig({ m, pubkeys, network: netName }) {
  const btc = ensureBitcoin();
  const { payments, networks } = btc;
  const net =
    (netName && networks[netName.toLowerCase?.()]) ||
    networks.testnet;

  const pubBuffers = pubkeys.map((hex) => Buffer.from(hex, 'hex'));
  const p2ms = payments.p2ms({ m, pubkeys: pubBuffers, network: net });
  const p2sh = payments.p2sh({ redeem: p2ms, network: net });

  return {
    address: p2sh.address,
    redeemScript: p2ms.output.toString('hex'),
    scriptPubKey: p2sh.output.toString('hex'),
    network: net,
  };
}

// 3) optional: light RPC facade so buyer/seller can do
// this.getNewAddressAsync = this.rpc.getNewAddressAsync;
function makeLocalRpc({ network = 'LTCTEST' } = {}) {
  return {
    getNewAddressAsync: async () => makeNewAddress(network),
    addMultisigAddressAsync: async (m, pubkeys) => {
      if (typeof m === 'object' && m !== null) {
        return makeMultisig(m);
      }
      return makeMultisig({ m, pubkeys, network });
    },
    // leave everything else as no-op so old calls don’t explode
    signrawtransactionwithwalletAsync: async (psbtBase64) => {
      const hex = signPsbtLocal(psbtBase64, network);
      return { hex, complete: true };
    },
    signrawtransactionwithkeyAsync: async (psbtBase64) => {
      const hex = signPsbtLocal(psbtBase64, network);
      return { hex, complete: true };
    },
    sendrawtransactionAsync: async (hex) => {
      console.warn('[local rpc] sendrawtransactionAsync noop; returning fake txid');
      return { txid: 'local-' + Date.now(), hex };
    },
  };
}

function createRawTransaction(inputs, outputs, network = 'LTCTEST') {
  const btc = ensureBitcoin();
  const net =
    (network && btc.networks[network.toLowerCase?.()]) ||
    btc.networks.testnet;

  // Basic transaction builder
  const txb = new btc.TransactionBuilder(net);

  for (const input of inputs) {
    txb.addInput(input.txid, input.vout);
  }

  for (const out of outputs) {
    if (out.data) {
      // Embed data via OP_RETURN
      const data = Buffer.from(out.data, 'hex');
      const embed = btc.payments.embed({ data: [data] });
      txb.addOutput(embed.output, 0);
    } else {
      const addr = Object.keys(out)[0];
      const val = Math.round(out[addr] * 1e8); // convert LTC to satoshis
      txb.addOutput(addr, val);
    }
  }

  // Returns unsigned hex
  const built = txb.buildIncomplete();
  return built.toHex();
}

function createPsbtAsync(inputs, outputs, network = 'LTCTEST') {
  const btc = ensureBitcoin();
  const net =
    (network && btc.networks[network.toLowerCase?.()]) ||
    btc.networks.testnet;

  const psbt = new btc.Psbt({ network: net });

  for (const input of inputs) psbt.addInput(input);
  for (const output of outputs) psbt.addOutput(output);

  return psbt.toBase64();
}

function decodeRawTransactionAsync(rawtx, network = 'LTCTEST') {
  const btc = ensureBitcoin();
  const net =
    (network && btc.networks[network.toLowerCase?.()]) ||
    btc.networks.testnet;

  const tx = btc.Transaction.fromHex(rawtx);
  return {
    txid: tx.getId(),
    version: tx.version,
    locktime: tx.locktime,
    inputs: tx.ins.map((i) => ({
      txid: Buffer.from(i.hash).reverse().toString('hex'),
      vout: i.index,
      scriptSig: i.script?.toString('hex') || null,
      sequence: i.sequence,
    })),
    outputs: tx.outs.map((o, n) => ({
      n,
      value: o.value / 1e8,
      scriptPubKey: o.script.toString('hex'),
    })),
  };
}

function decodepsbtAsync(psbtBase64, network = 'LTCTEST') {
  const btc = ensureBitcoin();
  const net =
    (network && btc.networks[network.toLowerCase?.()]) ||
    btc.networks.testnet;

  const psbt = btc.Psbt.fromBase64(psbtBase64, { network: net });

  const inputs = psbt.data.inputs.map((inp, i) => ({
    index: i,
    witnessUtxo: inp.witnessUtxo
      ? {
          value: inp.witnessUtxo.value / 1e8,
          script: inp.witnessUtxo.script.toString('hex'),
        }
      : null,
    nonWitnessUtxo: inp.nonWitnessUtxo
      ? Buffer.from(inp.nonWitnessUtxo).toString('hex')
      : null,
  }));

  const outputs = psbt.txOutputs.map((out, i) => ({
    index: i,
    address: out.address,
    value: out.value / 1e8,
  }));

  return { inputs, outputs, txid: psbt.txInputs?.[0]?.hash?.toString('hex') };
}


function getPubkeyFromWif(wif, networkName = 'LTCTEST') {
  const { ECPair, networks } = ensureBitcoin();
  const net = networks[networkName.toLowerCase?.()] || networks.testnet;
  const keyPair = ECPair.fromWIF(wif, net);
  return keyPair.publicKey.toString('hex');
}


// ---------------------------------------------------------------------
// FINAL EXPORT — nothing lost
// ---------------------------------------------------------------------
module.exports = {
  // original
  ensureBitcoin,
  //getExtensionSigner,
  //makeEphemeralKey,
  signPsbtLocal,
  //getUnifiedSigner,
  BigNumber,
  // new
  makeNewAddress,
  makeMultisig,
  makeLocalRpc,
  createRawTransaction,
  createPsbtAsync, 
  decodeRawTransactionAsync, 
  decodepsbtAsync,
  signRawTransaction,
  getPubkeyFromWif
};

