import express from "express";
import { authenticateApiKey } from "./middleware/auth";
import { rateLimit } from "./middleware/rate-limit";
import { createEbirdRoutes } from "./routes/ebird.routes";

const app = express();
const PORT = 8080;

app.use(express.json());

// Health check (no auth required)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Root endpoint (no auth required)
app.get("/", (_req, res) => {
  res.json({
    endpoints: [
      "GET /v2/data/obs/{regionCode}/recent",
      "GET /v2/data/obs/{regionCode}/recent/notable",
      "GET /v2/data/obs/{regionCode}/recent/{speciesCode}",
      "GET /v2/ref/hotspot/{regionCode}",
      "GET /v2/ref/species/info/{speciesCode}",
      "GET /v2/data/obs/geo/recent",
      "GET /v2/data/obs/geo/recent/notable",
    ],
    message: "Mock API Server for Development",
    version: "2.0",
  });
});

// eBird routes (require auth and rate limiting)
app.use("/v2", authenticateApiKey, rateLimit, createEbirdRoutes());

// Error handling middleware
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err.stack);
    res.status(500).json({ error: "Internal server error" });
  },
);

// 404 handler
app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: "Endpoint not found" });
});

app.listen(PORT, () => {
  console.log(`Mock API Server is running on http://localhost:${PORT}`);
});
