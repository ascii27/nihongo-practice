import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { saveAudio } from "./audio-store.js";

describe("saveAudio", () => {
  it("writes an mp3 and returns a /audio url", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { audio_url } = await saveAudio(bytes);
    expect(audio_url).toMatch(/^\/audio\/[0-9a-f-]+\.mp3$/);
    const file = audio_url.replace("/audio/", "");
    const dir = process.env.AUDIO_DIR ?? "./data/audio";
    const written = await readFile(`${dir}/${file}`);
    expect(written.byteLength).toBe(4);
  });
});
