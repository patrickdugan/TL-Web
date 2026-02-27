import { Component, OnDestroy } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'password-dialog',
  templateUrl: './password.component.html',
  styleUrls: ['./password.component.scss']
})
export class PasswordDialog implements OnDestroy {
    password: string = '';
    constructor(
        public dialogRef: MatDialogRef<PasswordDialog>,
    ) { }

    validate() {
        const p = this.password;
        this.password = '';
        this.dialogRef.close(p);
    }

    close() {
        this.password = '';
        this.dialogRef.close();
    }

    ngOnDestroy(): void {
        this.password = '';
    }
}
