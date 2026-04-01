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

function getRealtimeUrl(config: GrokConfig): string {
  const url = new URL(config.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/realtime`;
  return url.toString();
}

function parsePcmWav(filePath: string): { sampleRate: number; audio: Buffer } {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Only PCM WAV files are supported for transcription.");
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let audio: Buffer | null = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkData = offset + 8;

    if (chunkId === "fmt ") {
      const audioFormat = buffer.readUInt16LE(chunkData);
      channels = buffer.readUInt16LE(chunkData + 2);
      sampleRate = buffer.readUInt32LE(chunkData + 4);
      bitsPerSample = buffer.readUInt16LE(chunkData + 14);
      if (audioFormat !== 1) {
        throw new Error("Only linear PCM WAV files are supported.");
      }
    } else if (chunkId === "data") {
      audio = buffer.subarray(chunkData, chunkData + chunkSize);
    }

    offset = chunkData + chunkSize + (chunkSize % 2);
  }

  if (!audio) throw new Error("WAV file does not contain a data chunk.");
  if (channels !== 1) throw new Error("Only mono WAV files are supported.");
  if (bitsPerSample !== 16) throw new Error("Only 16-bit PCM WAV files are supported.");
  if (!sampleRate) throw new Error("Unable to determine WAV sample rate.");

  return { sampleRate, audio };
}

export async function transcribeWavFile(
  config: GrokConfig,
  filePath: string,
): Promise<{ transcript: string; sampleRate: number }> {
  const WS = (globalThis as any).WebSocket;
  if (!WS) {
    throw new Error("WebSocket is not available in this Node runtime.");
  }

  const { sampleRate, audio } = parsePcmWav(path.resolve(filePath));
  const url = getRealtimeUrl(config);

  return await new Promise<{ transcript: string; sampleRate: number }>((resolve, reject) => {
    const ws = new WS(url, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });

    let transcript = "";

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          turn_detection: { type: null },
          audio: {
            input: { format: { type: "audio/pcm", rate: sampleRate } },
            output: { format: { type: "audio/pcm", rate: sampleRate } },
          },
        },
      }));

      const chunkSize = 32 * 1024;
      for (let offset = 0; offset < audio.length; offset += chunkSize) {
        ws.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: audio.subarray(offset, offset + chunkSize).toString("base64"),
        }));
      }
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    };

    ws.onmessage = (event: any) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.type === "conversation.item.input_audio_transcription.completed") {
          transcript = data.transcript || transcript;
          resolve({ transcript, sampleRate });
          ws.close();
        } else if (data.type === "error") {
          reject(new Error(data.message || "Realtime transcription failed"));
          ws.close();
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        ws.close();
      }
    };

    ws.onerror = (event: any) => {
      reject(new Error(event?.message || "Realtime transcription connection failed"));
    };
  });
}
