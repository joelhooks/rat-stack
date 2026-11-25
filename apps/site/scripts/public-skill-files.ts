export const auditSkillDirectory = "skills/security-audit/";

const publicAuditFiles = new Set([
  "LICENSE",
  "RAT-STACK.md",
  "SKILL.md",
  "UPSTREAM.md",
  "report-schema.json",
]);

export const isPublicSkillFile = (sourcePath: string) =>
  !sourcePath.startsWith(auditSkillDirectory) ||
  publicAuditFiles.has(sourcePath.slice(auditSkillDirectory.length));
