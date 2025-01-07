import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { io, Socket } from "socket.io-client";
import { environment } from '../../../environments/environment';
import { Subject } from "rxjs";

export enum SocketEmits {
    LTC_INSTANT_TRADE = 'LTC_INSTANT_TRADE',
    TOKEN_TOKEN_TRADE = 'TOKEN_TOKEN_TRADE',
}
export const obEventPrefix = 'OB_SOCKET';

@Injectable({
    providedIn: 'root',
})
export class SocketService {
    private _socket: Socket | null = null;
    private _obServerSocket: Socket | null = null;

    private _obSocketConnected: boolean = false;
    private mainSocketWaiting: boolean = false;
    private obServerWaiting: boolean = false;

    // Event Subject to emit and subscribe to WebSocket events
    private eventSubject = new Subject<{ event: string; data: any }>();

    constructor(private toasterService: ToastrService) {}

    // Expose combined socket loading states
    get socketsLoading() {
        return this.mainSocketWaiting || this.obServerWaiting;
    }

    private get mainSocketUrl(): string {
        return environment.homeApiUrl;
    }

    // Get the connection status of the orderbook socket
    get obSocketConnected() {
        return this._obSocketConnected;
    }

    get obSocket(): Socket | null {
        return this._obServerSocket;
    }

    // Getter for the main socket, initializing if necessary
    get socket() {
        if (!this._socket) return this.mainSocketConnect();
        return this._socket;
    }

    // Initialize the main socket connection
    mainSocketConnect() {
        this.mainSocketWaiting = true;
        this._socket = io(this.mainSocketUrl, { reconnection: false });

        // Handle connection lifecycle events
        this.socket.on('connect', () => {
            this.mainSocketWaiting = false;
            console.log('Main socket connected');
        });

        this.socket.on('disconnect', () => {
            this.mainSocketWaiting = false;
            console.error('Main socket disconnected');
        });

        this.socket.on('connect_error', () => {
            this.mainSocketWaiting = false;
            console.error('Main socket connection error');
        });

        // // Integrate OB socket events into the same service
        // this.handleMainOBSocketEvents();
        // this.handleOBSocketData();

        return this._socket;
    }

    // Initiate a connection to the orderbook service (OB socket)
    obSocketConnect(url: string) {
        this.obServerWaiting = true;
        this._obServerSocket = io(url, {
            reconnection: false,
            secure: true, // Enforce secure connection
        });



        this.obSocket?.on('connect', () => {
            this.obServerWaiting = false;
            this._obSocketConnected = true;
            console.log('OB socket connected');
            this.handleOBSocketData();
        });

        this.obSocket?.on('disconnect', () => {
            this.obServerWaiting = false;
            console.error('OB socket disconnected');
        });

        this.obSocket?.on('connect_error', () => {
            this.obServerWaiting = false;
            console.error('OB socket connection error');
        });
    }

    // Disconnect from the orderbook service
    obSocketDisconnect() {
        if (!this.obSocket) return;
        this.obSocket.disconnect();
        this._obSocketConnected = false;
        this._obServerSocket = null;
    }

    // Handle main OB socket connection lifecycle
    // private handleMainOBSocketEvents() {
    //     this.socket.on(`${obEventPrefix}::connect`, () => {
    //         this._obSocketConnected = true;
    //         this.obServerWaiting = false;
    //         console.log('Orderbook socket connected');
    //     });

    //     this.socket.on(`${obEventPrefix}::connect_error`, () => {
    //         this._obSocketConnected = false;
    //         this.obServerWaiting = false;
    //         this.toasterService.error('Orderbook Connection Error, Host is probably down', 'Error');
    //     });

    //     this.socket.on(`${obEventPrefix}::disconnect`, () => {
    //         this._obSocketConnected = false;
    //         this.obServerWaiting = false;
    //         this.toasterService.error('Orderbook Disconnected', 'Error');
    //     });
    // }

    // Handle OB socket-specific events and data flow
    private handleOBSocketData() {
        const orderEvents = [
            'order:error',
            'order:saved',
            'placed-orders',
            'orderbook-data',
            'update-orders-request',
            'new-channel',
        ];

        // Forward OB server events to the wallet
        
        orderEvents.forEach((eventName) => {
            this.obSocket?.on(eventName, (data: any) => {
                const fullEventName = `${obEventPrefix}::${eventName}`;
                this.emitEvent(fullEventName, data);
            });
        });

        // Forward wallet events to the OB server
        ["update-orderbook", "new-order", "close-order", 'many-orders'].forEach((eventName) => {
            this.obSocket?.on(eventName, (data: any) => {
                this.obSocket?.emit(eventName, data);
            });
        });

        // Handle swap events dynamically based on socket ID
        const swapEventName = 'swap';
        this.obSocket?.on('new-channel', (d: any) => {
            const cpSocketId = d.isBuyer ? d.tradeInfo.seller.socketId : d.tradeInfo.buyer.socketId;
            this.obSocket?.removeAllListeners(`${cpSocketId}::${swapEventName}`);
            this.obSocket?.on(`${cpSocketId}::${swapEventName}`, (data: any) => {
                this.emitEvent(`${cpSocketId}::${swapEventName}`, data);
            });
        });
    }

    // Emit custom events to components via RxJS Subject
    private emitEvent(event: string, data: any): void {
        this.eventSubject.next({ event, data });
    }

    // Expose WebSocket events as an observable
    get events$() {
        return this.eventSubject.asObservable();
    }

    // Send a message to the WebSocket server
    send(event: string, data: any): void {
        if (!this.socket) {
            console.error("WebSocket is not connected");
            return;
        }
        this.socket.emit(event, data);
    }
}