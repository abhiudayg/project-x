export interface BootstrapSummary {
  readonly mean: number;
  readonly median: number;
  readonly p90: number;
  readonly ciLow: number;
  readonly ciHigh: number;
  readonly confidence: number;
  readonly sampleCount: number;
}

export const percentile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;

  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
};

export const calculateMedian = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
};

export const bootstrapConfidenceInterval = (
  data: readonly number[],
  confidence = 0.9,
  resamples = 1000
): BootstrapSummary => {
  if (data.length === 0) {
    return {
      mean: 0,
      median: 0,
      p90: 0,
      ciLow: 0,
      ciHigh: 0,
      confidence,
      sampleCount: 0,
    };
  }

  const sorted = [...data].sort((a, b) => a - b);
  const n = data.length;
  const mean = data.reduce((sum, v) => sum + v, 0) / n;
  const median = percentile(sorted, 0.5);
  const p90 = percentile(sorted, 0.9);

  const bootstrapMeans: number[] = new Array(resamples);

  for (let b = 0; b < resamples; b++) {
    let sampleSum = 0;
    for (let i = 0; i < n; i++) {
      const randIdx = Math.floor(Math.random() * n);
      sampleSum += data[randIdx]!;
    }
    bootstrapMeans[b] = sampleSum / n;
  }

  bootstrapMeans.sort((a, b) => a - b);

  const alpha = 1 - confidence;
  const lowerIdx = Math.floor(resamples * (alpha / 2));
  const upperIdx = Math.ceil(resamples * (1 - alpha / 2));

  const ciLow = bootstrapMeans[Math.max(0, lowerIdx)]!;
  const ciHigh = bootstrapMeans[Math.min(resamples - 1, upperIdx)]!;

  return {
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    p90: Math.round(p90 * 100) / 100,
    ciLow: Math.round(ciLow * 100) / 100,
    ciHigh: Math.round(ciHigh * 100) / 100,
    confidence,
    sampleCount: n,
  };
};
