import { Global, Module, type OnApplicationShutdown } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { CommandTelemetryInterceptor } from "./command-telemetry.interceptor";
import { JobTelemetry } from "./job-telemetry.service";
import { shutdownOtel } from "./otel";

/**
 * Owns the OTel SDK's Nest-side lifecycle: enableShutdownHooks() wires
 * SIGTERM/SIGINT to onApplicationShutdown, which flushes pending telemetry.
 */
@Global()
@Module({
  exports: [JobTelemetry],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: CommandTelemetryInterceptor },
    JobTelemetry,
  ],
})
export class TelemetryModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownOtel();
  }
}
