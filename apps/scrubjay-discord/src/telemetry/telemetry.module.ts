import { Module, type OnApplicationShutdown } from "@nestjs/common";
import { shutdownOtel } from "./otel";

/**
 * Owns the OTel SDK's Nest-side lifecycle: enableShutdownHooks() wires
 * SIGTERM/SIGINT to onApplicationShutdown, which flushes pending telemetry.
 */
@Module({})
export class TelemetryModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownOtel();
  }
}
