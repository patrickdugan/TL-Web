import { Injectable } from "@angular/core";
import { ApiService } from "../api.service";
import { SocketService } from "../socket.service";
import { FuturesPositionsService } from "./futures-positions.service";
import axios from 'axios';

export interface IFuturesMarketType {
    name: string;
    markets: IFutureMarket[];
    icon: string;
    disabled: boolean;
}

export interface IFutureMarket {
    first_token: IToken;
    second_token: IToken;
    disabled: boolean;
    pairString: string;
    contractName: string;
    contract_id: number;
    collateral: IToken;
    leverage?: number; // Newly added
    notional?: number;
    inverse?: boolean;
}

export interface IToken {
    shortName: string;
    fullName: string;
    propertyId: number;
}

@Injectable({
    providedIn: 'root',
})
export class FuturesMarketService {

    private _futuresMarketsTypes: IFuturesMarketType[] = [];
    private _selectedMarketType: IFuturesMarketType = this.futuresMarketsTypes[0] || null;
    private _selectedMarket: IFutureMarket = this.selectedMarketType?.markets[0] || null;

    public isContractDataReady = false; // Guard flag for data readiness

    constructor(
        private apiService: ApiService,
        private socketService: SocketService,
        private futuresPositionsService: FuturesPositionsService,
    ) {}

    get socket() {
        return this.socketService.obSocket
    }

    get futuresMarketsTypes(): IFuturesMarketType[] {
        return this._futuresMarketsTypes;
    }

    get selectedMarketType(): IFuturesMarketType {
        return this._selectedMarketType;
    }

    set selectedMarketType(value: IFuturesMarketType) {
        if (!this.futuresMarketsTypes.length) return;
        this._selectedMarketType = value;
        this.selectedMarket = this.marketsFromSelectedMarketType.find(e => !e.disabled) || this.marketsFromSelectedMarketType[0];
    }

    get selectedMarketTypeIndex() {
        return this.futuresMarketsTypes.indexOf(this.selectedMarketType);
    }

    get marketsFromSelectedMarketType(): IFutureMarket[] {
        if (!this.futuresMarketsTypes.length) return [];
        return this.selectedMarketType.markets;
    }

    get selectedMarket(): IFutureMarket {
        return this._selectedMarket;
    }

    set selectedMarket(value: IFutureMarket) {
        this._selectedMarket = value;
        this.changeOrderbookMarketFilter();
        this.futuresPositionsService.selectedContractId = (this.selectedMarket.contract_id).toString();
        this.futuresPositionsService.updatePositions();
    }

    get selectedMarketIndex() {
        return this.marketsFromSelectedMarketType.indexOf(this.selectedMarket);
    }

    get marketFilter() {
        return {
            type: 'FUTURES',
            contract_id: this.selectedMarket.contract_id,
        };
    }

    getMarkets() {
        this.apiService.marketApi.getFuturesMarkets()
            .subscribe(async (marketTypes: IFuturesMarketType[]) => {
                this._futuresMarketsTypes = marketTypes;
                this._selectedMarketType = marketTypes.find(e => !e.disabled) || marketTypes[0];
                this._selectedMarket = this._selectedMarketType.markets.find(m => !m.disabled) || this._selectedMarketType.markets[0];

                this.futuresPositionsService.selectedContractId = this._selectedMarket.contract_id.toString();
                this.futuresPositionsService.updatePositions();
                this.changeOrderbookMarketFilter();

                // Add contract enrichment
                await this.enrichWithContractInfo();

                // ✅ Ready to render
                this.isContractDataReady = true;
            });
    }

    private changeOrderbookMarketFilter() {
        this.socket?.emit('update-orderbook', this.marketFilter);
    }

    private async enrichWithContractInfo() {
        const allMarkets = this._futuresMarketsTypes
            .map((type: IFuturesMarketType) => type.markets)
            .reduce((acc, val) => acc.concat(val), []);

        for (const market of allMarkets) {
            try {
                const res = await axios.post('http://localhost:3000/tl_listContractSeries', { contractId: market.contract_id });
                const info = res.data;
                market.leverage = info?.leverage ?? undefined;
                market.notional = info?.notional ?? undefined;
                market.inverse = info?.inverse ?? undefined;
            } catch (err) {
                console.warn(`Failed to load contract info for contract_id ${market.contract_id}`, err);
            }
        }
    }

    getMarketByContractId(contractId: number): IFutureMarket | null {
        const allMarkets = this._futuresMarketsTypes
            .map(type => type.markets)
            .reduce((acc, val) => acc.concat(val), []);
        return allMarkets.find(m => m.contract_id === contractId) || null;
    }
}
