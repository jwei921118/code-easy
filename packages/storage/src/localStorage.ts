import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureLocalStorageRoot(rootPath: string): Promise<void> {
  await mkdir(rootPath, { recursive: true });

  const codeEasyRoot = path.dirname(rootPath);
  if (path.basename(rootPath) !== "local" || path.basename(codeEasyRoot) !== ".code-easy") return;

  const ignorePath = path.join(codeEasyRoot, ".gitignore");
  const current = await readFileIfExists(ignorePath);
  if (current.split(/\r?\n/).includes("*")) return;

  await writeFile(ignorePath, `${current}${current.length > 0 && !current.endsWith("\n") ? "\n" : ""}*\n`, "utf8");
}

export async function readFileIfExists(filePath: string): Promise<string> {
  try {
    await stat(filePath);
    return readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}
