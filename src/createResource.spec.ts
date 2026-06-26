import { createOTelResource } from "./utils/createResource";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_NETWORK_LOCAL_ADDRESS } from "@opentelemetry/semantic-conventions";

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
});
