export type NotificationTriggerType = 'failure' | 'success' | 'digest' | 'newFlaky';

export interface RunSummary {
  id: string;
  project: string;
  timestamp: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  status: 'passed' | 'failed';
  duration: number;
  sourceDeveloper?: string | null;
}

export interface CaseSummary {
  caseName: string;
  suiteId: string;
  status: 'passed' | 'failed' | 'skipped';
  error?: string | null;
  duration: number;
}

export interface NotificationMessage {
  type: NotificationTriggerType;
  teamName: string;
  project: string;
  run: RunSummary;
  failedCases?: CaseSummary[];
  newFlakyCases?: Array<{ caseName: string; suiteId: string; score: number }>;
  digestStats?: {
    totalRuns: number;
    totalPassed: number;
    totalFailed: number;
    passRate: number;
    period: string;
  };
  dashboardUrl?: string;
}

export interface NotificationChannel {
  send(message: NotificationMessage): Promise<void>;
}

export interface NotificationConfig {
  id: string;
  teamId: string;
  webhookUrl: string | null;
  onFailure: boolean;
  onSuccess: boolean;
  onNewFlaky: boolean;
  dailyDigest: boolean;
  digestTime: string;
  digestTimezone: string;
  createdAt: string;
  updatedAt: string;
}
