import { useState } from "react";
import { useDataMode } from "../data-mode.ts";
import { getStatusData } from "../data/status.ts";
import { NOW } from "../now.ts";
import type { ServiceAlert, ServiceCapacity, User } from "../types.ts";
import { alertSeverityRoles } from "./labels.ts";
import type { ColorRole } from "./labels.ts";
import { useRefresh } from "./use-refresh.ts";
import type { Refresh } from "./use-refresh.ts";

export interface StatusAlert extends ServiceAlert {
  /** Stable in one scenario: the kind, the code, and the subject. */
  id: string;
  /**
   * `danger` for a critical alert, `warning` for a warning. The API today has
   * no severity, so every alert is a `warning` in `today` mode.
   */
  role: ColorRole;
  /** A person marked the alert as seen. It stays in the list. */
  acknowledged: boolean;
}

/**
 * `critical` when an open alert is critical, then `warning`, then `healthy`.
 * In `today` mode an alert has no severity, so the health is never `critical`.
 */
export type ServiceHealth = "healthy" | "warning" | "critical";

export const serviceHealthRoles: Record<ServiceHealth, ColorRole> = {
  healthy: "success",
  warning: "warning",
  critical: "danger",
};

export interface StatusCounts {
  /** The alerts in the list: every alert that is not dismissed. */
  total: number;
  critical: number;
  warning: number;
  /** Alerts in the list that are not acknowledged. */
  open: number;
  acknowledged: number;
  dismissed: number;
}

export interface StatusOptions {
  /** Milliseconds of a refresh. Defaults to 700. */
  refreshLatency?: number;
}

interface StatusBase extends Refresh {
  scenario: string;
}

export interface StatusLoading extends StatusBase {
  status: "loading";
}

export interface StatusError extends StatusBase {
  status: "error";
  message: string;
  reference?: string;
}

export interface StatusReady extends StatusBase {
  status: "ready";
  /** From the alerts that are not acknowledged and not dismissed. */
  health: ServiceHealth;
  /** The alerts that are not dismissed, most recently seen first. */
  alerts: StatusAlert[];
  /** The alerts that a person hid. `restore` brings one back. */
  dismissed: StatusAlert[];
  counts: StatusCounts;
  /** True when the service has more alerts than it returned. */
  hasMore: boolean;
  /** The time of the last check. A refresh sets it to the present. */
  checkedAt: number;
  capacity: ServiceCapacity | null;
  /** The recovery guide that every alert links to. */
  guideUrl: string;
  user: User;
  /**
   * Marks an alert as seen, or not seen with `false`. The app has no such
   * action today: its alert list is read-only.
   */
  acknowledge(id: string, acknowledged?: boolean): void;
  acknowledgeAll(): void;
  /** Hides an alert. The app has no such action today. */
  dismiss(id: string): void;
  /** Shows a dismissed alert again. Without an identifier: every alert. */
  restore(id?: string): void;
}

export type Status = StatusLoading | StatusError | StatusReady;

interface LocalState {
  scenario: string;
  /** Alert identifiers. */
  acknowledged: string[];
  dismissed: string[];
}

function createState(scenario: string): LocalState {
  return { scenario, acknowledged: [], dismissed: [] };
}

function getAlertId(alert: ServiceAlert): string {
  return `${alert.kind}:${alert.code}:${alert.subject}`;
}

/**
 * The state of the service status page for one scenario: the alerts with a
 * severity, local acknowledge and dismiss, the time of the last check, and a
 * simulated refresh.
 */
export function useStatus(scenario: string, { refreshLatency }: StatusOptions = {}): Status {
  const [state, setState] = useState(() => createState(scenario));
  if (state.scenario !== scenario) {
    setState(createState(scenario));
  }
  const refresh = useRefresh(scenario, refreshLatency);
  const mode = useDataMode();
  const data = getStatusData(scenario, mode);
  if (data.status === "loading") return { status: "loading", scenario, ...refresh };
  if (data.status === "error") {
    const { message, reference } = data;
    return { status: "error", scenario, message, ...(reference ? { reference } : {}), ...refresh };
  }

  const all = data.alerts.map((alert): StatusAlert => {
    const id = getAlertId(alert);
    return {
      ...alert,
      id,
      role: alertSeverityRoles[alert.severity ?? "warning"],
      acknowledged: state.acknowledged.includes(id),
    };
  });
  const alerts = all.filter((alert) => !state.dismissed.includes(alert.id));
  const dismissed = all.filter((alert) => state.dismissed.includes(alert.id));
  const open = alerts.filter((alert) => !alert.acknowledged);
  const critical = alerts.filter((alert) => alert.severity === "critical").length;
  const counts: StatusCounts = {
    total: alerts.length,
    critical,
    warning: alerts.length - critical,
    open: open.length,
    acknowledged: alerts.length - open.length,
    dismissed: dismissed.length,
  };
  let health: ServiceHealth = "healthy";
  if (open.some((alert) => alert.severity === "critical")) {
    health = "critical";
  } else if (open.length) {
    health = "warning";
  }
  const update = (change: (current: LocalState) => Partial<LocalState>) => {
    setState((current) => ({ ...current, ...change(current) }));
  };
  return {
    status: "ready",
    scenario,
    ...refresh,
    health,
    alerts,
    dismissed,
    counts,
    hasMore: data.hasMore,
    // The fixed present of the fixtures stands for the time of a refresh.
    checkedAt: refresh.refreshCount > 0 ? NOW : data.checkedAt,
    capacity: data.capacity,
    guideUrl: data.guideUrl,
    user: data.user,
    acknowledge: (id, acknowledged = true) => {
      update((current) => {
        const others = current.acknowledged.filter((entry) => entry !== id);
        return { acknowledged: acknowledged ? [...others, id] : others };
      });
    },
    acknowledgeAll: () => update(() => ({ acknowledged: all.map((alert) => alert.id) })),
    dismiss: (id) => {
      update((current) => ({
        dismissed: [...current.dismissed.filter((entry) => entry !== id), id],
      }));
    },
    restore: (id) => {
      update((current) => ({
        dismissed: id == null ? [] : current.dismissed.filter((entry) => entry !== id),
      }));
    },
  };
}
