export class InvalidRegionError extends Error {
  constructor(readonly regionCode: string) {
    super(`Invalid region code: ${regionCode}`);
    this.name = "InvalidRegionError";
  }
}
