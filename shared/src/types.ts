import { z } from "zod";

export const AuthCheckRequest = z.object({
  // Body intentionally empty; passcode comes from header.
}).strict();
export type AuthCheckRequest = z.infer<typeof AuthCheckRequest>;

export const AuthCheckResponse = z.object({
  ok: z.literal(true),
});
export type AuthCheckResponse = z.infer<typeof AuthCheckResponse>;
