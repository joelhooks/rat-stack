import { INTAKE_TABLE } from "./intake-rows.js";

export const intakeApplicationsQuery = (table = `default.${INTAKE_TABLE}`) =>
  `WITH intake_rows AS (
  SELECT
    json_get_str(value, 'kind') AS kind,
    json_get_str(value, 'actor') AS actor,
    json_get_str(value, 'submissionId') AS submission_id,
    json_get_str(value, 'timestamp') AS happened_at,
    json_get_str(value, 'object') AS object,
    json_get_str(value, 'verb') AS verb,
    value
  FROM ${table}
  WHERE json_get_str(value, 'intake') = 'tokenmaxx'
  QUALIFY row_number() OVER (
    PARTITION BY json_get_str(value, 'id')
    ORDER BY json_get_str(value, 'recordedAt')
  ) = 1
),
erased AS (
  SELECT DISTINCT actor FROM intake_rows WHERE kind = 'erased'
)
SELECT
  submission_id,
  min(happened_at) AS submitted_at,
  max(CASE WHEN kind = 'contact' THEN json_get_str(value, 'name') END) AS name,
  max(CASE WHEN kind = 'contact' THEN json_get_str(value, 'email') END) AS email,
  max(CASE WHEN kind = 'contact' THEN json_get_str(value, 'x') END) AS x,
  max(CASE WHEN kind = 'contact' THEN json_get_str(value, 'agentRef') END) AS agent,
  max(CASE WHEN object = 'tokenmaxx/questions/building' THEN json_get_str(value, 'result') END) AS building,
  max(CASE WHEN object = 'tokenmaxx/questions/today' THEN json_get_str(value, 'result') END) AS today,
  max(CASE WHEN object = 'tokenmaxx/questions/leaveWith' THEN json_get_str(value, 'result') END) AS leave_with,
  bool_or(CASE WHEN object = 'tokenmaxx/consents/share' THEN json_get_bool(value, 'result') END) AS share,
  bool_or(CASE WHEN verb = 'submitted' THEN json_get_bool(value, 'result', 'held') END) AS held,
  max(CASE WHEN verb = 'submitted' THEN CAST(json_as_text(value, 'result', 'score') AS DOUBLE) END) AS score,
  max(CASE WHEN verb = 'submitted' THEN json_get_json(value, 'result', 'signals') END) AS signals
FROM intake_rows
WHERE kind <> 'erased'
  AND NOT EXISTS (SELECT 1 FROM erased WHERE erased.actor = intake_rows.actor)
GROUP BY submission_id
ORDER BY submitted_at DESC`;
