export type Direction = 'departing' | 'arriving';

const GOSPEL_OAK_NAPTAN_ID = '910GGOSPLOK';
const BARKING_RIVERSIDE_NAPTAN_ID = '910GBARKRIV';

export function directionFromDestinationNaptanId(naptanId: string): Direction | null {
  if (naptanId === GOSPEL_OAK_NAPTAN_ID) return 'departing';
  if (naptanId === BARKING_RIVERSIDE_NAPTAN_ID) return 'arriving';
  return null;
}
