import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { SpotMarketsService } from 'src/app/@core/services/spot-services/spot-markets.service';
import { SpotOrderbookService } from 'src/app/@core/services/spot-services/spot-orderbook.service';
import { SpotOrdersService } from 'src/app/@core/services/spot-services/spot-orders.service';


export interface PeriodicElement {
  price: number;
  amount: number;
}

@Component({
  selector: 'tl-spot-orderbook-card',
  templateUrl: './orderbook-card.component.html',
  styleUrls: ['./orderbook-card.component.scss']
})

export class SpotOrderbookCardComponent implements OnInit, OnDestroy {
    @ViewChild('sellOrdersContainer') sellOrdersContainer: any;

    displayedColumns: string[] = ['price', 'amount', 'total'];
    clickedRows = new Set<PeriodicElement>();
    constructor(
      private spotOrderbookService: SpotOrderbookService,
      private spotOrdersService: SpotOrdersService,
      private spotMarketsService: SpotMarketsService,
    ) {}

    get upTrend() {
      return this.lastPrice > this.marketPrice;
    }

    get lastPrice() {
      return this.spotOrderbookService.lastPrice;
    }

    get marketPrice() {
      return this.spotOrderbookService.currentPrice;
    }

    get openedOrders() {
      return this.spotOrdersService.openedOrders;
    }

    get openedBuyOrders() {
      return this.openedOrders.filter(p => {
        const isBuy = p.action === "BUY";
        const matchPropDesired = p.props.id_desired === this.selectedMarket.first_token.propertyId;
        const matchPropForSale = p.props.id_for_sale === this.selectedMarket.second_token.propertyId;
        return isBuy && matchPropDesired && matchPropForSale;
      });
    }

    get openedSellOrders() {
      return this.openedOrders.filter(p => {
        const isSell = p.action === "SELL";
        const matchPropDesired = p.props.id_desired === this.selectedMarket.second_token.propertyId;
        const matchPropForSale = p.props.id_for_sale === this.selectedMarket.first_token.propertyId;
        return isSell && matchPropDesired && matchPropForSale;
      });
    }

    get buyOrderbooks() {
      return this.spotOrderbookService.buyOrderbooks;
    }

    get sellOrderbooks() {
      this.scrollToBottom();
      return this.spotOrderbookService.sellOrderbooks;
    }

    get selectedMarket() {
      return this.spotMarketsService.selectedMarket;
    }
  
    ngOnInit() {
      this.spotOrderbookService.subscribeForOrderbook();
    }

    scrollToBottom() {
      if (this.sellOrdersContainer?.nativeElement) {
        this.sellOrdersContainer.nativeElement.scrollTop = this.sellOrdersContainer.nativeElement.scrollHeight;
      }
    }

    ngOnDestroy() {
      this.spotOrderbookService.endOrderbookSubscription()
    }

    fillBuySellPrice(price: number) {
      if (price) this.spotOrderbookService.outsidePriceHandler.next(price);
    }

    // haveOpenedOrdersOnThisPrice(isBuy: boolean, price: number) {
    //   const positions = isBuy
    //     ? this.openedBuyOrders
    //     : this.openedSellOrders;
    //   return positions.map(e => e.props.price).some(e => e >= price && (e < price + 0.01));
    // }
}
