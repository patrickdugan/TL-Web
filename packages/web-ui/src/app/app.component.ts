import { Component, NgZone } from '@angular/core';
import { ConnectionService } from './@core/services/connections.service';
import { LoadingService } from './@core/services/loading.service';
import { RpcService } from './@core/services/rpc.service';
import { SocketService } from './@core/services/socket.service';

@Component({
  selector: 'tl-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  private isOnline: boolean = this.connectionService.isOnline;

  constructor(
    private rpcService: RpcService,
    private connectionService: ConnectionService,
    private ngZone: NgZone,
    private loadingService: LoadingService,
    private socketService: SocketService,
  ) {
    this.handleInits();
    this.handleConnections();
  }

  get isLoading() {
    return this.loadingService.isLoading;
  }

  set isLoading(value: boolean) {
    this.loadingService.isLoading = value;
  }

  get isCoreStarted() {
    return this.rpcService.isCoreStarted;
  }

  get isNetworkSelected() {
    return this.rpcService.isNetworkSelected;
  }

  get allConnected() {
    return this.isOnline && this.connectionService.isMainSocketConnected;
  }

  handleInits() {
    this.connectionService.onInit();
    this.rpcService.onInit();
  }

  handleConnections() {
    this.connectionService.isOnline$
      .subscribe((isOnline) => {
        this.ngZone.run(() => this.isOnline = isOnline);
      });
  }
}
