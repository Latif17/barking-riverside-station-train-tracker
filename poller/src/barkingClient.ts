// poller/src/barkingClient.ts
import type { TflPrediction } from './tflClient.js';

const GOSPEL_OAK_NAPTAN_ID = '910GGOSPLOK';

interface RawTflPrediction {
  vehicleId: string;
  lineId: string;
  destinationNaptanId: string;
  timeToStation: number;
  expectedArrival: string;
}

export async function fetchBarkingOutboundArrivals(
  barkingStopPointId: string,
  lineId: string,
  fetchFn: typeof fetch = fetch,
): Promise<TflPrediction[]> {
  const url = `https://api.tfl.gov.uk/StopPoint/${barkingStopPointId}/Arrivals`;
  const response = await fetchFn(url);

  if (!response.ok) {
    throw new Error(`TfL Arrivals request failed with status ${response.status}`);
  }

  const raw = (await response.json()) as RawTflPrediction[];

  return raw
    .filter((p) => p.lineId === lineId && p.destinationNaptanId === GOSPEL_OAK_NAPTAN_ID)
    .map((p) => ({
      vehicleId: p.vehicleId,
      destinationNaptanId: p.destinationNaptanId,
      timeToStation: p.timeToStation,
      expectedArrival: p.expectedArrival,
    }));
}
