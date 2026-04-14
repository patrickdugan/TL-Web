import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { from, Observable } from "rxjs";
import { environment } from "src/environments/environment";
import { TNETWORK } from "../services/rpc.service";
import { RelayerWsService } from "../services/relayer-ws.service";


@Injectable({
    providedIn: 'root',
})

export class TradeLayerApiService {
    // private NETWORK: TNETWORK = null;
    private apiUrl: string | null = "170.75.170.246:443";

    constructor(
        private http: HttpClient,
        private relayerWsService: RelayerWsService,
    ) {}

    private get apiURL() {
        if (!this.apiUrl) return null;
        return this.apiUrl;
    }

    setApiUrl(value: string | null) {
        this.apiUrl = value;
    }

    rpc(method: string, params?: any[]): Observable<{
        data?: any;
        error?: any;
    }> {
        return from(
            this.relayerWsService.request<{
                data?: any;
                error?: any;
            }>(`/rpc/${method}`, {
                method: "POST",
                body: { params },
            })
        );
    }

    validateAddress(address: string): Observable<{
        data?: any;
        error?: any;
    }>  {
        return from(
            this.relayerWsService.request<{
                data?: any;
                error?: any;
            }>(`/address/validate/${address}`, { method: "GET" })
        );
    }

    fundTestnetAddress(address: string): Observable<{
        data?: any;
        error?: any;
    }>  {
        return from(
            this.relayerWsService.request<{
                data?: any;
                error?: any;
            }>(`/address/faucet/${address}`, { method: "GET" })
        );
    }
}
