import { LOG_LEVELS, type LogLevel } from '../config/config';

type LogContext = Readonly<Record<string, unknown>>;
type LogWriter = (message: string, context?: LogContext) => void;

type LogOutput = Pick<Console, 'error' | 'warn' | 'info' | 'debug' | 'log'>;

export interface Logger {
  error(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  trace(message: string, context?: LogContext): void;
}

/** Context must not contain secrets or authorization headers. */
export function createLogger(
  level: LogLevel,
  output: LogOutput = console,
  now: () => Date = () => new Date(),
): Logger {
  const threshold = LOG_LEVELS.indexOf(level);
  if (threshold === -1) throw new Error(`Unknown log level: ${level}`);

  function writer(messageLevel: LogLevel): LogWriter {
    return (message, context) => {
      if (LOG_LEVELS.indexOf(messageLevel) > threshold) return;
      const formatted = `${now().toISOString()} ${messageLevel.toUpperCase()} ${message}`;
      // console.trace includes a stack trace; ordinary trace messages do not need one.
      const method = messageLevel === 'trace' ? 'log' : messageLevel;
      if (context === undefined) output[method](formatted);
      else output[method](formatted, context);
    };
  }

  return {
    error: writer('error'),
    warn: writer('warn'),
    info: writer('info'),
    debug: writer('debug'),
    trace: writer('trace'),
  };
}
