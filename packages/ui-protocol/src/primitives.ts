import { z } from "zod";

/** 非空字符串基础 schema，防止空白 prompt、id 或消息进入协议层。 */
export const NonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "String must contain non-whitespace characters"
});
/** 复用非空字符串约束作为协议对象 id 的基础校验。 */
export const IdSchema = NonEmptyStringSchema;

// 协议时间戳使用 UTC ISO 字符串，不接受带偏移的时间格式。
export const DateTimeStringSchema = z.string().datetime();
