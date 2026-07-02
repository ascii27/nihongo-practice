import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  PASSCODE: z.string().min(1, "PASSCODE is required"),
  DATABASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string().optional(),
  AUDIO_DIR: z.string().default("./data/audio"),
});

export const env = Env.parse(process.env);
