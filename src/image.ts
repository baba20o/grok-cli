import fs from "node:fs";
import path from "node:path";

const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB per xAI docs

export function isUrl(str: string): boolean {
  return str.startsWith("http://") || str.startsWith("https://");
}

export function readImageAsBase64(imagePath: string, cwd: string): string {
  const resolved = path.resolve(cwd, imagePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Image not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (stat.size > MAX_IMAGE_SIZE) {
    throw new Error(`Image too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max: 20MB`);
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported image format: ${ext}. Use .jpg, .jpeg, or .png`);
  }

  const buffer = fs.readFileSync(resolved);
  const base64 = buffer.toString("base64");
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${base64}`;
}

export function getImageDataUrl(imagePath: string, cwd: string): string {
  if (isUrl(imagePath)) return imagePath;
  return readImageAsBase64(imagePath, cwd);
}

/** Build chat.completions message content with image + text */
export function buildImageMessageContent(imageUrl: string, text: string): any[] {
  return [
    {
      type: "image_url",
      image_url: { url: imageUrl, detail: "high" },
    },
    {
      type: "text",
      text,
    },
  ];
}

/** Build Responses API input content with image + text */
export function buildImageInputContent(imageUrl: string, text: string): any[] {
  return [
    {
      type: "input_image",
      image_url: imageUrl,
      detail: "high",
    },
    {
      type: "input_text",
      text,
    },
  ];
}
