import { logs, SeverityNumber } from "@opentelemetry/api-logs";

type LogAttributes = Record<string, string | number | boolean>;

const otelLogger = logs.getLogger("scrubjay-portal");

function emit(
  severityNumber: SeverityNumber,
  level: "error" | "info" | "warn",
  message: string,
  attributes: LogAttributes = {},
): void {
  otelLogger.emit({
    attributes,
    body: message,
    severityNumber,
    severityText: level.toUpperCase(),
  });
  const line = `${JSON.stringify({
    level,
    msg: message,
    time: new Date().toISOString(),
    ...attributes,
  })}\n`;
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(line);
}

export const logger = {
  error: (message: string, attributes?: LogAttributes) =>
    emit(SeverityNumber.ERROR, "error", message, attributes),
  info: (message: string, attributes?: LogAttributes) =>
    emit(SeverityNumber.INFO, "info", message, attributes),
  warn: (message: string, attributes?: LogAttributes) =>
    emit(SeverityNumber.WARN, "warn", message, attributes),
};
