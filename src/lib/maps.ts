import type { Destination } from './types';
import { DESTINATION_CITY } from './location';

export function googleMapsDirections(destination: Pick<Destination, 'address'>): string {
  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.address.trim()}, ${DESTINATION_CITY}`,
    travelmode: 'driving',
  });
  return `https://www.google.com/maps/dir/?${params}`;
}
