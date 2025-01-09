import { Injectable } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { Subject } from 'rxjs';
import {SwapService} from './swap.service'

/** Same prefix from your original code. */
export const obEventPrefix = 'OB_SOCKET';

// Custom or extra event names, if you need them.
export enum SocketEmits {
  LTC_INSTANT_TRADE = 'LTC_INSTANT_TRADE',
  TOKEN_TOKEN_TRADE = 'TOKEN_TOKEN_TRADE',
}

@Injectable({
  providedIn: 'root',
})
export class SocketService {
  /**
   * The underlying single socket instance that both `this._socket` and 
   * `this._obServerSocket` point to. This is our "universal" connection.
   */
  private _universalSocket: Socket | null = null;
  private swapService: SwapService
  get universalSocket(): Socket | null {
    return this._universalSocket;
}


  /** 
   * We keep references so the rest of your code compiles:
   * - `_socket` is used by `get socket()`, `mainSocketConnect()`, etc.
   * - `_obServerSocket` is used by `obSocket`, `obSocketConnect()`, etc.
   * But behind the scenes, they are the same socket object.
   */
  private _socket: Socket | null = null;
  private _obServerSocket: Socket | null = null;

  /** 
   * Emulate separate loading flags if your code references them. 
   * But they’ll be toggled in a unified way. 
   */
  private mainSocketWaiting: boolean = false;
  private obServerWaiting: boolean = false;

  /** 
   * If your code references `obSocketConnected`, keep it. 
   * We'll just reflect the same `._universalSocket` state here.
   */
  private _obSocketConnected: boolean = false;

  /** 
   * RxJS Subject to broadcast incoming server events. 
   */
  private eventSubject = new Subject<{ event: string; data: any }>();

  constructor(private toasterService: ToastrService) {}

  // ----------------------------
  //  Getters for old references
  // ----------------------------

  /**
   * (Legacy) Combined loading state if your code references `socketsLoading`.
   */
  get socketsLoading(): boolean {
    return this.mainSocketWaiting || this.obServerWaiting;
  }

  /**
   * (Legacy) If your code checks `this.socketService.obSocketConnected`.
   */
  get obSocketConnected(): boolean {
    return this._obSocketConnected;
  }

  /**
   * (Legacy) If your code uses `this.socket` directly.
   */
  get socket(): Socket | null {
    if (!this._socket) {
      // If never connected before, auto-init main socket
      this.mainSocketConnect();
    }
    return this._socket;
  }

  /**
   * (Legacy) If your code uses `this.obSocket` directly.
   */
  get obSocket(): Socket | null {
    return this._obServerSocket;
  }

  // ----------------------------
  //  Legacy "connect" methods
  // ----------------------------

  /**
   * (Legacy) mainSocketConnect() used by older code
   */
  public mainSocketConnect(): Socket | null {
    if (this._universalSocket) {
      // Already connected
      return this._universalSocket;
    }

    this.mainSocketWaiting = true;

    console.log('Connecting main socket to', environment.homeApiUrl);
    // Create the underlying single socket
    this._universalSocket = io(environment.homeApiUrl, {
      reconnection: false,
      secure: true, // If you want wss
    });

    // Assign it to both references
    this._socket = this._universalSocket;
    this._obServerSocket = this._universalSocket;

    // Set up event handlers
    this._universalSocket.on('connect', () => {
      this.mainSocketWaiting = false;
      this.obServerWaiting = false;
      this._obSocketConnected = true;

      console.log('Main socket connected, ID:', this._universalSocket?.id);
      this.toasterService.success('Main Socket Connected', 'Socket');

      // Now register the "orderbook" event handlers or any other 
      // events that your code expects from the obSocket side.
      this.handleUniversalSocketEvents();
    });

    this._universalSocket.on('disconnect', (reason) => {
      this.mainSocketWaiting = false;
      this.obServerWaiting = false;
      this._obSocketConnected = false;

      console.error('Main socket disconnected:', reason);
      this.toasterService.error('Socket Disconnected', 'Socket');
    });

    this._universalSocket.on('connect_error', (err) => {
      this.mainSocketWaiting = false;
      this.obServerWaiting = false;
      this._obSocketConnected = false;

      console.error('Main socket connection error:', err);
      this.toasterService.error('Socket Connection Error', 'Socket');
    });

    return this._universalSocket;
  }

  /**
   * (Legacy) If your code calls obSocketConnect(), we will 
   * basically do the same routine as mainSocketConnect, 
   * because we only want one socket anyway.
   */
  public obSocketConnect(url: string): void {
    if (this._universalSocket) {
      // Already connected to something.
      console.log('obSocketConnect called but we already have a universal socket.');
      return;
    }
    this.obServerWaiting = true;

    console.log('Connecting obSocket to', url);
    this._universalSocket = io(url, {
      reconnection: false,
      path: '/socket.io/', // This path must match Nginx's WebSocket path
      transports: ['websocket'],
      secure: true,
    });

    // Assign to both references
    this._socket = this._universalSocket;
    this._obServerSocket = this._universalSocket;

    // Setup the same handlers
    this._universalSocket.on('connect', () => {
      this.obServerWaiting = false;
      this.mainSocketWaiting = false;
      this._obSocketConnected = true;

      console.log('OB socket connected, ID:', this._universalSocket?.id);
      this.toasterService.success('OB Socket Connected', 'Socket');

    this.swapService.onInit();

      // register the “orderbook” event handling or others
      this.handleUniversalSocketEvents();
    });

    this._universalSocket.on('disconnect', (reason) => {
      this.obServerWaiting = false;
      this.mainSocketWaiting = false;
      this._obSocketConnected = false;

      console.error('OB socket disconnected:', reason);
      this.toasterService.error('Socket Disconnected', 'Socket');
    });

    this._universalSocket.on('connect_error', (err) => {
      this.obServerWaiting = false;
      this.mainSocketWaiting = false;
      this._obSocketConnected = false;

      console.error('OB socket connection error:', err);
      this.toasterService.error('Socket Connection Error', 'Socket');
    });
  }

  // ----------------------------
  //  Unified event handling
  // ----------------------------

  /**
   * Once connected (either as main or OB socket), set up 
   * all server event listeners in one place. 
   */
  private handleUniversalSocketEvents(): void {
    const events = [
      'order:error',
      'order:saved',
      'placed-orders',
      'orderbook-data',
      'update-orders-request',
      'new-channel',
      // any other events your server emits
    ];

    events.forEach((eventName) => {
      this._universalSocket?.on(eventName, (data: any) => {
        // Forward everything to an RxJS Subject so you can pick it up 
        // in your components the same way as you previously did
        const fullEventName = `${eventName}`;
         const cpSocketId = data.isBuyer ? data.tradeInfo.seller.socketId : data.tradeInfo.buyer.socketId;
        //console.log('inside socket service '+fullEventName+' '+JSON.stringify(data.socketId))
        if(eventName=="new-channel"){console.log('new channel with socket '+cpSocketId)}

        this.emitEvent(fullEventName, data);
      });
    });
  }

  // ----------------------------
  //  Legacy disconnect
  // ----------------------------
  /**
   * (Legacy) If your code calls obSocketDisconnect
   */
  public obSocketDisconnect(): void {
    if (this._obServerSocket) {
      console.log('Disconnecting OB socket');
      this._obServerSocket.disconnect();
      this._obServerSocket = null;
      this._socket = null;
      this._universalSocket = null;
    }
    this._obSocketConnected = false;
  }

  /**
   * (Legacy) If your code calls this just `disconnect()`
   */
  public disconnect(): void {
    if (this._socket) {
      console.log('Disconnecting main socket');
      this._socket.disconnect();
      this._socket = null;
      this._obServerSocket = null;
      this._universalSocket = null;
    }
    this._obSocketConnected = false;
  }

  // ----------------------------
  //  Emitting events to the server
  // ----------------------------

  /**
   * (Legacy) If your code calls socketService.send(...)
   * to send an event over the "main socket".
   */
  public send(event: string, data: any): void {
    if (!this._universalSocket || this._universalSocket.disconnected) {
      console.error('Socket is not connected; cannot send message');
      return;
    }
    this._universalSocket.emit(event, data);
  }

  /**
   * If your code specifically uses:
   *   this.socketService.obSocket?.emit(...)
   * or 
   *   this.socketService.socket?.emit(...)
   * 
   * That still works because .emit() is the same underlying _universalSocket.
   * No extra bridging needed—both are the same reference.
   */

  // ----------------------------
  //  RxJS Subject for listening to events
  // ----------------------------
  private emitEvent(event: string, data: any): void {
    this.eventSubject.next({ event, data });
  }

  /**
   * If your code already uses `this.socketService.events$` 
   * or something similar, keep the same name.
   */
  get events$() {
    return this.eventSubject.asObservable();
  }
}
