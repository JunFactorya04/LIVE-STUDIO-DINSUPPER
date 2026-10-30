import { isTauri } from "../live/repository";

// Session report, export, retention, backup and wipe. Everything runs in Rust against the local
// database; outside the desktop app there is no stored data, so the client reports itself as
// unavailable instead of faking numbers.

export interface SessionSummary {
  id: string;
  username: string | null;
  providerType: string;
  status: string;
  createdAt: string;
  comments: number;
  ordersDraft: number;
  ordersNeedsReview: number;
  ordersConfirmed: number;
  ordersCancelled: number;
  replies: number;
  repliesCopied: number;
}

export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  detail: string;
}

export type ExportFormat = "json" | "orders_csv";

export interface ReportClient {
  readonly available: boolean;
  sessions(): Promise<SessionSummary[]>;
  audit(limit: number): Promise<AuditEntry[]>;
  /** Writes a file into the Downloads folder and returns its path. */
  exportSession(sessionId: string, format: ExportFormat): Promise<string>;
  backup(): Promise<string>;
  purgeOlder(days: number): Promise<number>;
  deleteSession(sessionId: string): Promise<void>;
  deleteAll(includeCatalog: boolean): Promise<number>;
}

class TauriReportClient implements ReportClient {
  readonly available = true;
  private async call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    const { invoke } = await import("../platform/backend");
    return invoke<T>(cmd, args);
  }
  sessions() {
    return this.call<SessionSummary[]>("report_sessions");
  }
  audit(limit: number) {
    return this.call<AuditEntry[]>("audit_list", { limit });
  }
  exportSession(sessionId: string, format: ExportFormat) {
    return this.call<string>("data_export", { sessionId, format });
  }
  backup() {
    return this.call<string>("data_backup");
  }
  purgeOlder(days: number) {
    return this.call<number>("data_purge_older", { days });
  }
  async deleteSession(sessionId: string) {
    await this.call<number>("live_delete_session", { sessionId });
  }
  deleteAll(includeCatalog: boolean) {
    return this.call<number>("data_delete_all", { includeCatalog });
  }
}

class UnavailableReportClient implements ReportClient {
  readonly available = false;
  private no(): Promise<never> {
    return Promise.reject(new Error("NOT_DESKTOP"));
  }
  sessions = () => this.no();
  audit = () => this.no();
  exportSession = () => this.no();
  backup = () => this.no();
  purgeOlder = () => this.no();
  deleteSession = () => this.no();
  deleteAll = () => this.no();
}

export function createReportClient(): ReportClient {
  return isTauri() ? new TauriReportClient() : new UnavailableReportClient();
}
