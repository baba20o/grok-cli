import fs from "node:fs";
import path from "node:path";
import { getResponseErrorMessage } from "./cli-errors.js";
import type { GrokConfig } from "./types.js";

export async function listVoices(config: GrokConfig): Promise<any[]> {
  const response = await fetch(`${config.baseUrl}/tts/voices`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!response.ok) throw new Error(await getResponseErrorMessage("Failed to list voices", response));
  const data = await response.json() as any;
  return data.voices || [];
}

export async function createRealtimeClientSecret(
  config: GrokConfig,
  seconds: number,
  session?: Record<string, unknown>,
): Promise<any> {
  const response = await fetch(`${config.baseUrl}/realtime/client_secrets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { seconds },
      ...(session ? { session } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(await getResponseErrorMessage("Failed to create realtime client secret", response));
  }
  return response.json();
}

export async function streamTtsToFile(
  config: GrokConfig,
  opts: {
    text: string;
    voice: string;
    language: string;
    codec: string;
    sampleRate?: number;
    bitRate?: number;
    output: string;
  },
): Promise<{ bytes: number; output: string }> {
  const url = new URL(config.baseUrl.replace(/^http/, "ws") + "/tts");
  url.searchParams.set("language", opts.language);
  url.searchParams.set("voice", opts.voice);
  url.searchParams.set("codec", opts.codec);
  if (opts.sampleRate) url.searchParams.set("sample_rate", String(opts.sampleRate));
  if (opts.bitRate) url.searchParams.set("bit_rate", String(opts.bitRate));

  const WS = (globalThis as any).WebSocket;
  if (!WS) {
    throw new Error("WebSocket is not available in this Node runtime.");
  }

  const chunks: Buffer[] = [];
  const outputPath = path.resolve(opts.output);

  await new Promise<void>((resolve, reject) => {
    const ws = new WS(url, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "text.delta", delta: opts.text }));
      ws.send(JSON.stringify({ type: "text.done" }));
    };

    ws.onmessage = (event: any) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.type === "audio.delta" && data.delta) {
          chunks.push(Buffer.from(data.delta, "base64"));
        } else if (data.type === "audio.done") {
          resolve();
          ws.close();
        } else if (data.type === "error") {
          reject(new Error(data.message || "Streaming TTS failed"));
          ws.close();
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        ws.close();
      }
    };

    ws.onerror = (event: any) => {
      reject(new Error(event?.message || "Streaming TTS connection failed"));
    };
  });

  const buffer = Buffer.concat(chunks);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  return { bytes: buffer.length, output: outputPath };
}
