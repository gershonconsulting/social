/**
 * Which AI vendor the Content Intelligence and Post Studio engines run on.
 *
 * Only matters when BOTH keys are saved — with one key configured the engines
 * fall through to it regardless of what is stored here, so pasting a single key
 * is enough to switch the features on.
 */

export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getAISettings,
  getPreferredProvider,
  getProviderSettings,
  setPreferredProvider,
} from "@/lib/content/provider";

const schema = z.object({ provider: z.enum(["anthropic", "openai"]) });

export async function GET() {
  try {
    const [preferred, active, anthropic, openai] = await Promise.all([
      getPreferredProvider(),
      getAISettings(),
      getProviderSettings("anthropic"),
      getProviderSettings("openai"),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        preferred,
        // What a generation would actually use right now.
        active: active.apiKey ? active.provider : null,
        activeModel: active.apiKey ? active.model : null,
        configured: {
          anthropic: !!anthropic.apiKey,
          openai: !!openai.apiKey,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read the AI provider";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "provider must be \"anthropic\" or \"openai\"." },
        { status: 400 }
      );
    }

    const provider = parsed.data.provider;
    const settings = await getProviderSettings(provider);
    if (!settings.apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: `No ${provider === "openai" ? "OpenAI" : "Anthropic"} key is saved yet. Add the key first, then make it active.`,
          code: "NO_KEY_FOR_PROVIDER",
        },
        { status: 428 }
      );
    }

    await setPreferredProvider(provider);

    return NextResponse.json({
      success: true,
      message: `${provider === "openai" ? "OpenAI" : "Anthropic"} is now the active AI provider.`,
      data: { provider, model: settings.model },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to set the AI provider";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
