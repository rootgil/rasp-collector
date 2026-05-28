import pino from "pino";
import { config } from "../config.js";

export const logger = pino({
  level: config.logLevel,
  redact: {
    // Never log secrets or raw request bodies
    paths: [
      "req.headers.authorization",
      "*.password",
      "*.secret",
      "*.apiKey",
      "*.api_key",
      "*.token",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    req(req) {
      return {
        method: req.method,
        url: req.url,
        remoteAddress: req.socket?.remoteAddress,
      };
    },
  },
});
