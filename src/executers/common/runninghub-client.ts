export type RunningHubTaskStatus = 'pending' | 'running' | 'done' | 'error';

export interface RunningHubSubmitParams {
  readonly apiId: string;
  readonly prompt: string;
  readonly referenceImageUri?: string;
}

export interface RunningHubTaskResult {
  readonly status: RunningHubTaskStatus;
  readonly outputUri?: string;
  readonly errorMessage?: string;
}

export interface RunningHubClient {
  submitTask(params: RunningHubSubmitParams): Promise<{ readonly taskId: string }>;
  pollTask(taskId: string): Promise<RunningHubTaskResult>;
}
