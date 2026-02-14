import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import { RpcService } from 'src/app/@core/services/rpc.service';
import { TxsService } from 'src/app/@core/services/txs.service';
import { WalletService } from 'src/app/@core/services/wallet.service';

@Component({
  selector: 'deposit-dialog',
  templateUrl: './deposit.component.html',
  styleUrls: ['./deposit.component.scss']
})
export class DepositDialog {
    amount = '';
    submitting = false;

    constructor(
        public dialogRef: MatDialogRef<DepositDialog>,
        @Inject(MAT_DIALOG_DATA) private data: any,
        private toastrService: ToastrService,
        private rpcService: RpcService,
        private walletService: WalletService,
        private txsService: TxsService,
    ) { }

    get address() {
        return this.data?.address;
    }

    get propId() {
        return Number(this.data?.propId);
    }

    get isBitcoinNetwork() {
        return String(this.rpcService.NETWORK || '').toUpperCase() === 'BTC';
    }

    get isCoinReceive() {
        return this.propId === -1;
    }

    get canOneClickDeposit() {
        return this.isBitcoinNetwork && this.isCoinReceive;
    }

    copyAddress() {
        navigator.clipboard.writeText(this.address);
        this.toastrService.info('Address Copied to clipboard', 'Copied')
    }

    async depositWithPhantom() {
        if (!this.canOneClickDeposit) return;
        if (this.submitting) return;

        const amountNum = Number(this.amount);
        if (!Number.isFinite(amountNum) || amountNum <= 0) {
            this.toastrService.error('Enter a valid BTC amount', 'Invalid Amount');
            return;
        }

        try {
            this.submitting = true;

            if (!this.walletService.provider$.value) {
                await this.walletService.connectPreferred();
            }

            if (this.walletService.activeWallet !== 'phantom') {
                this.toastrService.error('Phantom BTC must be connected for one-click deposit', 'Wallet Error');
                return;
            }

            const accounts = await this.walletService.requestAccounts('BTC');
            const from = accounts?.[0];
            if (!from?.address) throw new Error('No Phantom BTC account available');

            const sendRes = await this.txsService.buildSignSendTx({
                fromKeyPair: { address: from.address, pubkey: from.pubkey },
                toKeyPair: { address: this.address },
                amount: amountNum,
            });

            if (sendRes.error) throw new Error(sendRes.error);

            this.toastrService.success(`Broadcasted BTC deposit tx: ${sendRes.data}`, 'Deposit Submitted');
            this.dialogRef.close(sendRes.data);
        } catch (err: any) {
            this.toastrService.error(err?.message || 'Failed to submit Phantom BTC deposit', 'Deposit Error');
        } finally {
            this.submitting = false;
        }
    }

    close() {
        this.dialogRef.close();
    }
}
