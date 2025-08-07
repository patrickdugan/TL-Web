import { Injectable } from '@angular/core';
import { CanActivate } from '@angular/router';
import { DialogService, DialogTypes } from '../services/dialogs.service';
import { RpcService } from '../services/rpc.service';

@Injectable({
    providedIn: 'root',
})

export class RPCGuard implements CanActivate {
    constructor(
        private rpcService: RpcService,
        private dialogService: DialogService,
    ) {}

    async canActivate(): Promise<boolean> {
        return true;
   }
}