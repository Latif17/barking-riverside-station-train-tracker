// poller/src/rttClient.ts
import { computePeakPeriod } from './peakPeriod.js';
import { londonTimeToUtcIso, londonIsoToUtcIso } from './dateHelpers.js';
import type { Direction, ScheduledServiceRow, ServiceStatus } from './types.js';
import type { TokenProvider } from './rttAuth.js';

export interface RttIndividualTemporalData {
  scheduleAdvertised?: string;
  realtimeActual?: string;
  realtimeForecast?: string;
  realtimeAdvertisedLateness?: number;
  isCancelled?: boolean;
  cancellationReasonCode?: string;
  cancellationReasonShortText?: string;
  latenessReasonCode?: string;
  latenessReasonShortText?: string;
}

export interface RttService {
  scheduleMetadata?: {
    uniqueIdentity?: string;
    inPassengerService?: boolean;
  };
  temporalData?: {
    arrival?: RttIndividualTemporalData | null;
    departure?: RttIndividualTemporalData | null;
  };
}

interface RttLocationResponse {
  services?: RttService[];
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
  if (service.scheduleMetadata?.inPassengerService === false) return [];

  return blocks.map(({ direction, block }) => {
    const scheduled_time = londonIsoToUtcIso(block.scheduleAdvertised!);
    const service_date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(
      new Date(scheduled_time),
    );
    const peak_period = computePeakPeriod(new Date(scheduled_time));
    const delay_minutes = block.realtimeAdvertisedLateness ?? 0;

    let status: ServiceStatus = 'pending';

    if (block.isCancelled) {
      status = 'cancelled';
    } else if (delay_minutes > 0) {
      status = 'delayed';
    } else if (delay_minutes < 0) {
      status = 'early';
    } else if (block.realtimeActual) {
      status = 'on_time';
    }

    return {
      service_date,
      direction,
      scheduled_time,
      peak_period,
      status,
      observed_time: block.realtimeActual ? londonIsoToUtcIso(block.realtimeActual) : null,
      delay_minutes,
      rtt_uid,
      cancel_reason: block.cancellationReasonShortText ?? block.cancellationReasonCode ?? null,
      delay_reason: block.latenessReasonShortText ?? block.latenessReasonCode ?? null,
    };
  });
}

async function fetchLocationWindow(
  baseUrl: string,
  tokenProvider: TokenProvider,
  serviceDate: string,
  fromHhmm: string,
  toHhmm: string,
  options: { code: string; filterTo?: string },
  fetchFn: typeof fetch,
): Promise<RttService[]> {
  const timeFrom = londonTimeToUtcIso(serviceDate, fromHhmm);
  const timeTo = londonTimeToUtcIso(serviceDate, toHhmm);
  let url = `${baseUrl}/rtt/location?code=${options.code}&timeFrom=${timeFrom}&timeTo=${timeTo}`;

  if (options.filterTo) {
    url += `&filterTo=${options.filterTo}`;
  }

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
  baseUrl: string,
  tokenProvider: TokenProvider,
  serviceDate: string,
  options: { code: string; filterTo?: string },
  fetchFn: typeof fetch = fetch,
): Promise<ScheduledServiceRow[]> {
  const allRttServices = await fetchLocationWindow(baseUrl, tokenProvider, serviceDate, '00:00', '23:59', options, fetchFn);

  const rows: ScheduledServiceRow[] = [];
  for (const s of allRttServices) {
    const mappedRows = mapRttServiceToRows(s);
    rows.push(...mappedRows);
  }

  return rows;
}

