import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_NETWORK_LOCAL_ADDRESS,
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import * as os from "os";
import type {
  ConfigOTelInterface,
  ResourceAttributeValue,
} from "../models/ConfigOTelInterface";
import {
  normalizeOptionalIdentityValue,
  normalizeResourceAttributes,
} from "./configValidation";

const CACHED_HOSTNAME = os.hostname();

export interface CreateOTelResourceOptions {
  serviceInstanceId?: string;
  deploymentEnvironmentName?: string;
  resourceAttributes?: Record<string, ResourceAttributeValue>;
}

export function createOTelResource(
  serviceName: string,
  serviceVersion: string,
  options: CreateOTelResourceOptions = {},
) {
  // Custom attributes are applied first; the dedicated identity fields below
  // win so identity cannot be overridden by the custom map.
  const attributes: Record<string, ResourceAttributeValue> = {
    ...options.resourceAttributes,
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    [ATTR_NETWORK_LOCAL_ADDRESS]: CACHED_HOSTNAME,
  };
  if (options.serviceInstanceId !== undefined) {
    attributes[ATTR_SERVICE_INSTANCE_ID] = options.serviceInstanceId;
  }
  if (options.deploymentEnvironmentName !== undefined) {
    attributes[ATTR_DEPLOYMENT_ENVIRONMENT_NAME] =
      options.deploymentEnvironmentName;
  }
  return resourceFromAttributes(attributes);
}

export function resolveResourceOptions(
  config: Pick<
    ConfigOTelInterface,
    | "SERVICE_INSTANCE_ID"
    | "DEPLOYMENT_ENVIRONMENT_NAME"
    | "OPENTELEMETRY_RESOURCE_ATTRIBUTES"
  >,
): CreateOTelResourceOptions {
  return {
    serviceInstanceId: normalizeOptionalIdentityValue(
      config.SERVICE_INSTANCE_ID,
      "SERVICE_INSTANCE_ID",
    ),
    deploymentEnvironmentName: normalizeOptionalIdentityValue(
      config.DEPLOYMENT_ENVIRONMENT_NAME,
      "DEPLOYMENT_ENVIRONMENT_NAME",
    ),
    resourceAttributes: normalizeResourceAttributes(
      config.OPENTELEMETRY_RESOURCE_ATTRIBUTES,
    ),
  };
}
