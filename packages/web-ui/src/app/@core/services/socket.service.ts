import { Injectable } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { Subject } from 'rxjs';
import { SwapService } from './swap.service';

@Injectable({
  providedIn: 'root',
})
export class SocketService {
  private _obSocket: Socket | null = null;
  private _obSocketConnected: boolean = false;

  private eventSubject = new Subject<{ event: string; data: any }>();

  constructor(
    private toasterService: ToastrService,
    private swapService: SwapService
  ) {}

  // ----------------------------
  //  Socket Connection Methods
  // ----------------------------

  public obSocketConnect(url: string): void {
    if (this._obSocket?.connected) {
      console.log('obSocket is already connected.');
      return;
    }

    console.log('Connecting obSocket to', url);
    this._obSocket = io(url, {
      reconnection: true, // Allow automatic reconnection
      transports: ['websocket'], // Use WebSocket transport
      secure: true, // Use secure connection if needed
    });

    this._obSocket.on('connect', () => {
      this._obSocketConnected = true;
    if (this._obSocket && this._obSocket.id) {
            console.log('OB socket connected:', this._obSocket.id);
        } else {
            console.warn('OB socket is null or does not have an ID.');
        }

      this.toasterService.success('OB Socket Connected', 'Socket');

      // Initialize SwapService after socket connection
      this.swapService.onInit();

      // Register event listeners
      this.handleObSocketEvents();
    });

    this._obSocket.on('disconnect', (reason) => {
      this._obSocketConnected = false;
      console.error('OB socket disconnected:', reason);
      this.toasterService.error('Socket Disconnected', 'Socket');
    });

    this._obSocket.on('connect_error', (err) => {
      this._obSocketConnected = false;
      console.error('OB socket connection error:', err);
      this.toasterService.error('Socket Connection Error', 'Socket');
    });
  }

  public obSocketDisconnect(): void {
    if (this._obSocket) {
      console.log('Disconnecting obSocket');
      this._obSocket.disconnect();
      this._obSocket = null;
      this._obSocketConnected = false;
    }
  }

  // ----------------------------
  //  Event Handling
  // ----------------------------

  private handleObSocketEvents(): void {
    const events = [
      'order:error',
      'order:saved',
      'placed-orders',
      'orderbook-data',
      'update-orders-request',
      'new-channel',
    ];

    events.forEach((eventName) => {
      this._obSocket?.on(eventName, (data: any) => {
        console.log(`Event received: ${eventName}`, data);

        // Emit the event via RxJS Subject
        this.emitEvent(eventName, data);
      });
    });
  }

  private emitEvent(event: string, data: any): void {
    this.eventSubject.next({ event, data });
  }

  get events$() {
    return this.eventSubject.asObservable();
  }

  // ----------------------------
  //  Socket Interaction Methods
  // ----------------------------

  public send(event: string, data: any): void {
    if (!this._obSocket || !this._obSocketConnected) {
      console.error('Socket is not connected; cannot send message');
      return;
    }
    this._obSocket.emit(event, data);
  }

  get obSocket(): Socket | null {
    return this._obSocket;
  }

  get obSocketConnected(): boolean {
    return this._obSocketConnected;
  }
}
