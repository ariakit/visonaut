---
"@visonaut/web": patch
---

Stopped scheduling new SQL and image backups, while allowing an in-progress backup to finish and retained sets to expire. D1 Time Travel remains available for emergency database rollback, but it does not restore R2 images or reactivate the service safely by itself. Removed SQL backup size from run admission and cleared the old backup-age alert.
