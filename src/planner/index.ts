import type { WorkspaceDocument } from '../schema/galgame-workspace.js';

export interface PlannerTools {
  output_with_plan(plan: string): Promise<void>;
  output_with_finish(taskSummary: string): Promise<void>;
  read_from_uri(uri: string): Promise<WorkspaceDocument>;
}
