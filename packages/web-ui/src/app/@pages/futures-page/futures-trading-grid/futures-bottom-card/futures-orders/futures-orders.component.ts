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

    // ---- FUTURES symbol helpers ----

// returns true for "3", "3-perp", "BTC-USD-PERP", "ES-DEC25", etc.
private isFuturesSymbol(sym?: string): boolean {
  if (!sym) return false;
  const s = String(sym).trim();
  if (!s) return false;
  if (/^\d+$/u.test(s)) return true;                    // bare numeric (e.g., "3")
  if (/-perp\b/i.test(s)) return true;                   // "-perp" anywhere (case-insens.)
  if (/-fut(?:ure|ures)?\b/i.test(s)) return true;       // "-fut/-future/-futures"
  if (/(?:^|-)C(?:-|$)/i.test(s) || /(?:^|-)P(?:-|$)/i.test(s)) return true; // options tags
  if ((s.match(/-/g) || []).length >= 2) return true;    // complex futures codes with 2+ dashes
  return false;
}

// normalize a display key: strip terminal futures/options suffixes
private normalizeFuturesSymbol(sym?: string): string {
  if (!sym) return '-';
  let s = String(sym).trim();

  // Strip common futures tags at the *end* only
  s = s.replace(/-perp\b/i, '');               // remove "-perp"
  s = s.replace(/-fut(?:ure|ures)?\b/i, '');   // remove "-fut/-future/-futures"

  // Strip simple option tags at the end: "-P" or "-C" (case-insensitive)
  s = s.replace(/-(?:p|c)\b/i, '');

  // If you also receive forms like "ES-4500P" or "BTC-30JUN25-C":
  // remove trailing "-<strike><P|C>" or "-<P|C>-<expiry>", but only the option bit:
  s = s.replace(/-(\d+(?:\.\d+)?)?(?:p|c)\b/i, '');      // "...-4500P" → "...-4500"
  s = s.replace(/-(?:p|c)-[A-Za-z0-9]+$/i, '');          // "...-P-30JUN25" → "..."
  return s || '-';
}

private normalizeFutOpen(o: any) {
  const marketName = this.normalizeFuturesSymbol(o.symbol ?? o.marketName);
  return {
    uuid:       o.uuid,
    engine_id:  o.engine_id,
    price:      String(o.price ?? 0),
    amount:     String(o.amount ?? 0),
    side:       o.side,
    marketKey:  o.symbol,          // keep raw key if other parts rely on it
    timestamp:  o.timestamp,
    type:       'FUTURES',
    state:      'OPEN',
    action:     o.side,
    marketName,                     // table-friendly, suffixes stripped
    props: {
      amount: String(o.amount ?? 0),
      price:  String(o.price ?? 0),
    },
  };
}

private normalizeFutHist(e: any) {
  const qty   = e.qty ?? e.quantity ?? e.resting_qty ?? 0;
  const price = e.price ?? 0;
  return {
    uuid:       e.uuid,
    marketKey:  e.symbol,          // raw symbol
    side:       e.side,
    timestamp:  e.ts ?? e.timestamp,
    action:     e.side,
    state:      e.event,
    type:       'FUTURES',
    props: {
      amount: String(qty),
      price:  String(price),
    },
    // If your history table shows market, pipe the normalized one in the template:
    // {{ normalizeFuturesSymbol(element.marketKey) }}
  };
}


     private subscribe() {
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

        // FUTURES only
        const openedFut  = openedRaw
          .filter((o: any) => this.isFuturesSymbol(o.symbol))
          .map((o: any) => this.normalizeFutOpen(o));

        const historyFut = histRaw
          .filter((e: any) => this.isFuturesSymbol(e.symbol))
          .map((e: any) => this.normalizeFutHist(e));

        this.futuresOrdersService.openedOrders = (openedFut as any);
        this.futuresOrdersService.orderHistory = historyFut;
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
