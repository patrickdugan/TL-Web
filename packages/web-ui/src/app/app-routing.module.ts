import { NgModule } from '@angular/core';
import { RouterModule,Router, Routes, NavigationEnd } from '@angular/router';
import { AuthGuard } from './@core/guards/auth.guard';
import { RPCGuard } from './@core/guards/rpc.guard';
import { SyncedGuard } from './@core/guards/sync.guard';
import { FuturesPageComponent } from './@pages/futures-page/futures-page.component';

import { HomePageComponent } from './@pages/home-page/home-page.component';
import { LoginPageComponent } from './@pages/login-page/login-page.component';
import { PortfolioPageComponent } from './@pages/portfolio-page/portfolio-page.component';
import { SpotPageComponent } from './@pages/spot-page/spot-page.component';
import { TxBuilderPageComponent } from './@pages/tx-builder-page/tx-builder-page.component';

declare const gtag: Function; // Declare gtag globally

export const routes: Routes = [
  {
    path: '',
    component: FuturesPageComponent,
    canActivate: [RPCGuard]
  },
  {
    path: 'spot',
    component: SpotPageComponent,
    canActivate: [RPCGuard]
  },
  {
    path: 'portfolio',
    component: PortfolioPageComponent,
    canActivate: [RPCGuard]
  }
];



  @NgModule({
    imports: [RouterModule.forRoot(routes)], // Ensure `RouterModule` is properly imported
    exports: [RouterModule],
  })
  export class AppRoutingModule {
    constructor(private router: Router) {
      // Listen for router events
      this.router.events.subscribe((event: any) => {
        if (event instanceof NavigationEnd) {
          gtag('config', 'G-EFYGCSNN2S', {
            page_path: event.urlAfterRedirects,
          });
          console.log('Tracked page view for:', event.urlAfterRedirects);
        }
      });
    }
}