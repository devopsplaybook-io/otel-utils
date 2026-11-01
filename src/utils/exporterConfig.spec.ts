import type { ConfigOTelInterface } from "../models/ConfigOTelInterface";
import { buildCollectorExporterOptions } from "./exporterConfig";

function config(
  overrides: Partial<ConfigOTelInterface> = {},
): ConfigOTelInterface {
  return {
    SERVICE_ID: "test-service",
    VERSION: "1.0.0",
    ...overrides,
  };
}

const URL = "https://collector:4318/v1/traces";
const VARIABLE = "OPENTELEMETRY_COLLECTOR_HTTP_TRACES";

describe("buildCollectorExporterOptions", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("defaults", () => {
    it("returns the documented defaults", () => {
      expect(buildCollectorExporterOptions(URL, config(), VARIABLE)).toEqual({
        url: URL,
        headers: {},
        timeoutMillis: 10000,
        compression: "none",
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("forwarding", () => {
    it("forwards headers, request timeout and gzip compression", () => {
      const options = buildCollectorExporterOptions(
        URL,
        config({
          OPENTELEMETRY_COLLECTOR_HTTP_HEADERS: { "X-Tenant": "acme" },
          OPENTELEMETRY_COLLECTOR_HTTP_TIMEOUT_MILLIS: 5000,
          OPENTELEMETRY_COLLECTOR_HTTP_COMPRESSION: "gzip",
        }),
        VARIABLE,
      );

      expect(options).toEqual({
        url: URL,
        headers: { "X-Tenant": "acme" },
        timeoutMillis: 5000,
        compression: "gzip",
      });
    });

    it("falls back to the default timeout for invalid values", () => {
      expect(
        buildCollectorExporterOptions(
          URL,
          config({ OPENTELEMETRY_COLLECTOR_HTTP_TIMEOUT_MILLIS: 0 }),
          VARIABLE,
        ).timeoutMillis,
      ).toBe(10000);
    });
  });

  describe("header precedence", () => {
    it("keeps generic headers and adds the bearer token last", () => {
      const options = buildCollectorExporterOptions(
        URL,
        config({
          OPENTELEMETRY_COLLECTOR_HTTP_HEADERS: { "X-Tenant": "acme" },
          OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "secret",
        }),
        VARIABLE,
      );

      expect(options.headers).toEqual({
        "X-Tenant": "acme",
        Authorization: "Bearer secret",
      });
    });

    it("removes a generic authorization header case-insensitively", () => {
      const options = buildCollectorExporterOptions(
        URL,
        config({
          OPENTELEMETRY_COLLECTOR_HTTP_HEADERS: {
            authorization: "Basic abc",
            AUTHORIZATION: "Basic def",
          },
          OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "secret",
        }),
        VARIABLE,
      );

      expect(options.headers).toEqual({ Authorization: "Bearer secret" });
    });

    it("keeps a generic authorization header when no bearer token is set", () => {
      const options = buildCollectorExporterOptions(
        URL,
        config({
          OPENTELEMETRY_COLLECTOR_HTTP_HEADERS: { Authorization: "Api-Key k" },
        }),
        VARIABLE,
      );

      expect(options.headers).toEqual({ Authorization: "Api-Key k" });
    });
  });

  describe("URL safety", () => {
    it("rejects malformed and non-http(s) URLs naming the variable", () => {
      expect(() =>
        buildCollectorExporterOptions("not a url", config(), VARIABLE),
      ).toThrow(`[otel-utils] ${VARIABLE} must be a valid http(s) URL`);
      expect(() =>
        buildCollectorExporterOptions(
          "ftp://collector/v1/traces",
          config(),
          VARIABLE,
        ),
      ).toThrow(`[otel-utils] ${VARIABLE} must be a valid http(s) URL`);
    });

    it("rejects invalid headers", () => {
      expect(() =>
        buildCollectorExporterOptions(
          URL,
          config({
            OPENTELEMETRY_COLLECTOR_HTTP_HEADERS: "nope" as unknown as Record<
              string,
              string
            >,
          }),
          VARIABLE,
        ),
      ).toThrow("OPENTELEMETRY_COLLECTOR_HTTP_HEADERS must be an object");
    });
  });

  describe("plain HTTP warning", () => {
    it("warns exactly once when a bearer token is sent over http", () => {
      buildCollectorExporterOptions(
        "http://collector:4318/v1/traces",
        config({ OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "secret" }),
        VARIABLE,
      );

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0][0] as string;
      expect(message).toContain("plain HTTP");
      expect(message).not.toContain("secret");
    });

    it("does not warn for https with a bearer token", () => {
      buildCollectorExporterOptions(
        URL,
        config({ OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "secret" }),
        VARIABLE,
      );

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not warn for http without a bearer token", () => {
      buildCollectorExporterOptions(
        "http://collector:4318/v1/traces",
        config(),
        VARIABLE,
      );

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
