import { Injectable } from '@angular/core';
import { MainApiService } from '../apis/main-api.service';
import { M1_PROCEDURAL_RECEIPT_CONFIG, ProceduralReceiptConfig } from '../constants/procedural.constants';

export interface ProceduralRuntimeConfig extends ProceduralReceiptConfig {
  enabled?: boolean;
  chainId?: string | null;
  chainTicker?: string | null;
  state?: string | null;
  holderAddress?: string | null;
  operatorAddress?: string | null;
  oracleAddress?: string | null;
  residualAddress?: string | null;
  fundingTxid?: string | null;
  fundedAmountLtc?: number | null;
  settlementRoute?: string | null;
}

export interface ProceduralArtifactGenerationRequest {
  mode?: 'fresh' | 'replay';
  pathName?: string;
  broadcastFunding?: boolean;
  includeSettlementValidation?: boolean;
  forceSettlementValidation?: boolean;
  provisionIfMissing?: boolean;
  rpcUrl?: string;
  rpcUser?: string;
  rpcPass?: string;
  sourceWallet?: string;
  destinationWallet?: string;
  minConfirmations?: number;
}

@Injectable({
  providedIn: 'root',
})
export class ProceduralRuntimeService {
  constructor(private mainApi: MainApiService) {}

  isExecutableConfig(config: ProceduralRuntimeConfig | null | undefined): config is ProceduralRuntimeConfig {
    return !!config
      && config.enabled !== false
      && config.ready === true
      && config.executionContextReady === true
      && !!config.executionContextId
      && !!config.executionContextHash
      && !!config.vaultAddress
      && !!config.fundingTxid
      && Number(config.fundedAmountLtc || 0) > 0
      && !!config.selectedPathId
      && !!config.templateId
      && !!config.contractId;
  }

  async loadConfig(): Promise<ProceduralRuntimeConfig | null> {
    try {
      const res = await this.mainApi.getBitvmProceduralConfig();
      const remote = res?.data;
      if (!remote || remote.enabled === false) {
        return null;
      }

      return {
        ...M1_PROCEDURAL_RECEIPT_CONFIG,
        ...remote,
      };
    } catch {
      return null;
    }
  }

  async loadConfigWithFallback(): Promise<ProceduralRuntimeConfig> {
    const remote = await this.loadConfig();
    if (remote) {
      return remote;
    }
    return {
      ...M1_PROCEDURAL_RECEIPT_CONFIG,
    };
  }

  async loadRequiredConfig(): Promise<ProceduralRuntimeConfig> {
    const remote = await this.loadConfig();
    const diagnostics = remote;

    if (remote && this.isExecutableConfig(remote)) {
      return remote;
    }

    const error = diagnostics?.contextErrors?.[0]
      || diagnostics?.contextWarnings?.[0]
      || 'Procedural receipt execution context is not ready.';
    throw new Error(error);
  }

  async generateArtifacts(request: ProceduralArtifactGenerationRequest = {}): Promise<any> {
    const res = await this.mainApi.bitvmGenerateArtifacts(request);
    if (res?.error || !res?.data) {
      throw new Error(res?.error || 'Failed to generate BitVM artifacts.');
    }
    return res.data;
  }

  async generateAndLoadRequiredConfig(request: ProceduralArtifactGenerationRequest = {}): Promise<ProceduralRuntimeConfig> {
    const generated = await this.generateArtifacts(request);
    const remote = generated?.proceduralConfig;
    const merged = remote
      ? {
          ...M1_PROCEDURAL_RECEIPT_CONFIG,
          ...remote,
        }
      : await this.loadConfig();

    if (merged && this.isExecutableConfig(merged)) {
      return merged;
    }

    const error = merged?.contextErrors?.[0]
      || merged?.contextWarnings?.[0]
      || generated?.executionContext?.errors?.[0]
      || 'Procedural receipt execution context is not ready after artifact generation.';
    throw new Error(error);
  }
}
