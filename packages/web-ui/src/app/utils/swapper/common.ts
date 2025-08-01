export class SwapEvent {
    constructor(
        public eventName: string,
        public socketId: string,
        public data: any = null,
    ) {}
};

export enum ETradeType {
    SPOT = "SPOT",
    FUTURES = "FUTURES",
};

export type TClient = (method: string, ...args: any[]) => Promise<{
    data?: any;
    error?: string;
}>;

export interface ISpotTradeProps {
    amountDesired: number;
    amountForSale: number;
    propIdDesired: number;
    propIdForSale: number;
    transfer?: boolean; // Add this  
};

export interface IFuturesTradeProps {
    amount: number;
    contract_id: number;
    price: number;
    margin: number;
    collateral: number;
    transfer?: boolean;
};

export interface IMSChannelData {
    address: string;
    redeemScript: string;
    witnessScript?: string;
    scriptPubKey?: string;
};

export interface IBuyerSellerKeyPair {
    address: string;
    pubkey: string;
};

export interface IBuyerSellerInfo {
    keypair: IBuyerSellerKeyPair;
    socketId: string;
    uuid?: string;
};

export interface ITradeInfo<IProps = IFuturesTradeProps | ISpotTradeProps> {
    buyer: IBuyerSellerInfo;
    seller: IBuyerSellerInfo;
    taker: string;
    maker: string;
    props: IProps;
    type: ETradeType;
};
