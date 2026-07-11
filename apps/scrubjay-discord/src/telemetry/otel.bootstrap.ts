// Nest only loads .env inside ConfigModule.forRoot(), long after the SDK
// must decide whether to start — so load it here. dotenv never overwrites
// variables that are already set in the environment.
import "dotenv/config";
import { startOtel } from "./otel";

startOtel();
