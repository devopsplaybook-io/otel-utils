import {
  createOTelResource,
  resolveResourceOptions,
} from "./utils/createResource";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_NETWORK_LOCAL_ADDRESS,
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

describe("createOTelResource", () => {
  it("should create a resource with the provided service name and version", () => {
    const resource = createOTelResource("test-service", "1.0.0");
    const attrs = resource.attributes;

    expect(attrs[ATTR_SERVICE_NAME]).toBe("test-service");
    expect(attrs[ATTR_SERVICE_VERSION]).toBe("1.0.0");
  });

  it("should include the local hostname as network local address", () => {
    const resource = createOTelResource("test-service", "1.0.0");
    const attrs = resource.attributes;

    expect(attrs[ATTR_NETWORK_LOCAL_ADDRESS]).toBeDefined();
    expect(typeof attrs[ATTR_NETWORK_LOCAL_ADDRESS]).toBe("string");
  });

  it("keeps the default attribute set unchanged when no options are given", () => {
    const attrs = createOTelResource("test-service", "1.0.0").attributes;

    expect(attrs[ATTR_SERVICE_INSTANCE_ID]).toBeUndefined();
    expect(attrs[ATTR_DEPLOYMENT_ENVIRONMENT_NAME]).toBeUndefined();
  });

  it("adds the opt-in instance id and deployment environment", () => {
    const attrs = createOTelResource("test-service", "1.0.0", {
      serviceInstanceId: "pod-7",
      deploymentEnvironmentName: "production",
    }).attributes;

    expect(attrs[ATTR_SERVICE_INSTANCE_ID]).toBe("pod-7");
    expect(attrs[ATTR_DEPLOYMENT_ENVIRONMENT_NAME]).toBe("production");
  });

  it("merges custom string, number and boolean resource attributes", () => {
    const attrs = createOTelResource("test-service", "1.0.0", {
      resourceAttributes: { region: "eu", replicas: 3, canary: true },
    }).attributes;

    expect(attrs.region).toBe("eu");
    expect(attrs.replicas).toBe(3);
    expect(attrs.canary).toBe(true);
  });

  it("lets the dedicated identity attributes win over the custom map", () => {
    const attrs = createOTelResource("test-service", "1.0.0", {
      serviceInstanceId: "real-instance",
      deploymentEnvironmentName: "production",
      resourceAttributes: {
        [ATTR_SERVICE_NAME]: "spoofed-service",
        [ATTR_SERVICE_VERSION]: "9.9.9",
        [ATTR_SERVICE_INSTANCE_ID]: "spoofed-instance",
        [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: "spoofed-env",
        [ATTR_NETWORK_LOCAL_ADDRESS]: "spoofed-host",
      },
    }).attributes;

    expect(attrs[ATTR_SERVICE_NAME]).toBe("test-service");
    expect(attrs[ATTR_SERVICE_VERSION]).toBe("1.0.0");
    expect(attrs[ATTR_SERVICE_INSTANCE_ID]).toBe("real-instance");
    expect(attrs[ATTR_DEPLOYMENT_ENVIRONMENT_NAME]).toBe("production");
    expect(attrs[ATTR_NETWORK_LOCAL_ADDRESS]).not.toBe("spoofed-host");
  });
});

describe("resolveResourceOptions", () => {
  it("normalizes the configured identity and resource attributes", () => {
    expect(
      resolveResourceOptions({
        SERVICE_INSTANCE_ID: "pod-7",
        DEPLOYMENT_ENVIRONMENT_NAME: "staging",
        OPENTELEMETRY_RESOURCE_ATTRIBUTES: { team: "platform" },
      }),
    ).toEqual({
      serviceInstanceId: "pod-7",
      deploymentEnvironmentName: "staging",
      resourceAttributes: { team: "platform" },
    });
  });

  it("omits blank identity values", () => {
    expect(
      resolveResourceOptions({
        SERVICE_INSTANCE_ID: "  ",
        DEPLOYMENT_ENVIRONMENT_NAME: "",
      }),
    ).toEqual({
      serviceInstanceId: undefined,
      deploymentEnvironmentName: undefined,
      resourceAttributes: {},
    });
  });

  it("throws for a non-string identity value", () => {
    expect(() =>
      resolveResourceOptions({
        SERVICE_INSTANCE_ID: 42 as unknown as string,
      }),
    ).toThrow("[otel-utils] SERVICE_INSTANCE_ID must be a string when set");
  });

  it("throws for a malformed resource attribute map", () => {
    expect(() =>
      resolveResourceOptions({
        OPENTELEMETRY_RESOURCE_ATTRIBUTES: {
          region: {} as unknown as string,
        },
      }),
    ).toThrow(
      '[otel-utils] OPENTELEMETRY_RESOURCE_ATTRIBUTES["region"] must be a string, number or boolean',
    );
  });
});
