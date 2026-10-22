import type { ConfigOTelInterface } from "../models/ConfigOTelInterface";
import {
  normalizeConsoleLogMode,
  normalizeExportIntervalSeconds,
  normalizePositiveInteger,
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
});
