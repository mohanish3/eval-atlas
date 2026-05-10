import { logInfo, logWarn, logError } from '../middleware/logger.js';

type AuditEvent =
  | 'workflow.created'
  | 'workflow.agent-dispatch'
  | 'workflow.agent-response'
  | 'workflow.aggregation'
  | 'security.validation'
  | 'system.fallback';

export class AuditLogger {
  static log(event: AuditEvent, details: Record<string, unknown>): void {
    logInfo(`audit:${event}`, details);
  }

  static warn(event: AuditEvent, details: Record<string, unknown>): void {
    logWarn(`audit:${event}`, details);
  }

  static error(event: AuditEvent, error: Error, details?: Record<string, unknown>): void {
    logError(`audit:${event}`, error, details);
  }
}
