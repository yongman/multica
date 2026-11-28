import { useQueryClient } from "@tanstack/react-query";
import { squadListOptions } from "@/data/queries/squads";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";

/** Squad events can contain a full squad or just a roster/archival delta.
 * Refetch the directory so every picker and selected creator sees the same
 * authoritative leader, archive state, and member count after reconnect too. */
export function useSquadsRealtime() {
  const qc = useQueryClient();
  useWSSubscriptions(
    (ws, wsId) => {
      const refresh = () =>
        qc.invalidateQueries({ queryKey: squadListOptions(wsId).queryKey });
      return [
        ws.on("squad:created", refresh),
        ws.on("squad:updated", refresh),
        // The server uses deleted for archival as well.
        ws.on("squad:deleted", refresh),
        ws.onReconnect(refresh),
      ];
    },
    [qc],
  );
}
