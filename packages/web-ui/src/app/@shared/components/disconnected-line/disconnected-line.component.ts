import { Component, Input, ViewChild } from '@angular/core';
import { ConnectionService } from 'src/app/@core/services/connections.service';
import { SocketService } from 'src/app/@core/services/socket.service';
import { RpcService } from 'src/app/@core/services/rpc.service';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'tl-disconnected-line',
  templateUrl: './disconnected-line.component.html',
  styleUrls: ['./disconnected-line.component.scss']
})
export class DisconnectedLineComponent {
  constructor(
      private connectionService: ConnectionService,
      private socketService: SocketService,
      private rpcService: RpcService,
  ) { }

  get isOnlineConnected() {
    return this.connectionService.isOnline;
  }

  get isMainSocketConnected() {
    return this.connectionService.isMainSocketConnected;
  }

  mainSocketReconenct() {
    const network = this.rpcService.NETWORK || 'BTC';
    const endpoint = environment.ENDPOINTS[network] || environment.ENDPOINTS.BTC;
    this.socketService.obSocketConnect(endpoint.orderbookApiUrl);
  }
}
