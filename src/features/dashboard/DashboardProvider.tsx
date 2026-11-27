import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { R1AlertNotification } from '../../components/alerts/R1AlertNotification';
import { useR1AlertFeed } from '../alerts/use-r1-alert-feed';
import { createDashboardState } from './dashboard-model';
import type { DashboardState } from './dashboard-model';

interface DashboardContextValue extends DashboardState {
  alertFeed: Pick<ReturnType<typeof useR1AlertFeed>, 'loading' | 'error' | 'connection' | 'refreshAlerts'>;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const feed = useR1AlertFeed();
  const state = useMemo(() => createDashboardState(feed.records), [feed.records]);

  return (
    <DashboardContext value={{ ...state, alertFeed: feed }}>
      {children}
      {feed.notification && <R1AlertNotification record={feed.notification} rooms={state.rooms}
        count={feed.notificationCount} onDismiss={feed.dismissNotification} />}
    </DashboardContext>
  );
}

export function useDashboardState(): DashboardContextValue {
  const state = useContext(DashboardContext);
  if (!state) throw new Error('useDashboardState must be used within DashboardProvider');
  return state;
}
