export interface TflPrediction {
  vehicleId: string;
  destinationNaptanId: string;
  timeToStation: number;
  expectedArrival: string;
}

interface RawTflPrediction {
  vehicleId: string;
  destinationNaptanId: string;
  timeToStation: number;
  expectedArrival: string;
}

export async function fetchArrivals(
  stopPointId: string,
  fetchFn: typeof fetch = fetch,
): Promise<TflPrediction[]> {
  const url = `https://api.tfl.gov.uk/StopPoint/${stopPointId}/Arrivals`;
  const response = await fetchFn(url);

  if (!response.ok) {
    throw new Error(`TfL Arrivals request failed with status ${response.status}`);
  }

  const raw = (await response.json()) as RawTflPrediction[];

  return raw.map((p) => ({
    vehicleId: p.vehicleId,
    destinationNaptanId: p.destinationNaptanId,
    timeToStation: p.timeToStation,
    expectedArrival: p.expectedArrival,
  }));
}
