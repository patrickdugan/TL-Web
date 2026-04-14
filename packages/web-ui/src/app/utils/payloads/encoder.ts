import BigNumber from 'bignumber.js';

const marker = 'tl';

const encodeAmount = (amt: number | string): string => {
  const bigAmt = new BigNumber(amt);
  const scaledAmt = bigAmt.times(1e8);
  const isWholeNumber = bigAmt.mod(1).isZero();

  return isWholeNumber
    ? bigAmt.integerValue().toNumber().toString(36)
    : scaledAmt.integerValue().toNumber().toString(36) + '~';
};

const encodeSend = (params: { sendAll: boolean, address: string, propertyId: number | number[], amount: number | number[] }) => {
  if (params.sendAll) return `1;${params.address}`;

  if (Array.isArray(params.propertyId) && Array.isArray(params.amount)) {
    const payload = [
      '0',
      '',
      params.propertyId.map(id => id.toString(36)).join(','),
      params.amount.map(encodeAmount).join(',')
    ];
    return payload.join(';');
  } else {
    const amountValue = Array.isArray(params.amount) ? params.amount[0] : params.amount;
    const payload = [
      '0',
      params.address,
      (params.propertyId as number).toString(36),
      encodeAmount(amountValue)
    ];
    const txNumber = 2;
    const txNumber36 = txNumber.toString(36);
    return marker + txNumber36 + payload.join(';');
  }
};

type TradeTokensChannelParams = {
  propertyId1: number;
  propertyId2: number;
  amountOffered1: number;
  amountDesired2: number;
  columnAIsOfferer: number;
  expiryBlock: number;
  columnAIsMaker: number;
};

const encodeTradeTokensChannel = (params: TradeTokensChannelParams): string => {
  const payload = [
    params.propertyId1.toString(36),
    params.propertyId2.toString(36),
    new BigNumber(params.amountOffered1).times(1e8).toString(36),
    new BigNumber(params.amountDesired2).times(1e8).toString(36),
    params.columnAIsOfferer,
    params.expiryBlock.toString(36),
    params.columnAIsMaker,
  ];
  // After:
const type = 20;
const typeChar = type.toString(36);  
return marker + typeChar + payload.join(',');
};

type EncodeTradeContractParams = {
  contractId: number;
  price: number;
  amount: number;
  columnAIsSeller: number;
  expiryBlock: number;
  insurance: boolean;
  columnAIsMaker: number;
};

const encodeTradeContractChannel = (params: EncodeTradeContractParams): string => {
  const payload = [
    params.contractId.toString(36),
    new BigNumber(params.price).times(1e8).integerValue(BigNumber.ROUND_HALF_UP).toString(36),
    params.amount.toString(36),
    params.columnAIsSeller,
    params.expiryBlock.toString(36),
    params.insurance ? '1' : '0',
    params.columnAIsMaker
  ];
  // After:
const type = 19;
const typeChar = type.toString(36);    // 'j'
return marker + typeChar + payload.join(',');
};

type EncodeCommitParams = {
  propertyId: number;
  amount: number;
  channelAddress: string;
  ref?: number;
};

const encodeCommit = (params: EncodeCommitParams): string => {
  const payload = [
    params.propertyId.toString(36),
    new BigNumber(params.amount).times(1e8).toString(36),
    params.channelAddress.length > 42 ? `ref:${params.ref || 0}` : params.channelAddress
  ];
  return marker + '4' + payload.join(',');
};

type EncodeTradeTokenForUTXOParams = {
  propertyId: number;
  amount: number;
  columnA: number;
  satsExpected: number;
  tokenOutput: number;
  payToAddress: number;
};

const encodeTradeTokenForUTXO = (params: EncodeTradeTokenForUTXOParams): string => {
  const payload = [
    params.propertyId.toString(36),
    new BigNumber(params.amount).times(1e8).toString(36),
    params.columnA,
    new BigNumber(params.satsExpected).times(1e8).toString(36),
    params.tokenOutput.toString(36),
    params.payToAddress.toString(36),
  ];
  return marker + '3' + payload.join(',');
};

type EncodeTransferParams = {
  propertyId: number;
  amount: number;
  isColumnA: boolean;
  destinationAddr: string;
  ref?: number;
};

const encodeTransfer = (params: EncodeTransferParams): string => {
  const propertyId = params.propertyId.toString(36);
  const amounts = new BigNumber(params.amount).times(1e8).toString(36);
  const isColumnA = params.isColumnA ? 1 : 0;
  const destinationAddr = params.destinationAddr.length > 42 ? `ref:${params.ref || 0}` : params.destinationAddr;
  return [propertyId, amounts, isColumnA, destinationAddr].join(',');
};

type EncodeAttestationParams = {
  revoke: number;
  id: number;
  targetAddress: string;
  metaData: string;
};

type EncodeTokenIssueParams = {
  initialAmount: number | string;
  ticker: string;
  whitelists?: number[];
  managed?: boolean;
  backupAddress?: string;
  nft?: boolean;
  coloredCoinHybrid?: boolean;
  proceduralType?: number | null;
};

type EncodeWithdrawalParams = {
  withdrawAll: number; // 1 for true, 0 for false
  propertyId: number;
  amountOffered: number;
  column: number; // 0 for A, 1 for B
  channelAddress: string;
  ref?: number;
};

const encodeWithdrawal = (p: EncodeWithdrawalParams): string => {
  const withdrawAll = (p.withdrawAll ? 1 : 0).toString();
  const propertyIds = p.propertyId.toString(36);
  const amounts = new BigNumber(p.amountOffered)
    .times(1e8)
    .integerValue(BigNumber.ROUND_DOWN)
    .toString(36);
  const column = (typeof p.column === 'boolean' ? (p.column ? 1 : 0) : p.column).toString();
  const chanField = p.channelAddress.length > 42 ? `ref:${p.ref ?? 0}` : p.channelAddress;

  const type = 21;
  const typeStr = type.toString(36); // 'l'

  const payload = [withdrawAll, propertyIds, amounts, column, chanField].join(',');
  const out = marker + typeStr + payload;

  // Optional: keep OP_RETURN under standard policy
  // if (Buffer.byteLength(out, 'utf8') > 80) throw new Error('OP_RETURN too large');

  return out;
};

const encodeTokenIssue = (params: EncodeTokenIssueParams): string => {
  const payload = [
    Number(params.initialAmount || 0).toString(36),
    params.ticker || '',
    (params.whitelists || []).map((val) => Number(val).toString(36)).join(','),
    params.managed ? '1' : '0',
    params.backupAddress || '',
    params.nft ? '1' : '0',
    params.coloredCoinHybrid ? '1' : '0',
    params.proceduralType == null ? '' : Number(params.proceduralType).toString(36),
  ];

  return marker + (1).toString(36) + payload.join(',');
};

const encodeAttestation = (params: EncodeAttestationParams): string => {
  const payload = [
    params.revoke.toString(36),
    params.id.toString(36),
    params.targetAddress,
    params.metaData
  ];
  return marker + '9' + payload.join(',');
};

type EncodeGrantManagedTokenParams = {
  propertyId?: number;
  propertyid?: number;
  amountGranted: number | string;
  addressToGrantTo?: string;
  redeemAddress?: string;
  dlcTemplateId?: string;
  dlcContractId?: string;
  settlementState?: string;
  dlcHash?: string;
  commitClearlistId?: number;
};

const encodeGrantManagedToken = (params: EncodeGrantManagedTokenParams): string => {
  const payload = [
    Number(params.propertyid ?? params.propertyId).toString(36),
    new BigNumber(params.amountGranted).times(1e8).integerValue(BigNumber.ROUND_DOWN).toString(36),
    params.redeemAddress || params.addressToGrantTo || '',
    '',
    params.dlcTemplateId || '',
    params.dlcContractId || '',
    params.settlementState || '',
    params.dlcHash || '',
  ];
  if (Number.isInteger(params.commitClearlistId)) {
    payload.push(Number(params.commitClearlistId).toString(36));
  }

  return marker + (11).toString(36) + payload.join(',');
};

type EncodeRedeemManagedTokenParams = {
  propertyId?: number;
  propertyid?: number;
  amountDestroyed: number | string;
  dlcTemplateId?: string;
  dlcContractId?: string;
  settlementState?: string;
};

const encodeRedeemManagedToken = (params: EncodeRedeemManagedTokenParams): string => {
  const payload = [
    Number(params.propertyid ?? params.propertyId).toString(36),
    new BigNumber(params.amountDestroyed).times(1e8).integerValue(BigNumber.ROUND_DOWN).toString(36),
    params.dlcTemplateId || '',
    params.dlcContractId || '',
  ];

  return marker + (12).toString(36) + payload.join(',');
};

export type EncodeMintSyntheticParams = {
  propertyId: number;
  contractId: number;
  amount: string | number;
};

export const encodeMintSynthetic = (params: EncodeMintSyntheticParams): string => {
  const typeStr = (24).toString(36);
  const amt36 = new BigNumber(params.amount)
    .times(1e8)
    .integerValue(BigNumber.ROUND_DOWN)
    .toString(36);

  const payload = [
    Number(params.propertyId).toString(36),
    Number(params.contractId).toString(36),
    amt36,
  ];

  return marker + typeStr + payload.join(',');
};

export type EncodeRedeemSyntheticParams = {
  propertyId: string;
  contractId: number;
  amount: string | number;
};

export const encodeRedeemSynthetic = (params: EncodeRedeemSyntheticParams): string => {
  const typeStr = (25).toString(36);
  const amt36 = new BigNumber(params.amount)
    .times(1e8)
    .integerValue(BigNumber.ROUND_DOWN)
    .toString(36);

  const payload = [
    Number(params.propertyId).toString(36),
    Number(params.contractId).toString(36),
    amt36,
  ];

  return marker + typeStr + payload.join(',');
};

export const ENCODER = {
  encodeTokenIssue,
  encodeSend,
  encodeTradeTokensChannel,
  encodeTradeContractChannel,
  encodeTradeTokenForUTXO,
  encodeCommit,
  encodeTransfer,
  encodeAttestation,
  encodeGrantManagedToken,
  encodeRedeemManagedToken,
  encodeWithdrawal,
  encodeMintSynthetic,
  encodeRedeemSynthetic,
};

