// poller/src/rttClient.ts
import { computePeakPeriod } from './peakPeriod.js';
import { londonTimeToUtcIso } from './dateHelpers.js';
import type { Direction, ScheduledServiceRow } from './types.js';
import type { TokenProvider } from './rttAuth.js';

const DELAY_THRESHOLD_MINUTES = 3;

export interface RttIndividualTemporalData {
  scheduleAdvertised?: string;
  realtimeActual?: string;
  realtimeForecast?: string;
  realtimeAdvertisedLateness?: number;
  isCancelled?: boolean;
}

export interface RttService {
  scheduleMetadata?: {
    uniqueIdentity?: string;
  };
  temporalData?: {
    arrival?: RttIndividualTemporalData | null;
    departure?: RttIndividualTemporalData | null;
  };
}

interface RttLocationResponse {
  services?: RttService[];
}

export interface RttClientConfig {
  rttBaseUrl: string;
  rttStationCode: string;
}

function directionAndBlock(
  service: RttService,
): { direction: Direction; block: RttIndividualTemporalData } | null {
  const arrival = service.temporalData?.arrival;
  if (arrival?.scheduleAdvertised) return { direction: 'arriving', block: arrival };

  const departure = service.temporalData?.departure;
  if (departure?.scheduleAdvertised) return { direction: 'departing', block: departure };

  return null;
}

export function mapRttServiceToRow(service: RttService): ScheduledServiceRow | null {
  const resolved = directionAndBlock(service);
  if (!resolved) return null;
  const { direction, block } = resolved;

  const scheduled_time = new Date(block.scheduleAdvertised!).toISOString();
  const service_date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(
    new Date(scheduled_time),
  );
  const peak_period = computePeakPeriod(new Date(scheduled_time));
  const rtt_uid = service.scheduleMetadata?.uniqueIdentity ?? null;

  if (block.isCancelled) {
    return { service_date, direction, scheduled_time, peak_period, status: 'cancelled', rtt_uid };
  }

  if (block.realtimeActual) {
    const delay_minutes = block.realtimeAdvertisedLateness ?? 0;
    return {
      service_date,
      direction,
      scheduled_time,
      peak_period,
      status: delay_minutes > DELAY_THRESHOLD_MINUTES ? 'delayed' : 'on_time',
      observed_time: new Date(block.realtimeActual).toISOString(),
      delay_minutes,
      rtt_uid,
    };
  }

  return { service_date, direction, scheduled_time, peak_period, status: 'pending', rtt_uid };
}

async function fetchLocationWindow(
  config: RttClientConfig,
  tokenProvider: TokenProvider,
  serviceDate: string,
  fromHhmm: string,
  toHhmm: string,
  fetchFn: typeof fetch,
): Promise<RttService[]> {
  const timeFrom = londonTimeToUtcIso(serviceDate, fromHhmm);
  const timeTo = londonTimeToUtcIso(serviceDate, toHhmm);
  const url = `${config.rttBaseUrl}/rtt/location?code=${config.rttStationCode}&timeFrom=${timeFrom}&timeTo=${timeTo}`;

  const request = (token: string) => fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });

  let token = await tokenProvider.getAccessToken();
  let response = await request(token);

  if (response.status === 401) {
    // The cached access token was rejected (e.g. it expired early, or was
    // revoked) — force a fresh one and retry exactly once before giving up.
    token = await tokenProvider.forceRefresh();
    response = await request(token);
  }

  if (response.status === 204) return [];
  if (!response.ok) {
    throw new Error(`RTT location request failed with status ${response.status}`);
  }

  const body = (await response.json()) as RttLocationResponse;
  return body.services ?? [];
}

export async function fetchTodayRows(
  config: RttClientConfig,
  tokenProvider: TokenProvider,
  serviceDate: string,
  fetchFn: typeof fetch = fetch,
): Promise<ScheduledServiceRow[]> {
  const [morning, evening] = await Promise.all([
    fetchLocationWindow(config, tokenProvider, serviceDate, '00:00', '12:00', fetchFn),
    fetchLocationWindow(config, tokenProvider, serviceDate, '12:00', '23:59', fetchFn),
  ]);

  return [...morning, ...evening]
    .map(mapRttServiceToRow)
    .filter((row): row is ScheduledServiceRow => row !== null);
}
