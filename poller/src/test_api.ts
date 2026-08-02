import { loadConfig } from './config.js';
import { createTokenProvider } from './rttAuth.js';
import { londonTimeToUtcIso, todayLondon } from './dateHelpers.js';

async function main() {
  const config = loadConfig();
  const tokenProvider = createTokenProvider({
    baseUrl: config.rttBaseUrl,
    refreshToken: config.rttRefreshToken,
  });
  
  const token = await tokenProvider.getAccessToken();
  const serviceDate = todayLondon();
  const timeFrom = londonTimeToUtcIso(serviceDate, '12:00');
  const timeTo = londonTimeToUtcIso(serviceDate, '14:00');
  
  const url = `${config.rttBaseUrl}/rtt/location?code=${config.rttStationCode}&timeFrom=${timeFrom}&timeTo=${timeTo}`;
  console.log('Fetching', url);
  
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  
  if (data.services && data.services.length > 0) {
    console.log(JSON.stringify(data.services[0], null, 2));
  }
}
main();
