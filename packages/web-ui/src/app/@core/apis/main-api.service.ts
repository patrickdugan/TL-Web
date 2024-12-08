import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable } from "rxjs";
import { environment } from "src/environments/environment";
import { ENetwork, TNETWORK } from "../services/rpc.service";
import { IBuildLTCITTxConfig, IBuildTxConfig, ISignPsbtConfig, ISignTxConfig } from "../services/txs.service";
import { smartRpc, buildTx, buildLTCInstatTx, signTx, buildPsbt, jsTlApi } from "../tx-builder-service";

@Injectable({
    providedIn: 'root',
})
export class MainApiService {
    constructor(private http: HttpClient) {}

    rpcCall(method: string, params?: any[]): Observable<any> {
        return new Observable(observer => {
            smartRpc(method, params)
                .then(res => observer.next(res))
                .catch(err => observer.error(err))
                .finally(() => observer.complete());
        });
    }

    buildTx(buildTxConfig: IBuildTxConfig, isApiMode: boolean): Observable<any> {
        return new Observable(observer => {
            buildTx(buildTxConfig, isApiMode)
                .then(res => observer.next(res))
                .catch(err => observer.error(err))
                .finally(() => observer.complete());
        });
    }

    buildLTCITTx(buildTxConfig: IBuildLTCITTxConfig, isApiMode: boolean): Observable<any> {
        return new Observable(observer => {
            buildLTCInstatTx(buildTxConfig, isApiMode)
                .then(res => observer.next(res))
                .catch(err => observer.error(err))
                .finally(() => observer.complete());
        });
    }

    signTx(buildTxConfig: ISignTxConfig, network: string): Observable<any> {
        return new Observable(observer => {
            signTx(buildTxConfig)
                .then(res => observer.next(res))
                .catch(err => observer.error(err))
                .finally(() => observer.complete());
        });
    }

    signPsbt(buildPsbtConfig: ISignPsbtConfig, network: string): Observable<any> {
        return new Observable(observer => {
            const result = buildPsbt({
                rawtx: buildPsbtConfig.psbtHex,
                inputs: buildPsbtConfig.inputs,
                network: buildPsbtConfig.network,
            });
            if (result.error) {
                observer.error(result.error);
            } else {
                observer.next(result);
            }
            observer.complete();
        });
    }

    initTradeLayer(): Observable<any> {
        return new Observable(observer => {
            jsTlApi('init-tradelayer', [])
                .then(res => observer.next(res))
                .catch(err => observer.error(err))
                .finally(() => observer.complete());
        });
    }
}
