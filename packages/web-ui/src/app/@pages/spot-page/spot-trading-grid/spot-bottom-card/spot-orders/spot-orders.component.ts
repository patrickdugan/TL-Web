import { Component, OnInit, OnDestroy } from '@angular/core';
import { AuthService } from 'src/app/@core/services/auth.service';
import { /*obEventPrefix,*/ SocketService } from 'src/app/@core/services/socket.service';
import { ISpotOrder } from 'src/app/@core/services/spot-services/spot-orderbook.service';
import { Subscription } from 'rxjs';
import { filter } from "rxjs/operators";
import { SpotOrdersService } from 'src/app/@core/services/spot-services/spot-orders.service';

@Component({
  selector: 'tl-spot-orders',
  templateUrl: './spot-orders.component.html',
  styleUrls: ['./spot-orders.component.scss']
})

export class SpotOrdersComponent implements OnInit, OnDestroy {
    private subsArray: Subscription[] = [];
    private socketSubscriptions: Subscription[] = [];

    displayedColumns: string[] = ['date', 'market', 'amount', 'price', 'isBuy', 'close'];

    constructor(
      private spotOrdersService: SpotOrdersService,
      private socketService: SocketService,
      private authService: AuthService,
    ) {}

    // --- translate backend rows into the legacy table shape ---
private normalizeOrder(o: any) {
  const marketName = o.marketName ?? o.symbol ?? "-";
  return {
    uuid: o.uuid,
    engine_id: o.engine_id,
    price: String(o.price ?? 0),
    amount: String(o.amount ?? 0),
    side: o.side,
    marketKey: o.symbol,
    timestamp: o.timestamp,
    type: "SPOT",
    state: "OPEN",
    action: o.side,
    marketName,
    props: {
      amount: String(o.amount ?? 0),
      price: String(o.price ?? 0),
    },
  };
}

private normalizeHist(e: any) {
  const qty = e.qty ?? e.quantity ?? e.resting_qty ?? 0;
  const price = e.price ?? 0;
  return {
    uuid: e.uuid,
    marketKey: e.symbol,
    side: e.side,
    timestamp: e.ts ?? e.timestamp,
    action: e.side,
    state: e.event,
    props: {
      amount: String(qty),
      price: String(price),
    },
    type: "SPOT",
  };
}


    get openedOrders() {
      return this.spotOrdersService.openedOrders;
    }

    closeOrder(uuid: string) {
      this.spotOrdersService.closeOpenedOrder(uuid);
    }

    ngOnInit() {
      this.subsribe();
    }

    private subsribe() {
  // placed-orders → normalize & feed the service
  this.socketSubscriptions.push(
    this.socketService.events$
      .pipe(filter(({ event }) => event === 'placed-orders'))
      .subscribe(({ data }: any) => {
        const openedRaw: any[] = Array.isArray(data?.openedOrders) ? data.openedOrders : [];
        const histRaw: any[] =
          Array.isArray(data?.orderHistory)
            ? data.orderHistory
            : (typeof data?.orderHistory === 'string'
                ? JSON.parse(data.orderHistory)
                : []);

        const openedSpot = openedRaw.map((o: any) => this.normalizeOrder(o));
        const historySpot = histRaw.map((e: any) => this.normalizeHist(e));

        // If your table expects legacy SPOT rows:
        this.spotOrdersService.openedOrders = (openedSpot as any);
        this.spotOrdersService.orderHistory = historySpot;
      })
  );

  // disconnect → clear
  this.socketSubscriptions.push(
    this.socketService.events$
      .pipe(filter(({ event }) => event === 'disconnect'))
      .subscribe(() => {
        this.spotOrdersService.openedOrders = [];
      })
  );

  // react to address changes
  const subs = this.authService.updateAddressesSubs$.subscribe((kp: any) => {
    if (!this.authService.activeSpotKey || !kp?.length) {
      this.spotOrdersService.closeAllOrders();
    }
  });
  this.subsArray.push(subs);
}

    ngOnDestroy(): void {
      this.subsArray.forEach(s => s.unsubscribe());
    }
}
