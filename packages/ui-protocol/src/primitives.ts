import { z } from "zod";

export const NonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "String must contain non-whitespace characters"
});
export const IdSchema = NonEmptyStringSchema;

// Protocol timestamps are UTC ISO strings; do not accept offset timestamps.
export const DateTimeStringSchema = z.string().datetime();
