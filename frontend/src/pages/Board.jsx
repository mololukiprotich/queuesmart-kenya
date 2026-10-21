import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Radio } from "lucide-react";
import { api } from "../api";
import QueueOverview from "../components/QueueOverview";

/**
 * Standalone, no-login waiting-room signage view — meant for a TV/monitor
 * in the branch lobby, not a citizen's phone. Same QueueOverview component
 * the citizen flow uses (built branch-shaped specifically so it could
 * serve both), just given a full-bleed, large-type layout instead of
 * sitting inside the narrow `.panel` card shell.
 */
export default function Board() {
  const { branchId } = useParams();
  const [branchName, setBranchName] = useState("");

  useEffect(() => {
    api.listBranches()
      .then((branches) => {
        const match = branches.find((b) => b.id === branchId);
        if (match) setBranchName(match.name);
      })
      .catch(() => {});
  }, [branchId]);

  return (
    <div className="board">
      <div className="board-header">
        <span className="board-brand"><Radio size={22} strokeWidth={2.5} aria-hidden="true" /> QueueSmart</span>
        <span className="board-branch">{branchName || "Live queue status"}</span>
      </div>
      <QueueOverview branchId={branchId} />
    </div>
  );
}
