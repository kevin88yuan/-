export enum RecorderStatus {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  PAUSED = 'PAUSED',
  REVIEW = 'REVIEW',
}

export interface VideoMetadata {
  blob: Blob;
  url: string;
  mimeType: string;
  duration: number; // in seconds
  timestamp: Date;
}

export interface AnalysisResult {
  title: string;
  summary: string;
  tags: string[];
}
