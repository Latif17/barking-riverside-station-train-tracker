// poller/src/rttClient.ts
import { computePeakPeriod } from './peakPeriod.js';
import { londonTimeToUtcIso } from './dateHelpers.js';
import type { Direction, ScheduledServiceRow } from './types.js';
import type { TokenProvider } from './rttAuth.js';

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

function directionsAndBlocks(
  service: RttService,
): Array<{ direction: Direction; block: RttIndividualTemporalData }> {
  const results: Array<{ direction: Direction; block: RttIndividualTemporalData }> = [];

  const arrival = service.temporalData?.arrival;
  if (arrival?.scheduleAdvertised) {
    results.push({ direction: 'arriving', block: arrival });
  }

  const departure = service.temporalData?.departure;
  if (departure?.scheduleAdvertised) {
    results.push({ direction: 'departing', block: departure });
  }

  return results;
}

export function mapRttServiceToRows(service: RttService): ScheduledServiceRow[] {
  const blocks = directionsAndBlocks(service);
  if (blocks.length === 0) return [];
  
  const rtt_uid = service.scheduleMetadata?.uniqueIdentity;
  if (!rtt_uid) return [];

  return blocks.map(({ direction, block }) => {
    const scheduled_time = new Date(block.scheduleAdvertised!).toISOString();
    const service_date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(
      new Date(scheduled_time),
    );
    const peak_period = computePeakPeriod(new Date(scheduled_time));
    const delay_minutes = Math.max(0, block.realtimeAdvertisedLateness ?? 0);

    let status: 'pending' | 'on_time' | 'delayed' | 'cancelled' = 'pending';

    if (block.isCancelled) {
      status = 'cancelled';
    } else if (delay_minutes > 0) {
      status = 'delayed';
    } else if (block.realtimeActual) {
      status = 'on_time';
    }

    return {
      service_date,
      direction,
      scheduled_time,
      peak_period,
      status,
      observed_time: block.realtimeActual ? new Date(block.realtimeActual).toISOString() : null,
      delay_minutes,
      rtt_uid,
    };
  });
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
    const body = await response.text().catch(() => '<unreadable body>');
    throw new Error(
      `RTT location request failed with status ${response.status} for ${url}: ${body}`,
    );
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

  return [...morning, ...evening].flatMap(mapRttServiceToRows);
}
