import { describe, expect, it } from "vitest";
import { poolNameFields } from "./pool-name";

describe("poolNameFields", () => {
  it("extracts host, port, and database from a full URL", () => {
    expect(
      poolNameFields("postgresql://user:pw@db.example.com:5433/scrubjay"),
    ).toEqual({
      database: "scrubjay",
      host: "db.example.com",
      port: 5433,
    });
  });

  it("defaults the port to 5432 when the URL omits it", () => {
    expect(poolNameFields("postgresql://user:pw@localhost/scrubjay")).toEqual({
      database: "scrubjay",
      host: "localhost",
      port: 5432,
    });
  });

  it("percent-decodes the database name and ignores query params", () => {
    expect(
      poolNameFields("postgres://localhost:5432/my%20db?sslmode=require"),
    ).toEqual({
      database: "my db",
      host: "localhost",
      port: 5432,
    });
  });
});
