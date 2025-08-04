import { Injectable } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { Subject } from 'rxjs';
import { SwapService } from './swap.service';
import { ESounds, SoundsService } from "./sound.service";
import { LoadingService } from "./loading.service";
import { io, Socket } from 'socket.io-client';

@Injectable({
  providedIn: 'root',
})
export class SocketService {
  public ws: WebSocket | null = null;
  public obSocket: Socket | null = null;
  private wsConnected = false;
  private clientId = '';
  private eventSubject = new Subject<{ event: string; data: any }>();

  constructor(
    private toasterService: ToastrService,
    private swapService: SwapService,
    private soundsService: SoundsService,
    private loadingService: LoadingService
  ) {}

  // Setup bridge from Socket.IO to WebSocket
  private setupWalletBridge() {
    if (!this.obSocket || (this.obSocket as any)._obBridgeInstalled) return;
    (this.obSocket as any)._obBridgeInstalled = true;

    // List of events to forward
    ['update-orderbook', 'new-order', 'close-order', 'many-orders'].forEach(ev => {
      this.obSocket!.on(ev, (data: any) => {
        this.emit(ev, data); // Pipe to WebSocket server
      });
    });

    // Pass new‑channel events upstream (if needed)
    this.obSocket!.on('OB_SOCKET::new-channel', (data: any) => {
      this.emit('new-channel', data);
    });

    // Forward any swap event
    this.obSocket!.onAny((event: string, data: any) => {
      if (event.endsWith('::swap')) {
        this.emit(event, data);
      }
    });
  }

  // Actually send to server (WebSocket)
  private emit(event: string, payload: any = {}) {
    console.log('[SocketService.emit] called:', {event, payload, ws: this.ws, ready: this.ws?.readyState});
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, ...payload }));
    }
  }

  public obSocketConnect(url: string): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('WebSocket is already connected or connecting.');
      return;
    }
    this.ws = new WebSocket(url);
     this.setupWalletBridge();

    this.ws.onopen = () => {
      this.wsConnected = true;
      this.toasterService.success('OB Socket Connected', 'Socket');
      console.log('OB WebSocket connected');
      // Setup wallet bridge after connect (if you use obSocket)
      // this.setupWalletBridge(); // Uncomment if needed
    };

    this.ws.onclose = (event) => {
      this.wsConnected = false;
      this.toasterService.error('Socket Disconnected', 'Socket');
      console.error('OB WebSocket disconnected:', event.reason);
    };

    this.ws.onerror = (err) => {
      this.wsConnected = false;
      this.toasterService.error('Socket Connection Error', 'Socket');
      console.error('OB WebSocket connection error:', err);
    };

    this.ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        const eventName = data.event || data.type || 'unknown';
        
        if (eventName === 'connected' && data.id) {
          this.clientId = data.id; // Assign to a property on the class
          console.log('[OB WS] Assigned client id:', data.id);
        }

        if (eventName === 'new-channel') {
          this.swapService.onInit(data, this.ws as any); // You may adapt this as needed!
        }

        // Optionally relay to socket.io if needed
        this.obSocket?.emit(eventName, data);

        // Notify any subscribers
        this.emitEvent(eventName, data);
      } catch (e) {
        console.error('WebSocket message parse error:', e, msg.data);
      }
    };
  }

  public obSocketDisconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'client-close');
      this.ws = null;
      this.wsConnected = false;
    }
  }

  private emitEvent(event: string, data: any): void {
    this.eventSubject.next({ event, data });
  }

  get events$() {
    return this.eventSubject.asObservable();
  }

  public send(event: string, data: any): void {
    if (!this.ws || !this.wsConnected || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket is not connected; cannot send message');
      return;
    }
    const msg = JSON.stringify({ event, ...data });
    this.ws.send(msg);
  }

  get obSocketConnected(): boolean {
    return this.wsConnected;
  }
}
