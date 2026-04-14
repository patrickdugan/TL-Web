import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import * as ecc from 'tiny-secp256k1';

export interface CollatorManifestV1 {
  v: 1;
  collatorId: string;
  collatorPubKey: string;
  region?: string;
  roles: Array<'collator' | 'bundler'>;
  protocol: { wireMsgVersion: 1; dataChannelLabel: string; maxMsgBytes: number };
  tape: { format: 'ndjson'; hash: 'sha256'; indexStride: number; replayBatch: number };
  policy: any;
  build: any;
  sigCollator: string;
}

export interface ManifestFetchResult {
  wsUrl: string;
  manifestUrl: string;
  manifest?: CollatorManifestV1;
  verified: boolean;
  reason?: string;
}

function stableStringify(v: any): string {
  const isPlain = (x: any) => !!x && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype;
  const canon = (x: any): any => {
    if (x === null) return null;
    if (Array.isArray(x)) return x.map(canon);
    if (isPlain(x)) {
      const out: any = {};
      for (const k of Object.keys(x).sort()) out[k] = canon(x[k]);
      return out;
    }
    return x;
  };
  return JSON.stringify(canon(v));
}

function hexToBytes(hex: string): Uint8Array {
  const s = (hex || '').toLowerCase();
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function sha256HexUtf8(s: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function manifestUrlFromWs(wsUrl: string): string {
  const u = new URL(wsUrl);
  u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
  u.pathname = '/manifest';
  u.search = '';
  u.hash = '';
  return u.toString();
}

async function verifyManifest(m: CollatorManifestV1): Promise<{ ok: boolean; reason?: string }> {
  if (!m || m.v !== 1) return { ok: false, reason: 'bad version' };
  if (!m.collatorPubKey || !m.sigCollator) return { ok: false, reason: 'missing key/sig' };

  const expectedId = await sha256HexUtf8(String(m.collatorPubKey));
  if (String(m.collatorId) !== expectedId) return { ok: false, reason: 'collatorId mismatch' };

  const { sigCollator, ...body } = m as any;
  const msg32Hex = await sha256HexUtf8(stableStringify(body));
  const ok = ecc.verify(hexToBytes(msg32Hex), hexToBytes(String(m.collatorPubKey)), hexToBytes(String(sigCollator)));
  return ok ? { ok: true } : { ok: false, reason: 'sig verify failed' };
}

@Injectable({ providedIn: 'root' })
export class CollatorManifestService {
  constructor(private http: HttpClient) {}

  async fetch(wsUrl: string): Promise<ManifestFetchResult> {
    const manifestUrl = manifestUrlFromWs(wsUrl);
    try {
      const m = await this.http.get<CollatorManifestV1>(manifestUrl).toPromise();
      const v = await verifyManifest(m);
      return { wsUrl, manifestUrl, manifest: m, verified: v.ok, reason: v.reason };
    } catch (e: any) {
      return { wsUrl, manifestUrl, verified: false, reason: e?.message || String(e) };
    }
  }
}
