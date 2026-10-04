import type {
  BasicSignClass,
  SignSampleRecord,
  SignDatasetExport,
} from './signCollectionTypes';
import { BASIC_SIGN_CLASSES } from './signCollectionTypes';

/**
 * Normalizes a signer alias:
 * - Trims leading/trailing whitespace
 * - Replaces non-alphanumeric characters (except underscore/hyphen) with hyphen
 * - Lowercases for consistent comparison
 * - Defaults to 'signer-01' if empty
 */
export function sanitizeSignerAlias(alias?: string | null): string {
  const trimmed = (alias || '').trim();
  if (!trimmed) {
    return 'signer-01';
  }
  return trimmed.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

export class SignCollectionManager {
  private samples: SignSampleRecord[] = [];

  /**
   * Adds a recorded sequence sample to the collection after schema validation.
   */
  public addSample(sample: SignSampleRecord): void {
    if (!sample.label || !BASIC_SIGN_CLASSES.includes(sample.label)) {
      throw new Error(`Invalid sign class label: ${sample.label}`);
    }
    if (sample.sequenceLength !== 60) {
      throw new Error(`Sequence length must be exactly 60, got ${sample.sequenceLength}`);
    }
    if (!Array.isArray(sample.frames) || sample.frames.length !== 60) {
      throw new Error(`Sample must contain exactly 60 frames, got ${sample.frames?.length}`);
    }
    for (let i = 0; i < 60; i++) {
      if (!Array.isArray(sample.frames[i]) || sample.frames[i].length !== 126) {
        throw new Error(`Frame ${i} must contain exactly 126 float values, got ${sample.frames[i]?.length}`);
      }
    }

    // Ensure non-identifying, normalized alias
    const sanitizedAlias = sanitizeSignerAlias(sample.signerAlias);

    const cleanRecord: SignSampleRecord = {
      version: '1.0',
      label: sample.label,
      sequenceLength: 60,
      featureSchema: sample.featureSchema || 'wrist_normalized_v1',
      capturedAt: sample.capturedAt || new Date().toISOString(),
      sessionId: sample.sessionId || `session-${Date.now()}`,
      signerAlias: sanitizedAlias,
      cameraFacing: sample.cameraFacing || 'user',
      frames: sample.frames,
      rawFrames: sample.rawFrames,
      normalizedFrames: sample.normalizedFrames,
      stats: {
        leftHandOccupancy: sample.stats?.leftHandOccupancy ?? 0,
        rightHandOccupancy: sample.stats?.rightHandOccupancy ?? 0,
      },
    };

    this.samples.push(cleanRecord);
  }

  /**
   * Discards the most recently saved sample.
   * If a signerAlias is provided, discards the most recent sample for that signer only.
   */
  public discardLastSample(signerAlias?: string): SignSampleRecord | null {
    if (this.samples.length === 0) {
      return null;
    }
    if (!signerAlias) {
      return this.samples.pop() ?? null;
    }
    const targetAlias = sanitizeSignerAlias(signerAlias);
    for (let i = this.samples.length - 1; i >= 0; i--) {
      if (this.samples[i].signerAlias === targetAlias) {
        const [removed] = this.samples.splice(i, 1);
        return removed ?? null;
      }
    }
    return null;
  }

  /**
   * Retrieves all collected samples.
   */
  public getSamples(): SignSampleRecord[] {
    return [...this.samples];
  }

  /**
   * Retrieves samples belonging to a specific class.
   */
  public getSamplesByClass(label: BasicSignClass): SignSampleRecord[] {
    return this.samples.filter((s) => s.label === label);
  }

  /**
   * Retrieves all samples belonging to a specific signer.
   */
  public getSamplesForSigner(signerAlias: string): SignSampleRecord[] {
    const targetAlias = sanitizeSignerAlias(signerAlias);
    return this.samples.filter((s) => s.signerAlias === targetAlias);
  }

  /**
   * Returns counts of collected samples grouped by class.
   * If signerAlias is specified, returns counts scoped to that signer only.
   * If omitted, returns global counts across the entire session.
   */
  public getCountsByClass(signerAlias?: string): Record<BasicSignClass, number> {
    const counts: Record<BasicSignClass, number> = {
      water: 0,
      help: 0,
      hungry: 0,
      need: 0,
      want: 0,
      hello: 0,
      thankyou: 0,
      NO_SIGN: 0,
    };
    const targetAlias = signerAlias ? sanitizeSignerAlias(signerAlias) : null;
    for (const sample of this.samples) {
      if (targetAlias && sample.signerAlias !== targetAlias) {
        continue;
      }
      if (counts[sample.label] !== undefined) {
        counts[sample.label]++;
      }
    }
    return counts;
  }

  /**
   * Total number of collected samples across all classes.
   */
  public getTotalCount(): number {
    return this.samples.length;
  }

  /**
   * Total number of collected samples for a specific signer.
   */
  public getSignerTotalCount(signerAlias: string): number {
    const targetAlias = sanitizeSignerAlias(signerAlias);
    return this.samples.filter((s) => s.signerAlias === targetAlias).length;
  }

  /**
   * Returns sample counts grouped by signer alias.
   */
  public getSignerCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const sample of this.samples) {
      counts[sample.signerAlias] = (counts[sample.signerAlias] || 0) + 1;
    }
    return counts;
  }

  /**
   * Unique non-identifying signer aliases present in the collection.
   */
  public getSigners(): string[] {
    const set = new Set<string>();
    for (const s of this.samples) {
      set.add(s.signerAlias);
    }
    return Array.from(set);
  }

  /**
   * Exports the entire in-memory dataset to a standalone JSON string.
   * Strips any identifying information and contains only feature arrays + metadata.
   */
  public exportDatasetJson(): string {
    const datasetExport: SignDatasetExport = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      totalSamples: this.samples.length,
      classCounts: this.getCountsByClass(),
      signers: this.getSigners(),
      signerCounts: this.getSignerCounts(),
      samples: this.samples,
    };
    return JSON.stringify(datasetExport, null, 2);
  }

  /**
   * Clears all samples in the session.
   */
  public clear(): void {
    this.samples = [];
  }
}
