import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { map } from 'rxjs/operators';
import { KeysApiService } from "./keys-api.service";
import { environment } from "src/environments/environment";
// import { TNETWORK } from "../services/rpc.service";

@Injectable({
    providedIn: 'root',
})

export class MarketApiService {
    // private NETWORK: TNETWORK = null;
    private orderbookUrl: string | null = environment.ENDPOINTS.BTC.orderbookApiUrl;

    constructor(
        private http: HttpClient,
        private keysApiService: KeysApiService,
    ) {}

    private get endpointBase() {
        const network = this.keysApiService.NETWORK || 'BTC';
        const endpoint = environment.ENDPOINTS[network] || environment.ENDPOINTS.BTC;
        return endpoint.relayerUrl.replace(/\/relayer$/, '');
    }

    private get apiUrl() {
        console.log('loading markets '+this.orderbookUrl + '/markets/')
        // if (!this.NETWORK) return null;
        if (!this.orderbookUrl) return null;
        return this.orderbookUrl + '/markets/';
    }

    setOrderbookUrl(value: string | null) {
        this.orderbookUrl = value;
    }

    // _setNETWORK(value: TNETWORK) {
    //     this.NETWORK = value;
    // }

    getSpotMarkets(network: string) {
        console.log('spot markets '+this.apiUrl + 'spot')
        const spotURL = `${this.endpointBase}/markets/spot/${network}`;
        const markets =  this.http.get(spotURL)
        console.log('returning spot markets '+JSON.stringify(markets))
        const mapped = markets.pipe(map((res: any) => res.data));
        console.log('mapped markets '+JSON.stringify(mapped))
        return mapped
    }

    getFuturesMarkets(network: string) {    
        console.log('futures markets '+this.apiUrl + 'futures')
       
        const futuresURL = `${this.endpointBase}/markets/futures/${network}`;            
        return this.http.get(futuresURL)
            .pipe(map((res: any) => res.data));
    }
}
