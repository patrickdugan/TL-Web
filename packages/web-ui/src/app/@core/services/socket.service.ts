import { Injectable } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { Subject } from 'rxjs';
import { SwapService } from './swap.service';
import { ESounds, SoundsService } from "./sound.service";
import { LoadingService } from "./loading.service";
import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';

export class SocketService {
  private ws: WebSocket | null = null;
  public obSocket: Socket | null = null;
  private wsConnected = false;
  private clientId = ''
  private eventSubject = new Subject<{ event: string; data: any }>();

  constructor(
    private toasterService: ToastrService,
    private swapService: SwapService,
    private soundsService: SoundsService,
    private loadingService: LoadingService
  ) {}

  // inside your SocketService class

  private setupWalletBridge() {
    if (!this.obSocket || (this.obSocket as any)._obBridgeInstalled) return;
    (this.obSocket as any)._obBridgeInstalled = true;

    // List of events to forward
    ['update-orderbook', 'new-order', 'close-order', 'many-orders'].forEach(ev => {
      this.obSocket.on(ev, (data: any) => {
        this.emitToServer(ev, data); // Pipe to WebSocket server
      });
    });

    // Pass new‑channel events upstream (if needed)
    this.obSocket.on('OB_SOCKET::new-channel', (data: any) => {
      this.emitToServer('new-channel', data);
    });

    // Forward any swap event
    this.obSocket.onAny((event: string, data: any) => {
      if (event.endsWith('::swap')) {
        this.emitToServer(event, data);
      }
    });
  }

  // Actually send to server (WS, or adapt for raw ws)
  private emitToServer(event: string, payload: any = {}) {
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

    this.ws.onopen = () => {
      this.wsConnected = true;
      this.toasterService.success('OB Socket Connected', 'Socket');
      console.log('OB WebSocket connected');
      // (re)register events if needed
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
         
        if (eventName === 'connected' && data.id) {
            this.clientId = data.id; // Assign to a property on the class
            console.log('[OB WS] Assigned client id:', data.id);
        }

        if (eventName === 'new-channel') {
          this.swapService.onInit(data, this.ws);
        }

        this.obSocket?.emit(eventName, data);
        this.emitEvent(eventName, data);
        // Optional: play sound, handle loading, etc.
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
