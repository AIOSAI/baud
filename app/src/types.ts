/** Mirrors `BranchStatus` in src-tauri/src/lib.rs. */
export interface BranchStatus {
  name: string;
  is_citizen: boolean;
  working: boolean;
  new_mail: number;
  active_plans: number;
  action_required: boolean;
  summary: string;
  last_updated: string;
}

/** Mirrors `FleetSnapshot` in src-tauri/src/lib.rs. */
export interface FleetSnapshot {
  aipass_root: string;
  generated_at: string;
  error: string | null;
  branches: BranchStatus[];
}
