import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import type { SurveyDataClient } from './contracts';
import { createMockDataClient } from './mock-data-client';
import { createSupabaseDataClient } from './supabase-data-client';
import { publicEnv } from '../env';
import { getSupabaseClient } from '../supabase';

const DataClientContext = createContext<SurveyDataClient | null>(null);

export interface DataClientProviderProps extends PropsWithChildren {
  client?: SurveyDataClient;
}

export function DataClientProvider({ client, children }: DataClientProviderProps) {
  const value = useMemo(
    () => client ?? (publicEnv.dataMode === 'supabase' ? createSupabaseDataClient(getSupabaseClient()) : createMockDataClient()),
    [client],
  );
  return <DataClientContext.Provider value={value}>{children}</DataClientContext.Provider>;
}

export function useDataClient(): SurveyDataClient {
  const client = useContext(DataClientContext);
  if (!client) throw new Error('useDataClient 必须在 DataClientProvider 内使用');
  return client;
}
