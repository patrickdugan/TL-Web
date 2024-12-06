import { Injectable } from "@angular/core";
import { ApiService } from "./api.service";

@Injectable({
  providedIn: 'root',
})
export class RpcService {
  private _NETWORK: 'LTC' | 'LTCTEST' | null = null;

  isCoreStarted: boolean = false;
  isNetworkSelected: boolean = true;
  isAbleToRpc: boolean = true; // Default to true
  lastBlock: number = 0;

  constructor(private apiService: ApiService) {}

  onInit() {
    console.log("RPC Service initialized");
  }

  get isSynced() {
    return true; // Hardcoded true
  }
}
