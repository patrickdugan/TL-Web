import { Injectable } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { Subject } from 'rxjs';
//import { SwapService } from './swap.service';
import { ESounds, SoundsService } from "./sound.service";
import { LoadingService } from "./loading.service";

@Injectable({
  providedIn: 'root',
})
export class SocketService {
  public ws: WebSocket | null = null;
  private wsConnected = false;
  private clientId = '';
  private eventSubject = new Subject<{ event: string; data: any }>();

  constructor(
    private toasterService: ToastrService,
    //private swapService: SwapService,
    private soundsService: SoundsService,
    private loadingService: LoadingService
  ) {}

  /**
   * Connects to the backend WebSocket, if used.
   * For in-app events only, call emitEvent instead.
   */
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
        console.log('incoming websocket '+JSON.stringify(msg))
        if (eventName === 'connected' && data.id) {
          this.clientId = data.id;
          console.log('[OB WS] Assigned client id:', data.id);
        }

             // Emit event for in-app subscribers
        this.emitEvent(eventName, data);

        if (eventName === 'new-channel') {
          console.log("[Caller] About to call onInit, this.events$ =", this.events$);
          //this.swapService.onInit(data.data, this.events$);
        }

   
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

  /** Emits an event to in-app subscribers (no networking) */
  public emitEvent(event: string, data: any): void {
    console.log('event emitter '+event +' '+JSON.stringify(data))
    this.eventSubject.next({ event, data });
  }

  /** Observable for event subscription */
  get events$() {
    return this.eventSubject.asObservable();
  }

  /** Send a message over the backend WebSocket, if still needed */
    public send(event: string, data: any): void {
      if (!this.ws || !this.wsConnected || this.ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket is not connected; cannot send message');
        return;
      }

      // Events that expect flattened payloads
      const flatEvents = ['new-order', 'close-order','::swap'];

    const isFlat = flatEvents.some(e => event.endsWith(e))
    const msg = isFlat 
        ? JSON.stringify({ event, ...data })      // flattened
        : JSON.stringify({ event, data });        // nested

      console.log('[SocketService.send] sending:', msg);
      this.ws.send(msg);
    }


  get obSocketConnected(): boolean {
    return this.wsConnected;
  }
}
