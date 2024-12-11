import { WalletService } from './wallet.service'; // Import WalletService
import { buildPsbt } from '../utils/crypto.util'; // Assuming this uses bitcoinjs-lib
import { safeNumber } from '../utils/common.util';

export interface IBuildTxConfig {
  fromKeyPair: {
    address: string;
    pubkey?: string;
  };
  toKeyPair: {
    address: string;
    pubkey?: string;
  };
  amount: number;
  payload?: string;
  network: string; // Example: "bitcoin" or "litecoin"
}


export interface IBuildLTCITTxConfig {
  buyerKeyPair: {
    address: string;
    pubkey?: string;
  };
  sellerKeyPair: {
    address: string;
    pubkey?: string;
  };
  amount: number; // Amount in LTC
  payload: string; // OP_RETURN data
  commitUTXOs: IInput[]; // Token UTXOs
  network: string; // Network: "litecoin" or similar
}

export interface IInput {
  txid: string;
  vout: number;
  amount: number;
  scriptPubKey: string;
}

const MIN_FEE_LTC_PER_KB = 0.0001; // Example minimum fee

export class TxBuilder {
  constructor(private walletService: WalletService) {}

  async buildTransaction(config: IBuildTxConfig): Promise<string> {
    const { fromKeyPair, toKeyPair, amount, payload, network } = config;

    // Step 1: Fetch UTXOs
    const utxos = await this.fetchUTXOs(fromKeyPair.address);
    if (!utxos.length) {
      throw new Error('No UTXOs available');
    }

    // Step 2: Select inputs
    const { inputs, change } = this.selectInputs(utxos, amount, MIN_FEE_LTC_PER_KB);

    // Step 3: Build outputs
    const outputs: Record<string, number> = {
      [toKeyPair.address]: safeNumber(amount),
    };
    if (change > 0) {
      outputs[fromKeyPair.address] = safeNumber(change);
    }

    // Step 4: Build PSBT
    const psbt = buildPsbt({
      inputs,
      outputs,
      network,
    });

    // Step 5: Attach OP_RETURN payload (if any)
    if (payload) {
      psbt.addOutput({
        script: Buffer.from(payload, 'utf8'),
        value: 0,
      });
    }

    // Step 6: Sign transaction using wallet
    const signedPsbt = await this.walletService.signPSBT(psbt.toBase64());
    if (!signedPsbt) {
      throw new Error('Transaction signing failed');
    }

    return signedPsbt; // Return the signed PSBT or raw transaction
  }

  private async fetchUTXOs(address: string): Promise<IInput[]> {
    // Example implementation: Replace with actual UTXO fetch logic
    const utxoApi = `https://blockchain.info/unspent?active=${address}`;
    const response = await fetch(utxoApi);
    const { unspent_outputs: unspentOutputs } = await response.json();

    return unspentOutputs.map((utxo: any) => ({
      txid: utxo.tx_hash_big_endian,
      vout: utxo.tx_output_n,
      amount: utxo.value / 1e8, // Convert satoshis to BTC/LTC
      scriptPubKey: utxo.script,
    }));
  }

  private selectInputs(utxos: IInput[], targetAmount: number, feeRate: number) {
    let selectedInputs: IInput[] = [];
    let total = 0;

    for (const utxo of utxos) {
      selectedInputs.push(utxo);
      total += utxo.amount;

      const fee = selectedInputs.length * feeRate; // Simplified fee calculation
      if (total >= targetAmount + fee) {
        const change = total - targetAmount - fee;
        return { inputs: selectedInputs, change };
      }
    }

    throw new Error('Insufficient funds');
  }


export const buildLTCInstatTx = async (
  txConfig: IBuildLTCITTxConfig,
  walletService: WalletService
): Promise<string> => {
  try {
    const { buyerKeyPair, sellerKeyPair, amount, payload, commitUTXOs, network } = txConfig;

    const buyerAddress = buyerKeyPair.address;
    const sellerAddress = sellerKeyPair.address;

    // Step 1: Validate buyer and seller addresses
    if (!buyerAddress || !sellerAddress) {
      throw new Error('Invalid buyer or seller address');
    }

    // Step 2: Fetch additional UTXOs for the buyer
    const additionalUTXOs = await fetchUTXOs(buyerAddress);
    if (!additionalUTXOs.length) {
      throw new Error('No additional UTXOs available for buyer');
    }

    // Combine token UTXOs and additional UTXOs
    const utxos = [...commitUTXOs, ...additionalUTXOs];

    // Step 3: Calculate required inputs and outputs
    const buyerLtcAmount = 0.0001; // Example minimum amount buyer receives
    const sellerLtcAmount = safeNumber(amount);

    const { inputs, change } = selectInputs(utxos, safeNumber(sellerLtcAmount + buyerLtcAmount), 0.0001);

    const outputs: Record<string, number> = {
      [buyerAddress]: safeNumber(change),
      [sellerAddress]: safeNumber(sellerLtcAmount),
    };

    // Step 4: Build the transaction
    const psbt = buildPsbt({
      inputs,
      outputs,
      network,
    });

    // Step 5: Add OP_RETURN payload
    if (payload) {
      psbt.addOutput({
        script: Buffer.from(payload, 'utf8'),
        value: 0, // OP_RETURN has no associated value
      });
    }

    // Step 6: Sign the PSBT using the wallet
    const signedTx = await walletService.signPSBT(psbt.toBase64());
    if (!signedTx) {
      throw new Error('Transaction signing failed');
    }

    return signedTx; // Return the signed transaction
  } catch (error) {
    console.error('Error building LTC transaction:', error.message);
    throw new Error(error.message || 'Unknown build transaction error');
  }
};

const fetchUTXOs = async (address: string): Promise<IInput[]> => {
  const url = `https://api.blockcypher.com/v1/ltc/main/addrs/${address}?unspentOnly=true`;
  const response = await fetch(url);
  const data = await response.json();

  return data.txrefs.map((utxo: any) => ({
    txid: utxo.tx_hash,
    vout: utxo.tx_output_n,
    amount: utxo.value / 1e8, // Convert satoshis to LTC
    scriptPubKey: utxo.script,
  }));
};

}
