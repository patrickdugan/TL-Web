import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
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
    canActivate: [RPCGuard],
    children: [
      {
        path: '',
        component: HomePageComponent,
      },
       {
         path: 'login',
         component: LoginPageComponent,
       },
      {
         path: 'tx-builder',
         component: TxBuilderPageComponent,
       },
      {
        path: 'portfolio',
        component: PortfolioPageComponent,
        canActivate: [],
      },
      {
        path: 'spot',
        component: SpotPageComponent,
        canActivate: [],
      },
       {
         path: 'futures',
         component: FuturesPageComponent,
         canActivate: [],
       },
      // {
      //   path: 'node-reward',
      //   component: NodeRewardPageComponent,
      //   canActivate: [SyncedGuard],
      // },
      {
        path: '**',
        component: HomePageComponent,
      },
    ],
  },
];

const imports = [ RouterModule.forRoot(routes) ];
const exports = [ RouterModule ];

@NgModule({ imports, exports })
  export class AppRoutingModule {
    constructor(private router: Router) {
      // Listen for navigation events
      this.router.events.subscribe((event) => {
        if (event instanceof NavigationEnd) {
          // Send page_view event to Google Analytics
          gtag('config', 'G-EFYGCSNN2S', {
            page_path: event.urlAfterRedirects,
          });
          console.log('Tracked page view for:', event.urlAfterRedirects);
        }
      });
    } 
}
