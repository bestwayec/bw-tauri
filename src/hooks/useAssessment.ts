import { useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ASSESSMENT_POLL_INTERVAL,
  getAssessment,
  shouldPollAssessment,
  type AssessmentAttempt,
} from "@/lib/assessment";
import { useSessionStore } from "@/lib/session-store";

/**
 * Assessment status and feedback for one attempt.
 *
 * Polling is deliberately bounded (see `shouldPollAssessment`: 15s apart, at
 * most 20 times, for 5 minutes) and stops on any error — a finished attempt
 * must never turn into a background request loop. Several components may hold
 * this for the same attempt; react-query dedupes them into one query.
 */
export function useAssessment(attemptId: string | null, enabled = true) {
  const userId = useSessionStore((state) => state.profile?.id);
  const windowStart = useRef(Date.now());
  const successfulRequests = useRef(0);

  const query = useQuery({
    queryKey: ["assessment", userId ?? null, attemptId],
    enabled: enabled && !!attemptId,
    queryFn: async (): Promise<AssessmentAttempt> => {
      const data = await getAssessment(attemptId as string);
      successfulRequests.current += 1;
      return data;
    },
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (state) =>
      state.state.error
        ? false
        : shouldPollAssessment(
            state.state.data,
            Math.max(0, successfulRequests.current - 1),
            Date.now() - windowStart.current,
          )
          ? ASSESSMENT_POLL_INTERVAL
          : false,
  });

  /** Ask again now: restarts the poll budget so the student can wait longer. */
  const refresh = useCallback(() => {
    windowStart.current = Date.now();
    successfulRequests.current = 0;
    void query.refetch();
  }, [query]);

  return { query, refresh };
}
