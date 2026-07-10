import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

@Injectable()
class Engine {
  start() {
    return "started";
  }
}

@Injectable()
class Car {
  constructor(private readonly engine: Engine) {}

  drive() {
    return this.engine.start();
  }
}

describe("vitest transform", () => {
  it("emits decorator metadata so Nest can constructor-inject", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [Car, Engine],
    }).compile();

    expect(moduleRef.get(Car).drive()).toBe("started");
  });
});
