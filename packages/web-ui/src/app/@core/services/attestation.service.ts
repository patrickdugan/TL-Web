import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { AuthService } from "./auth.service";
import { RpcService } from "./rpc.service";
import { ApiService } from "./api.service";
import {WalletService} from "./wallet.service"
import {BalanceService} from "./balance.service"
import axios from 'axios'

@Injectable({
    providedIn: 'root',
})

export class AttestationService {
    private attestations: { 
      address: string; 
      isAttested: boolean | 'PENDING'; 
      data?: { status: string; [key: string]: any }; // Optional data field
    }[] = [];

    private looping: boolean = false

    constructor(
        private authService: AuthService,
        private rpcService: RpcService,
        private apiService: ApiService,
        private walletService: WalletService,
        private toastrService: ToastrService,
        private balanceService: BalanceService
    ) { }

    get tlApi() {
        return this.apiService.newTlApi;
    }

    onInit() {
        this.authService.updateAddressesSubs$
            .subscribe(kp => {
                if (!kp.length) this.removeAll();
                this.checkAllAtt();
            });

        this.rpcService.blockSubs$
            .subscribe(() => this.checkPending());
        console.log('initializing attestation loop')    
        this.startAttestationUpdateInterval();
    }

    startAttestationUpdateInterval() {
        this.looping = true
        this.checkAllAtt(); // Call immediately to fetch fresh data
        setInterval(() => this.checkAllAtt(), 20000); // Update every 20 seconds
    }

    private async checkAllAtt() {
        try {
            const accounts = await this.walletService.requestAccounts(this.balanceService.NETWORK);
            const addresses = accounts.map((account) => account.address);
            console.log('Addresses fetched from wallet: ', addresses);

            for (const address of addresses) {
                await this.checkAttAddress(address);
            }
        } catch (error: any) {
            console.error('Error checking attestations:', error.message);
        }
    }

    async checkAttAddress(address: string): Promise<boolean> {
        console.log('Checking attestation for address: ' + address);

        const url = this.rpcService.NETWORK === "LTCTEST"
            ? 'https://testnet-api.layerwallet.com'
            : 'https://api.layerwallet.com';

        try {
            const payload = { address, id: 0 };
            const response = await axios.post(`${url}/rpc/tl_getAttestations`, payload);

            const attestationArray = response?.data || [];
            const attestationData = attestationArray.find(
                (entry: any) => entry?.data?.status === 'active'
            );

            const isAttested = !!attestationData && attestationData.data?.status === 'active';
            console.log(`Attestation data for ${address}:`, attestationData);

            // Update the attestation array
            const existing = this.attestations.find((a) => a.address === address);
            if (existing) {
                existing.isAttested = isAttested;
                existing.data = attestationData?.data || null;
            } else {
                this.attestations.push({
                    address,
                    isAttested,
                    data: attestationData?.data || null,
                });
            }

            console.log(`Attestation updated for ${address}:`, isAttested);
            return isAttested;
        } catch (error: any) {
            console.error('Error checking attestation:', error.message);
            //this.toastrService.error(error.message, `Error fetching attestation for ${address}`);
            return false;
        }
    }

    getAttByAddress(address: string): 'ATTESTED' | 'PENDING' | 'NOT_ATTESTED' {
        if (!this.looping) {
            this.startAttestationUpdateInterval();
        }

        const attestation = this.attestations.find(e => e.address === address);

        console.log('Attestation object:', JSON.stringify(attestation));

        // If no attestation found, return NOT_ATTESTED
        if (!attestation) {
            return 'NOT_ATTESTED';
        }

        // If attestation is pending
        if (attestation.isAttested === 'PENDING') {
            return 'PENDING';
        }

        // Return ATTESTED or NOT_ATTESTED based on status
        return attestation.isAttested ? 'ATTESTED' : 'NOT_ATTESTED';
    }

    private removeAll() {
        this.attestations = [];
    }
    
    private async checkPending() {
        for (const attestation of this.attestations.filter(a => a.isAttested === 'PENDING')) {
            const isAttested = await this.checkAttAddress(attestation.address);
            attestation.isAttested = isAttested || 'PENDING'; // Update to 'true' if attested, else remain 'PENDING'
        }
    }

    setPendingAtt(address: string) {
        const existing = this.attestations.find(a => a.address === address);
        if (existing) {
            existing.isAttested = 'PENDING';
        } else {
            this.attestations.push({ address, isAttested: 'PENDING' });
        }
    }

}