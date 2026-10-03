export function attachmentMessage(reason: string): string {
  if (reason === "UPLOAD_FAILED") return "The attachment upload failed. Open the form to attach it yourself, or skip this job.";
  if (reason === "ATTACHMENT_UNVERIFIED" || reason === "UPLOAD_UNVERIFIED") return "Atriveo couldn't confirm that this attachment finished saving. Open the form to verify it, or skip this job.";
  return "This attachment needs attention. Open the form to verify it, or skip this job.";
}
