import type { AppSettings, ChatMessage, PersonaPreset, TranscriptSegment } from './types';

export interface AssembledPrompt {
  systemPrompt: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    screenshotDataUrl?: string;
  }>;
}

const STYLE_INSTRUCTIONS: Record<AppSettings['responseStyle'], string> = {
  concise: 'Be maximally concise: short sentences, bullet points, zero preamble, instant scannability.',
  balanced: 'Balance clarity with brevity: lead with the direct answer, then include brief context or code.',
  detailed: 'Provide thorough reasoning, edge cases, and structured steps while remaining well-formatted.',
};

export function formatTranscriptWindow(
  transcript: TranscriptSegment[],
  maxChars = 6000
): string {
  const finals = transcript.filter((seg) => seg.text.trim().length > 0);
  if (finals.length === 0) return '';

  const lines: string[] = [];
  let total = 0;

  for (let i = finals.length - 1; i >= 0; i--) {
    const seg = finals[i];
    const speakerLabel = seg.speaker === 'them' ? 'THEM' : 'YOU';
    const time = new Date(seg.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const line = `[${time}] ${speakerLabel}: ${seg.text.trim()}`;
    if (total + line.length + 1 > maxChars && lines.length > 0) {
      break;
    }
    lines.unshift(line);
    total += line.length + 1;
  }

  return lines.join('\n');
}

export function assemblePromptContext(params: {
  persona: PersonaPreset;
  settings: AppSettings;
  prompt: string;
  transcript: TranscriptSegment[];
  history: ChatMessage[];
  screenshotDataUrl?: string;
  maxHistoryMessages?: number;
}): AssembledPrompt {
  const {
    persona,
    settings,
    prompt,
    transcript,
    history,
    screenshotDataUrl,
    maxHistoryMessages = 10,
  } = params;

  const systemParts: string[] = [
    persona.systemPrompt.trim(),
    `Response style: ${STYLE_INSTRUCTIONS[settings.responseStyle]}`,
    'Always respond directly to the user’s actual message. Never invent or fabricate screen contents, open applications, participants, or meeting details that were not provided.',
  ];

  if (settings.attachUserContext !== false && settings.userContext.trim()) {
    systemParts.push(
      `User background / meeting context (use silently when relevant):\n${settings.userContext.trim()}`
    );
  }

  const transcriptBlock = formatTranscriptWindow(transcript);
  if (transcriptBlock) {
    systemParts.push(
      `Live audio transcript (recent rolling window; THEM = system/meeting audio, YOU = user microphone):\n${transcriptBlock}`
    );
  }
  if (screenshotDataUrl) {
    systemParts.push(
      'A fresh screenshot of the user’s current screen is attached. Base your answer strictly on what is visible in this new image — never repeat, recycle, or mix in answers or question numbers from earlier screens.'
    );
  } else if (!transcriptBlock) {
    systemParts.push(
      'No screenshot or live audio transcript is attached to this message. Reply naturally and concisely to the user’s text alone.'
    );
  }

  const recentHistory = history
    .filter((msg) => msg.content.trim().length > 0)
    .slice(-maxHistoryMessages)
    .map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

  const userContent = screenshotDataUrl
    ? `[Fresh screen capture ${Date.now().toString(36)}]\n${prompt.trim()}`
    : prompt.trim();

  return {
    systemPrompt: systemParts.join('\n\n'),
    messages: [
      ...recentHistory,
      {
        role: 'user',
        content: userContent,
        screenshotDataUrl,
      },
    ],
  };
}
