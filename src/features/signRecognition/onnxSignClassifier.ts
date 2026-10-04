import * as ort from 'onnxruntime-web';
import type { PredictionResult } from './signTypes';

export interface OnnxClassifierOptions {
  modelPath?: string;
  labelsPath?: string;
}

export class OnnxSignClassifier {
  private session: ort.InferenceSession | null = null;
  private labels: string[] = [];
  private isLoaded = false;
  private isRunning = false;

  private readonly modelPath: string;
  private readonly labelsPath: string;

  constructor(options?: OnnxClassifierOptions) {
    this.modelPath = options?.modelPath ?? '/models/communicare-aac-sign-v3-candidate/model.onnx';
    this.labelsPath = options?.labelsPath ?? '/models/communicare-aac-sign-v3-candidate/labels.json';
  }

  async load(): Promise<void> {
    if (this.isLoaded) return;

    try {
      // 1. Load Labels
      const labelsRes = await fetch(this.labelsPath);
      if (!labelsRes.ok) {
        throw new Error(`Failed to load labels from ${this.labelsPath}: ${labelsRes.statusText}`);
      }
      this.labels = (await labelsRes.json()) as string[];

      // 2. Load ONNX Model
      // Configure WASM paths or load via fetch buffer for robust browser compatibility
      const modelRes = await fetch(this.modelPath);
      if (!modelRes.ok) {
        throw new Error(`Failed to load model from ${this.modelPath}: ${modelRes.statusText}`);
      }
      const modelBuffer = await modelRes.arrayBuffer();

      this.session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });

      this.isLoaded = true;
    } catch (err) {
      this.isLoaded = false;
      this.session = null;
      throw new Error(`PSL ONNX model initialization failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async predict(flattenedSequence: Float32Array): Promise<PredictionResult | null> {
    if (!this.isLoaded || !this.session || this.labels.length === 0) {
      return null;
    }
    if (this.isRunning) {
      return null; // Avoid overlapping inferences
    }

    this.isRunning = true;
    try {
      const inputName = this.session.inputNames[0] ?? 'input_frames';
      const outputName = this.session.outputNames[0] ?? 'probabilities';

      // Shape: V3 is [1, 24, 252]; backward-compatible fallback for 60x126 if length matches
      const tensorDims = flattenedSequence.length === 60 * 126 ? [1, 60, 126] : [1, 24, 252];
      const inputTensor = new ort.Tensor('float32', flattenedSequence, tensorDims);
      const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };

      const results = await this.session.run(feeds);
      const outputTensor = results[outputName];
      if (!outputTensor || !outputTensor.data) {
        return null;
      }

      const probs = outputTensor.data as Float32Array;
      if (probs.length !== this.labels.length) {
        return null;
      }

      // Compute top-3 classes
      const indexedProbs = Array.from(probs).map((score, index) => ({
        label: this.labels[index] || `class_${index}`,
        confidence: score,
      }));

      indexedProbs.sort((a, b) => b.confidence - a.confidence);

      const top1 = indexedProbs[0];
      const top2 = indexedProbs.length > 1 ? indexedProbs[1] : undefined;
      const top3 = indexedProbs.slice(0, 3);
      const margin = top2 ? top1.confidence - top2.confidence : top1.confidence;

      return {
        label: top1.label,
        confidence: top1.confidence,
        top2,
        top3,
        margin,
      };
    } finally {
      this.isRunning = false;
    }
  }

  get ready(): boolean {
    return this.isLoaded && this.session !== null;
  }

  get classCount(): number {
    return this.labels.length;
  }
}
