import type { Database } from "../db";

export type MaintenanceCheckpointValue = boolean | number | string | null | MaintenanceCheckpoint;
export interface MaintenanceCheckpoint {
  [key: string]: MaintenanceCheckpointValue;
}

export async function loadMaintenanceCheckpoint(db: Database, jobName: string): Promise<MaintenanceCheckpoint | null> {
  const [row] = await db.sql<{ checkpoint: unknown }[]>`
    select checkpoint from app_private.maintenance_checkpoints where job_name = ${jobName}
  `;
  if (!row || typeof row.checkpoint !== "object" || row.checkpoint === null || Array.isArray(row.checkpoint)) return null;
  return row.checkpoint as MaintenanceCheckpoint;
}

export async function saveMaintenanceCheckpoint(
  db: Database,
  jobName: string,
  checkpoint: MaintenanceCheckpoint,
): Promise<void> {
  await db.sql`
    insert into app_private.maintenance_checkpoints (job_name, checkpoint, updated_at)
    values (${jobName}, ${JSON.stringify(checkpoint)}::jsonb, now())
    on conflict (job_name) do update
      set checkpoint = excluded.checkpoint, updated_at = excluded.updated_at
  `;
}
