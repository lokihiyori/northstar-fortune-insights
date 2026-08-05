import { z } from "zod";

/**
 * Minimum length is the control that actually matters; composition rules push
 * people toward predictable substitutions. 12 characters follows current NIST
 * guidance for a user-chosen secret.
 */
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(200, "Use at most 200 characters.");

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .max(254, "That email address is too long.")
  .email("Enter a valid email address.")
  .transform((value) => value.toLowerCase());

export const signUpSchema = z.object({
  name: z.string().trim().max(120, "That name is too long.").optional(),
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
