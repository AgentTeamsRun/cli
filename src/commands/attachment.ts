import axios from "../utils/httpClient.js";

const requireString = (value: unknown, name: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
};

export async function executeAttachmentCommand(
  apiUrl: string,
  headers: Record<string, string>,
  action: string,
  options: Record<string, unknown>
): Promise<unknown> {
  if (action === "list") {
    const triggerId = requireString(options.triggerId, "--trigger-id");
    const response = await axios.get(`${apiUrl}/api/daemon-triggers/${triggerId}/attachments`, { headers });
    return response.data;
  }

  if (action === "upload" || action === "delete") {
    throw new Error(
      `'attachment ${action}' is not supported by the CLI. ` +
        "Attachments are created during trigger creation via the web UI / API draft-upload flow."
    );
  }

  throw new Error(`Unknown attachment action: ${action}`);
}
