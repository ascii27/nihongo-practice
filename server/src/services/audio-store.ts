import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { env } from "../env.js";

// Writes raw MP3 bytes to AUDIO_DIR/<uuid>.mp3 and returns the public URL.
// The filename is a random UUID (unguessable) so /audio can be served
// unauthenticated — an <audio> element cannot send the passcode header.
export async function saveAudio(bytes: Uint8Array): Promise<{ audio_url: string }> {
  await mkdir(env.AUDIO_DIR, { recursive: true });
  const name = `${randomUUID()}.mp3`;
  await writeFile(`${env.AUDIO_DIR}/${name}`, bytes);
  return { audio_url: `/audio/${name}` };
}
