import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_NETWORK_LOCAL_ADDRESS,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import * as os from "os";

const CACHED_HOSTNAME = os.hostname();

export function createOTelResource(
  serviceName: string,
  serviceVersion: string,
) {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    [ATTR_NETWORK_LOCAL_ADDRESS]: CACHED_HOSTNAME,
  });
}
