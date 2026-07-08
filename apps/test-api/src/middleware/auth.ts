import express from "express";

const apiKeys = new Set(["test-api-key", "dev-key-123"]);

export function authenticateApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const apiKey = req.headers["x-ebirdapitoken"] as string;

  if (!apiKey) {
    return res.status(401).json({ error: "API key required" });
  }

  if (!apiKeys.has(apiKey)) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  next();
}
