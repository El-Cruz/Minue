import { Navigation } from 'lucide-react';
import { googleMapsDirections } from '../lib/maps';
import type { Destination } from '../lib/types';

export default function GoogleMapsLink({ destination }: { destination: Pick<Destination, 'name' | 'address'> }) {
  return <a
    className="button subtle full maps-link"
    href={googleMapsDirections(destination)}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={`Cómo llegar a ${destination.name} en Google Maps`}
  ><Navigation size={17} aria-hidden="true" />Cómo llegar · Google Maps</a>;
}
