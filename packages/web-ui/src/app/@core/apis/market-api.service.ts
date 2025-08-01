import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { map } from 'rxjs/operators';
// import { TNETWORK } from "../services/rpc.service";

@Injectable({
    providedIn: 'root',
})

export class MarketApiService {
    // private NETWORK: TNETWORK = null;
    private orderbookUrl: string | null = 'wss:ws.layerwallet.com';

    constructor(
        private http: HttpClient,
    ) {}

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

    getSpotMarkets() {
        console.log('spot markets '+this.apiUrl + 'spot')
        const spotURL = 'https://ws.layerwallet.com/ws/markets/spot'
        const markets =  this.http.get(spotURL)
        console.log('returning spot markets '+JSON.stringify(markets))
        const mapped = markets.pipe(map((res: any) => res.data));
        console.log('mapped markets '+JSON.stringify(mapped))
        return mapped
    }

    getFuturesMarkets() {    
        console.log('futures markets '+this.apiUrl + 'futures')
       
          const futuresURL = 'https://ws.layerwallet.com/ws/markets/futures'
            
        return this.http.get(futuresURL)
            .pipe(map((res: any) => res.data));
    }
}
