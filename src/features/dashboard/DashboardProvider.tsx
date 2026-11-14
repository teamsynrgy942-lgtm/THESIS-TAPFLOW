import { createContext, useContext, useMemo, useReducer } from 'react';
import type { Dispatch, ReactNode } from 'react';
import { createDemoDashboard, dashboardReducer } from './dashboard-model';
import type { DashboardAction, DashboardAlert, DashboardState, RoomId, RoomTelemetry, WaterInlet } from './dashboard-model';
import type { AlertRecord, MonitoringStatus } from '../alerts/alert-model';

interface DashboardActions {
  updateRoom: (roomId: RoomId, changes: Partial<RoomTelemetry>) => void;
  updateInlet: (changes: Partial<WaterInlet>) => void;
  replaceAlerts: (alerts: DashboardAlert[]) => void;
  replaceAlertRecords: (records: readonly AlertRecord[]) => void;
  setMonitoringStatus: (status: MonitoringStatus) => void;
}

const DashboardStateContext = createContext<DashboardState | null>(null);
const DashboardActionsContext = createContext<DashboardActions | null>(null);

function createActions(dispatch: Dispatch<DashboardAction>): DashboardActions {
  return {
    updateRoom: (roomId, changes) => dispatch({
      type: 'room/updated', roomId, changes, updatedAt: new Date().toISOString(),
    }),
    updateInlet: (changes) => dispatch({
      type: 'inlet/updated', changes, updatedAt: new Date().toISOString(),
    }),
    replaceAlerts: (alerts) => dispatch({
      type: 'alerts/replaced', alerts, updatedAt: new Date().toISOString(),
    }),
    replaceAlertRecords: (records) => dispatch({
      type: 'alerts/records-replaced', records, updatedAt: new Date().toISOString(),
    }),
    setMonitoringStatus: (status) => dispatch({ type: 'monitoring/status-updated', status }),
  };
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(dashboardReducer, undefined, createDemoDashboard);
  const actions = useMemo(() => createActions(dispatch), [dispatch]);

  return (
    <DashboardActionsContext value={actions}>
      <DashboardStateContext value={state}>{children}</DashboardStateContext>
    </DashboardActionsContext>
  );
}

export function useDashboardState(): DashboardState {
  const state = useContext(DashboardStateContext);
  if (!state) throw new Error('useDashboardState must be used within DashboardProvider');
  return state;
}

/** Future data adapters can call these actions without changing screen components. */
export function useDashboardActions(): DashboardActions {
  const actions = useContext(DashboardActionsContext);
  if (!actions) throw new Error('useDashboardActions must be used within DashboardProvider');
  return actions;
}
