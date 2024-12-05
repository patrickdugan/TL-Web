import { Component } from '@angular/core';

@Component({
  selector: 'tl-home-page',
  templateUrl: './home-page.component.html',
  styleUrls: ['./home-page.component.scss']
})
export class HomePageComponent {
    connectWallet() {
    window.postMessage({ type: 'CONNECT_WALLET' }, '*');
	}

}
