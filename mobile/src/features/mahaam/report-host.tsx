import * as Haptics from "expo-haptics";
import { useSegments } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { screenName } from "@/lib/analytics";
import { useAuth } from "@/providers/auth";

import { captureCurrentScreen } from "./capture";
import { setCurrentRoute, setReporterEmail } from "./diagnostics";
import { ReportSheet, type ReportRequest } from "./report-sheet";
import { useShakeToReport } from "./shake";

export type OpenReportOptions = ReportRequest & {
  /** Screenshot the current screen first (before the sheet renders, so it is not in the picture). */
  captureScreen?: boolean;
};

let opener: ((options: OpenReportOptions) => void) | null = null;

/** Opens the Report a problem / Send feedback sheet from anywhere (a settings row, the shake gesture). */
export function openReport(options: OpenReportOptions = {}): void {
  opener?.(options);
}

/**
 * Mount once in the root Shell (inside the router and the auth provider). Keeps
 * the reporter context current — the route PATTERN (never an id) and the
 * signed-in email used to pre-fill the reply field — hosts the sheet and
 * listens for shake-to-report.
 */
export function MahaamReportHost() {
  const segments = useSegments();
  const { user, token } = useAuth();
  const [state, setState] = useState<{ open: boolean; request: ReportRequest }>({ open: false, request: {} });
  // Open, or capturing on the way to open: a second shake / tap does nothing.
  const busy = useRef(false);

  const route = screenName(segments);
  useEffect(() => setCurrentRoute(route), [route]);
  useEffect(() => setReporterEmail(user?.email), [user?.email]);

  useEffect(() => {
    opener = ({ captureScreen, ...request }) => {
      if (busy.current) return;
      busy.current = true;
      void (async () => {
        const screenshot = captureScreen ? await captureCurrentScreen() : null;
        setState({ open: true, request: screenshot ? { ...request, screenshot } : request });
      })();
    };
    return () => {
      opener = null;
    };
  }, []);

  useShakeToReport({
    signedIn: !!token,
    blocked: () => busy.current,
    onShake: () => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      openReport({ kind: "bug", captureScreen: true });
    },
  });

  return (
    <ReportSheet
      open={state.open}
      request={state.request}
      onClose={() => {
        busy.current = false;
        setState((s) => ({ ...s, open: false }));
      }}
    />
  );
}
