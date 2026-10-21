import { createContext, useContext } from 'react';
import type { Data, Profile } from './types';
export type AppContextValue = {
  data: Data; user: Profile; demo: boolean; busy: boolean; online: boolean;
  run: (action: string, payload: Record<string, unknown>) => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  download: (deliveryId: string) => Promise<void>;
};
export const AppContext = createContext<AppContextValue>(null!);
export function useApp() { return useContext(AppContext); }
