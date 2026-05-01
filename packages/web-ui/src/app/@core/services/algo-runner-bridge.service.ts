import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AlgoRunnerEvent,
  AlgoRunnerRunningInstance,
  AlgoRunnerStartPayload,
  AlgoRunnerStartResult,
  AlgoRunnerStrategyPayload,
} from '../algo-runner.types';

type RunnerRequestMessage = {
  type: string;
  requestId: string;
  payload?: unknown;
};

type RunnerResponseMessage = {
  type: 'runner.response';
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type RunnerEventMessage = {
  type: 'runner.event';
  event: AlgoRunnerEvent;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

@Injectable({ providedIn: 'root' })
export class AlgoRunnerBridgeService {
  public readonly events$ = new Subject<AlgoRunnerEvent>();

  private iframe: HTMLIFrameElement | null = null;
  private port: MessagePort | null = null;
  private readyPromise: Promise<boolean> | null = null;
  private pending = new Map<string, PendingRequest>();
  private nextId = 0;

  constructor(private zone: NgZone) {}

  public isEnabled(): boolean {
    return !!environment.algoRunner?.enabled;
  }

  public isConnected(): boolean {
    return !!this.port;
  }

  public async ensureReady(): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    if (this.port) {
      return true;
    }

    if (!this.readyPromise) {
      this.readyPromise = this.bootstrap();
    }

    try {
      return await this.readyPromise;
    } finally {
      this.readyPromise = null;
    }
  }

  public async importStrategy(payload: AlgoRunnerStrategyPayload): Promise<void> {
    await this.request<void>('runner.importStrategy', payload);
  }

  public async startStrategy(payload: AlgoRunnerStartPayload): Promise<AlgoRunnerStartResult> {
    return this.request<AlgoRunnerStartResult>('runner.startStrategy', payload);
  }

  public async stopStrategy(systemId: string): Promise<void> {
    await this.request<void>('runner.stopStrategy', { systemId });
  }

  public async getRunning(): Promise<AlgoRunnerRunningInstance[]> {
    return this.request<AlgoRunnerRunningInstance[]>('runner.getRunning');
  }

  private async bootstrap(): Promise<boolean> {
    const iframe = this.ensureIframe();
    const targetWindow = await this.waitForIframe(iframe);
    const channel = new MessageChannel();

    channel.port1.onmessage = (event: MessageEvent<RunnerResponseMessage | RunnerEventMessage | { type?: string }>) => {
      const data = event.data;
      if (data?.type === 'runner.ready') {
        this.port = channel.port1;
        this.port.onmessage = (portEvent: MessageEvent<RunnerResponseMessage | RunnerEventMessage>) =>
          this.handlePortMessage(portEvent);
      }
    };

    const handshakeTimeoutMs = environment.algoRunner?.handshakeTimeoutMs ?? 4000;

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Algo runner handshake timed out'));
      }, handshakeTimeoutMs);

      channel.port1.onmessage = (event: MessageEvent<RunnerResponseMessage | RunnerEventMessage | { type?: string }>) => {
        const data = event.data;
        if (data?.type !== 'runner.ready') {
          return;
        }

        clearTimeout(timeoutId);
        this.port = channel.port1;
        this.port.onmessage = (portEvent: MessageEvent<RunnerResponseMessage | RunnerEventMessage>) =>
          this.handlePortMessage(portEvent);
        resolve();
      };

      targetWindow.postMessage(
        {
          type: 'runner.handshake',
          parentOrigin: window.location.origin,
        },
        this.getRunnerOrigin(),
        [channel.port2]
      );
    });

    return true;
  }

  private ensureIframe(): HTMLIFrameElement {
    if (this.iframe && document.body.contains(this.iframe)) {
      return this.iframe;
    }

    const iframe = document.createElement('iframe');
    iframe.hidden = true;
    iframe.title = 'algo-runner';
    iframe.sandbox.add('allow-scripts', 'allow-same-origin');
    iframe.referrerPolicy = 'strict-origin';
    iframe.src = this.buildRunnerUrl();
    document.body.appendChild(iframe);
    this.iframe = iframe;
    return iframe;
  }

  private waitForIframe(iframe: HTMLIFrameElement): Promise<Window> {
    return new Promise((resolve, reject) => {
      const existing = iframe.contentWindow;
      if (existing && iframe.contentDocument?.readyState === 'complete') {
        resolve(existing);
        return;
      }

      const onLoad = () => {
        const targetWindow = iframe.contentWindow;
        if (!targetWindow) {
          reject(new Error('Algo runner iframe has no contentWindow'));
          return;
        }
        resolve(targetWindow);
      };

      iframe.addEventListener('load', onLoad, { once: true });
    });
  }

  private handlePortMessage(event: MessageEvent<RunnerResponseMessage | RunnerEventMessage>): void {
    const data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }

    if (data.type === 'runner.response') {
      const pending = this.pending.get(data.requestId);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeoutId);
      this.pending.delete(data.requestId);
      if (data.ok) {
        pending.resolve(data.result);
      } else {
        pending.reject(new Error(data.error || 'Algo runner request failed'));
      }
      return;
    }

    if (data.type === 'runner.event') {
      this.zone.run(() => this.events$.next(data.event));
    }
  }

  private async request<TResult>(type: string, payload?: unknown): Promise<TResult> {
    const ready = await this.ensureReady();
    if (!ready || !this.port) {
      throw new Error('Algo runner is not available');
    }

    const requestId = `runner-${++this.nextId}`;
    const requestTimeoutMs = environment.algoRunner?.requestTimeoutMs ?? 15000;

    return new Promise<TResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${type} timed out`));
      }, requestTimeoutMs);

      this.pending.set(requestId, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timeoutId,
      });

      const message: RunnerRequestMessage = { type, requestId, payload };
      this.port!.postMessage(message);
    });
  }

  private buildRunnerUrl(): string {
    return new URL(
      environment.algoRunner?.path || '/assets/algo-runner/host.html',
      this.getRunnerOrigin()
    ).toString();
  }

  private getRunnerOrigin(): string {
    return environment.algoRunner?.origin || window.location.origin;
  }
}
