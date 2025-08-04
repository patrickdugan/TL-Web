import { Component, OnInit, OnDestroy } from '@angular/core';
import { AuthService } from 'src/app/@core/services/auth.service';
import { /*obEventPrefix,*/ SocketService } from 'src/app/@core/services/socket.service';
import { Subscription } from 'rxjs';
import { filter } from "rxjs/operators";
import { FuturesOrdersService } from 'src/app/@core/services/futures-services/futures-orders.service';
import { IFuturesOrder } from 'src/app/@core/services/futures-services/futures-orderbook.service';

@Component({
  selector: 'tl-futures-orders',
  templateUrl: '../../../../spot-page/spot-trading-grid/spot-bottom-card/spot-orders/spot-orders.component.html',
  styleUrls: ['../../../../spot-page/spot-trading-grid/spot-bottom-card/spot-orders/spot-orders.component.scss']
})

export class FuturesOrdersComponent implements OnInit, OnDestroy {
    private subsArray: Subscription[] = [];
    private socketSubscriptions: Subscription[] = [];

    displayedColumns: string[] = ['date', 'market', 'amount', 'price', 'isBuy', 'close'];

    constructor(
      private futuresOrdersService: FuturesOrdersService,
      private socketService: SocketService,
      private authService: AuthService,
    ) {}

    get openedOrders() {
      return this.futuresOrdersService.openedOrders;
    }

    closeOrder(uuid: string) {
      this.futuresOrdersService.closeOpenedOrder(uuid);
    }

    ngOnInit() {
       this.subscribe();
    }

     private subscribe() {
       this.socketSubscriptions.push(
    this.socketService.events$
      .pipe(filter(({ event }) => event === 'placed-orders'))
      .subscribe(({ data }) => {
        const { openedOrders, orderHistory }: { openedOrders: IFuturesOrder[], orderHistory: IFuturesOrder[] } = data;
        this.futuresOrdersService.orderHistory = orderHistory
          .filter(q =>
            q.type === "FUTURES" &&
            q.keypair.pubkey === this.authService.activeFuturesKey?.pubkey &&
            q.state
          );
        this.futuresOrdersService.openedOrders = openedOrders.filter(q => q.type === "FUTURES");
      })
  );

  this.socketSubscriptions.push(
    this.socketService.events$
      .pipe(filter(({ event }) => event === 'disconnect'))
      .subscribe(() => {
        this.futuresOrdersService.orderHistory = [];
        this.futuresOrdersService.openedOrders = [];
      })
  );

      this.futuresOrdersService.closeOpenedOrder('test-for-update');


       const subs = this.authService.updateAddressesSubs$
         .subscribe(kp => {
           if (!this.authService.activeFuturesKey || !kp.length) this.futuresOrdersService.closeAllOrders();
         });
       this.subsArray.push(subs);
     }

    ngOnDestroy() {
      this.socketSubscriptions.forEach(sub => sub.unsubscribe());
      this.socketSubscriptions = [];
    }

}
