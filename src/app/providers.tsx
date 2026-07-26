import { QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { DataClientProvider } from '../lib/data';
import { queryClient } from '../lib/query-client';
import { AuthProvider } from '../features/auth/AuthProvider';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DataClientProvider>{children}</DataClientProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
