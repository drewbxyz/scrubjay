import { Test, type TestingModule } from "@nestjs/testing";
import { DrizzleService } from "@/core/drizzle/drizzle.service";
import { AlertQueue } from "../dispatch/alert-queue.service";
import { SubscriptionsRepository } from "./subscriptions.repository";
import { SubscriptionsService } from "./subscriptions.service";

describe("SubscriptionsModule", () => {
  let module: TestingModule;

  const mockDrizzleService = {
    db: {
      insert: jest.fn(),
      transaction: jest.fn(),
    },
  } as unknown as DrizzleService;

  const mockAlertQueue = {
    backfillEBird: jest.fn(),
  } as unknown as AlertQueue;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      exports: [SubscriptionsService],
      providers: [
        {
          provide: DrizzleService,
          useValue: mockDrizzleService,
        },
        {
          provide: AlertQueue,
          useValue: mockAlertQueue,
        },
        SubscriptionsRepository,
        SubscriptionsService,
      ],
    }).compile();
  });

  it("should be defined", () => {
    expect(module).toBeDefined();
  });

  it("should provide SubscriptionsRepository", () => {
    const repository = module.get<SubscriptionsRepository>(
      SubscriptionsRepository,
    );
    expect(repository).toBeDefined();
    expect(repository).toBeInstanceOf(SubscriptionsRepository);
  });

  it("should provide SubscriptionsService", () => {
    const service = module.get<SubscriptionsService>(SubscriptionsService);
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(SubscriptionsService);
  });

  it("should export SubscriptionsService", () => {
    const exportedService = module.get<SubscriptionsService>(
      SubscriptionsService,
      {
        strict: false,
      },
    );
    expect(exportedService).toBeDefined();
  });
});
