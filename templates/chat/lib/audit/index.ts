/**
 * Audit Module
 *
 * Exports for tool and error logging functionality.
 */

// Tool execution logging
export {
  logToolStart,
  logToolSuccess,
  logToolError,
  type LogEntry,
} from "./logToolEvent";

// Error logging with type classification
export {
  logError,
  logErrorFromException,
  TypedError,
  isTypedError,
  type ErrorType,
  type ErrorLogContext,
  type ErrorPayload,
  type ErrorLogResult,
} from "./logError";
