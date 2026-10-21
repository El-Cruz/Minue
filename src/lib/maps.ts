import type { Destination } from './types';

export function googleMapsDirections(destination: Pick<Destination, 'address' | 'city'>): string {
  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.address.trim()}, ${destination.city.trim()}`,
    travelmode: 'driving',
  });
  return `https://www.google.com/maps/dir/?${params}`;
}
