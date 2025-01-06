import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { AuthService } from "./auth.service";
import { RpcService } from "./rpc.service";
import { ApiService } from "./api.service";
import {WalletService} from "./wallet.service"
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
        private toastrService: ToastrService
    ) { }

    private readonly CRIMINAL_IP_API_KEY = "RKohp7pZw3LsXBtbmU3vcaBByraHPzDGrDnE0w1vI0qTEredJnMPfXMRS7Rk";
    private readonly IPINFO_TOKEN = "5992daa04f9275";

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
            const accounts = await this.walletService.requestAccounts();
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

            const isAttested = !!attestationData;

            // Update the attestation array
            const existing = this.attestations.find((a) => a.address === address);
            if (existing) {
                existing.isAttested = isAttested;
                existing.data = attestationData?.data || null;
            } else {
                this.attestations.push({ address, isAttested, data: attestationData?.data || null });
            }

            console.log(`Attestation updated for ${address}:`, isAttested);
            return isAttested;
        } catch (error: any) {
            console.error('Error checking attestation:', error.message);
            this.toastrService.error(error.message, `Error fetching attestation for ${address}`);
            return false;
        }
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

    
    getAttByAddress(address: string): string | 'PENDING' | false {
        if(this.looping ==false){
            this.startAttestationUpdateInterval()
        }
        const attestation = this.attestations.find(e => e.address === address);

        console.log('Attestation object:', JSON.stringify(attestation));

        // If attestation is undefined, return false
        if (!attestation) {
            return false;
        }

        // Explicitly check if the attestation is marked as 'PENDING'
        if (attestation.isAttested === 'PENDING') {
            return 'PENDING';
        }

        // Return the status if attestation data exists
        return attestation.data?.status || false;
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