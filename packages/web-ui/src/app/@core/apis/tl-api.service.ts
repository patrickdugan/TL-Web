import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

@Injectable({
    providedIn: 'root',
})
export class NewTradeLayerApiService {
    constructor(private http: HttpClient) {}

    // Replace this with your actual API URL
    private get apiUrl() {
        return "https://api.layerwallet.com";
    }

    // Generalized RPC call
    rpc(method: string, params: any[] = []): Observable<{ data?: any; error?: any }> {
        const endpoint = `${this.apiUrl}tl_${method}`; // Prefix with "tl_"
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
