import type { ConfigOTelInterface } from "../models/ConfigOTelInterface";
import {
  normalizeCompression,
  normalizeConsoleLogMode,
  normalizeExportIntervalSeconds,
  normalizeHeaders,
  normalizeLogLevel,
  normalizeOptionalIdentityValue,
  normalizePositiveInteger,
  normalizeResourceAttributes,
  resolveMetricExportTimeout,
  resolveTraceSampler,
  validateCollectorUrl,
  validateServiceIdentity,
} from "./configValidation";

type ServiceIdentity = Pick<ConfigOTelInterface, "SERVICE_ID" | "VERSION">;

function identity(serviceId: unknown, version: unknown): ServiceIdentity {
  return {
    SERVICE_ID: serviceId,
    VERSION: version,
  } as ServiceIdentity;
}

describe("configValidation", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("validateServiceIdentity", () => {
    it("accepts non-empty SERVICE_ID and VERSION", () => {
      expect(() =>
        validateServiceIdentity(identity("my-service", "1.2.3")),
      ).not.toThrow();
    });

    it("rejects an empty SERVICE_ID", () => {
      expect(() => validateServiceIdentity(identity("", "1.2.3"))).toThrow(
        "[otel-utils] SERVICE_ID must be a non-empty string",
      );
    });

    it("rejects a whitespace-only SERVICE_ID", () => {
      expect(() => validateServiceIdentity(identity("   ", "1.2.3"))).toThrow(
        "[otel-utils] SERVICE_ID must be a non-empty string",
      );
    });

    it("rejects a missing SERVICE_ID", () => {
      expect(() =>
        validateServiceIdentity(identity(undefined, "1.2.3")),
      ).toThrow("[otel-utils] SERVICE_ID must be a non-empty string");
    });

    it("rejects a non-string SERVICE_ID", () => {
      expect(() => validateServiceIdentity(identity(42, "1.2.3"))).toThrow(
        "[otel-utils] SERVICE_ID must be a non-empty string",
      );
    });

    it("rejects an empty VERSION", () => {
      expect(() => validateServiceIdentity(identity("my-service", ""))).toThrow(
        "[otel-utils] VERSION must be a non-empty string",
      );
    });

    it("rejects a whitespace-only VERSION", () => {
      expect(() =>
        validateServiceIdentity(identity("my-service", "  ")),
      ).toThrow("[otel-utils] VERSION must be a non-empty string");
    });

    it("rejects a missing VERSION", () => {
      expect(() =>
        validateServiceIdentity(identity("my-service", undefined)),
      ).toThrow("[otel-utils] VERSION must be a non-empty string");
    });

    it("rejects a non-string VERSION", () => {
      expect(() => validateServiceIdentity(identity("my-service", 1))).toThrow(
        "[otel-utils] VERSION must be a non-empty string",
      );
    });
  });

  describe("normalizeExportIntervalSeconds", () => {
    it("returns the default for missing or non-finite values", () => {
      expect(normalizeExportIntervalSeconds(undefined, 60)).toBe(60);
      expect(normalizeExportIntervalSeconds(NaN, 60)).toBe(60);
      expect(normalizeExportIntervalSeconds(Infinity, 60)).toBe(60);
      expect(normalizeExportIntervalSeconds(-Infinity, 60)).toBe(60);
    });

    it("clamps finite values below one second", () => {
      expect(normalizeExportIntervalSeconds(0, 60)).toBe(1);
      expect(normalizeExportIntervalSeconds(-1, 60)).toBe(1);
      expect(normalizeExportIntervalSeconds(0.5, 60)).toBe(1);
    });

    it("keeps values of at least one second", () => {
      expect(normalizeExportIntervalSeconds(1, 60)).toBe(1);
      expect(normalizeExportIntervalSeconds(5, 60)).toBe(5);
    });
  });

  describe("normalizePositiveInteger", () => {
    it("returns the default for missing or invalid values", () => {
      expect(normalizePositiveInteger(undefined, 2048)).toBe(2048);
      expect(normalizePositiveInteger(NaN, 2048)).toBe(2048);
      expect(normalizePositiveInteger(Infinity, 2048)).toBe(2048);
      expect(normalizePositiveInteger(0, 2048)).toBe(2048);
      expect(normalizePositiveInteger(-1, 2048)).toBe(2048);
      expect(normalizePositiveInteger(1.5, 2048)).toBe(2048);
    });

    it("keeps positive integers", () => {
      expect(normalizePositiveInteger(1024, 2048)).toBe(1024);
    });
  });

  describe("normalizeConsoleLogMode", () => {
    it("passes the three valid modes through", () => {
      expect(normalizeConsoleLogMode("always")).toBe("always");
      expect(normalizeConsoleLogMode("fallback")).toBe("fallback");
      expect(normalizeConsoleLogMode("never")).toBe("never");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("defaults to always when undefined without warning", () => {
      expect(normalizeConsoleLogMode(undefined)).toBe("always");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns once and defaults to always for invalid values", () => {
      expect(normalizeConsoleLogMode("sometimes")).toBe("always");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("OPENTELEMETRY_CONSOLE_LOG_MODE"),
      );
    });
  });

  describe("validateCollectorUrl", () => {
    const variableName = "OPENTELEMETRY_COLLECTOR_HTTP_TRACES";

    it("accepts http and https URLs", () => {
      expect(() =>
        validateCollectorUrl("http://collector:4318/v1/traces", variableName),
      ).not.toThrow();
      expect(() =>
        validateCollectorUrl("https://example.com/v1/traces", variableName),
      ).not.toThrow();
    });

    it("rejects a malformed URL naming the field", () => {
      expect(() => validateCollectorUrl("not a url", variableName)).toThrow(
        `[otel-utils] ${variableName} must be a valid http(s) URL, got "not a url"`,
      );
      expect(() => validateCollectorUrl("http://", variableName)).toThrow(
        `[otel-utils] ${variableName} must be a valid http(s) URL, got "http://"`,
      );
      expect(() =>
        validateCollectorUrl("collector:4318", variableName),
      ).toThrow(
        `[otel-utils] ${variableName} must be a valid http(s) URL, got "collector:4318"`,
      );
    });

    it("rejects a non-http(s) URL naming the field", () => {
      expect(() =>
        validateCollectorUrl("ftp://collector/v1/traces", variableName),
      ).toThrow(
        `[otel-utils] ${variableName} must be a valid http(s) URL, got "ftp://collector/v1/traces"`,
      );
    });

    it("rejects empty and non-string values as non-empty URLs", () => {
      expect(() => validateCollectorUrl("", variableName)).toThrow(
        `[otel-utils] ${variableName} must be a non-empty valid http(s) URL, got ""`,
      );
      expect(() => validateCollectorUrl("   ", variableName)).toThrow(
        `[otel-utils] ${variableName} must be a non-empty valid http(s) URL, got "   "`,
      );
      expect(() => validateCollectorUrl(42, variableName)).toThrow(
        `[otel-utils] ${variableName} must be a non-empty valid http(s) URL, got "42"`,
      );
      expect(() => validateCollectorUrl(undefined, variableName)).toThrow(
        `[otel-utils] ${variableName} must be a non-empty valid http(s) URL, got "undefined"`,
      );
    });
  });

  describe("normalizeHeaders", () => {
    it("returns an empty object when undefined", () => {
      expect(normalizeHeaders(undefined)).toEqual({});
    });

    it("returns a shallow copy of a valid header map", () => {
      const input = { "X-Tenant": "acme", "X-Trace": "1" };
      const result = normalizeHeaders(input);
      expect(result).toEqual(input);
      expect(result).not.toBe(input);
    });

    it("rejects non-object values", () => {
      for (const invalid of [null, "headers", 42, ["a"]]) {
        expect(() => normalizeHeaders(invalid)).toThrow(
          "[otel-utils] OPENTELEMETRY_COLLECTOR_HTTP_HEADERS must be an object mapping header names to strings",
        );
      }
    });

    it("rejects non-string header values naming the key", () => {
      expect(() => normalizeHeaders({ "X-Tenant": 42 })).toThrow(
        '[otel-utils] OPENTELEMETRY_COLLECTOR_HTTP_HEADERS["X-Tenant"] must be a string',
      );
    });
  });

  describe("normalizeCompression", () => {
    it("passes gzip and none through without warning", () => {
      expect(normalizeCompression("gzip")).toBe("gzip");
      expect(normalizeCompression("none")).toBe("none");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("defaults to none when undefined without warning", () => {
      expect(normalizeCompression(undefined)).toBe("none");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns once and defaults to none for invalid values", () => {
      expect(normalizeCompression("br")).toBe("none");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("OPENTELEMETRY_COLLECTOR_HTTP_COMPRESSION"),
      );
    });
  });

  describe("resolveMetricExportTimeout", () => {
    it("keeps a timeout below or equal to the interval without warning", () => {
      expect(resolveMetricExportTimeout(10000, 60000)).toBe(10000);
      expect(resolveMetricExportTimeout(5000, 5000)).toBe(5000);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("clamps a timeout above the interval and warns once", () => {
      expect(resolveMetricExportTimeout(30000, 5000)).toBe(5000);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("clamping the export timeout to 5000 ms"),
      );
    });
  });

  describe("resolveTraceSampler", () => {
    it("defaults to parentbased_always_on without warning", () => {
      expect(resolveTraceSampler(undefined, undefined)).toEqual({
        sampler: "parentbased_always_on",
        ratio: 1,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("treats a blank sampler as unset", () => {
      expect(resolveTraceSampler("   ", undefined)).toEqual({
        sampler: "parentbased_always_on",
        ratio: 1,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it.each([
      "always_on",
      "always_off",
      "traceidratio",
      "parentbased_always_on",
      "parentbased_always_off",
      "parentbased_traceidratio",
    ] as const)("accepts the %p sampler", (sampler) => {
      expect(resolveTraceSampler(sampler, 0.5)).toEqual({
        sampler,
        ratio: sampler.includes("traceidratio") ? 0.5 : 1,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns once and falls back to parentbased_always_on for an invalid sampler", () => {
      expect(resolveTraceSampler("sometimes", undefined)).toEqual({
        sampler: "parentbased_always_on",
        ratio: 1,
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("OPENTELEMETRY_TRACES_SAMPLER"),
      );
    });

    it.each(["traceidratio", "parentbased_traceidratio"] as const)(
      "accepts the 0 and 1 ratio boundaries for %p",
      (sampler) => {
        expect(resolveTraceSampler(sampler, 0).ratio).toBe(0);
        expect(resolveTraceSampler(sampler, 1).ratio).toBe(1);
        expect(warnSpy).not.toHaveBeenCalled();
      },
    );

    it.each(["traceidratio", "parentbased_traceidratio"] as const)(
      "warns once and defaults the ratio to 1 when it is missing for %p",
      (sampler) => {
        expect(resolveTraceSampler(sampler, undefined).ratio).toBe(1);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("OPENTELEMETRY_TRACES_SAMPLER_ARG"),
        );
      },
    );

    it.each([-0.1, 1.1, NaN, Infinity, "0.5"])(
      "warns once and defaults the ratio to 1 for the invalid value %p",
      (ratio) => {
        expect(resolveTraceSampler("traceidratio", ratio).ratio).toBe(1);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("OPENTELEMETRY_TRACES_SAMPLER_ARG"),
        );
      },
    );

    it("ignores the ratio for non-ratio samplers without warning", () => {
      expect(resolveTraceSampler("always_on", 5)).toEqual({
        sampler: "always_on",
        ratio: 1,
      });
      expect(resolveTraceSampler("parentbased_always_off", "nope")).toEqual({
        sampler: "parentbased_always_off",
        ratio: 1,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("normalizeResourceAttributes", () => {
    it("returns an empty object when undefined", () => {
      expect(normalizeResourceAttributes(undefined)).toEqual({});
    });

    it("returns a shallow copy of a valid attribute map", () => {
      const input = { "deployment.tier": "web", replicas: 2, canary: true };
      const result = normalizeResourceAttributes(input);
      expect(result).toEqual(input);
      expect(result).not.toBe(input);
    });

    it("rejects non-object containers", () => {
      for (const invalid of [null, "attrs", 42, ["a"]]) {
        expect(() => normalizeResourceAttributes(invalid)).toThrow(
          "[otel-utils] OPENTELEMETRY_RESOURCE_ATTRIBUTES must be an object mapping attribute names to string, number or boolean values",
        );
      }
    });

    it.each([{ nested: {} }, NaN, Infinity, null])(
      "rejects the invalid value %p naming the key",
      (invalidValue) => {
        expect(() =>
          normalizeResourceAttributes({ region: invalidValue }),
        ).toThrow(
          '[otel-utils] OPENTELEMETRY_RESOURCE_ATTRIBUTES["region"] must be a string, number or boolean',
        );
      },
    );
  });

  describe("normalizeOptionalIdentityValue", () => {
    it("returns undefined when unset or blank", () => {
      expect(
        normalizeOptionalIdentityValue(undefined, "SERVICE_INSTANCE_ID"),
      ).toBeUndefined();
      expect(
        normalizeOptionalIdentityValue("   ", "SERVICE_INSTANCE_ID"),
      ).toBeUndefined();
    });

    it("passes a non-empty string through", () => {
      expect(
        normalizeOptionalIdentityValue("pod-1", "SERVICE_INSTANCE_ID"),
      ).toBe("pod-1");
    });

    it("throws for a non-string value naming the variable", () => {
      expect(() =>
        normalizeOptionalIdentityValue(42, "DEPLOYMENT_ENVIRONMENT_NAME"),
      ).toThrow(
        "[otel-utils] DEPLOYMENT_ENVIRONMENT_NAME must be a string when set",
      );
    });
  });

  describe("normalizeLogLevel", () => {
    it("passes the five valid levels through", () => {
      expect(normalizeLogLevel("trace")).toBe("trace");
      expect(normalizeLogLevel("debug")).toBe("debug");
      expect(normalizeLogLevel("info")).toBe("info");
      expect(normalizeLogLevel("warn")).toBe("warn");
      expect(normalizeLogLevel("error")).toBe("error");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("defaults to info when undefined without warning", () => {
      expect(normalizeLogLevel(undefined)).toBe("info");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns once and defaults to info for invalid values", () => {
      expect(normalizeLogLevel("verbose")).toBe("info");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("OPENTELEMETRY_LOG_LEVEL"),
      );
    });
  });
});
