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
    encodeAmount(params.price),
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

type EncodeWithdrawalParams = {
  withdrawAll: number; // 1 for true, 0 for false
  propertyId: number;
  amountOffered: number;
  column: number; // 0 for A, 1 for B
  channelAddress: string;
};

const encodeWithdrawal = (params: EncodeWithdrawalParams): string => {
  const amounts = new BigNumber(params.amountOffered).times(1e8).toString(36);
  const propertyIds = params.propertyId.toString(36);
  const payload = [
    params.withdrawAll,
    propertyIds,
    amounts,
    params.column,
    params.channelAddress
  ].join(',');
  const type = 21;
  const typeStr = type.toString(36);
  return marker + typeStr + payload;
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

export const ENCODER = {
  encodeSend,
  encodeTradeTokensChannel,
  encodeTradeContractChannel,
  encodeTradeTokenForUTXO,
  encodeCommit,
  encodeTransfer,
  encodeAttestation,
  encodeWithdrawal
};

