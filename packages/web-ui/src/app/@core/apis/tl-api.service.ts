import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { KeysApiService } from "./keys-api.service";
import { environment } from "src/environments/environment";

@Injectable({
    providedIn: 'root',
})
export class NewTradeLayerApiService {
    constructor(
        private http: HttpClient,
        private keysApiService: KeysApiService,
    ) {}

    private get apiUrl() {
        const network = this.keysApiService.NETWORK || 'BTC';
        const endpoint = environment.ENDPOINTS[network] || environment.ENDPOINTS.BTC;
        return `${endpoint.relayerUrl}/`;
    }

    // Generalized RPC call
    rpc(method: string, params: any[] = []): Observable<{ data?: any; error?: any }> {
        const endpoint = `${this.apiUrl}rpc/tl_${method}`; // Prefix with "tl_"
        const body = { params }; // Wrap params in the expected format

        return this.http.post<any>(endpoint, body).pipe(
            map((response: any) => {
                // Standardize response format to match expected structure
                return {
                    data: response.data || response,
                    error: response.error || null,
                };
            })
        );
    }
}
