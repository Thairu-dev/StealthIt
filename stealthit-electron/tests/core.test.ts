import { describe, expect, it } from 'vitest';
import { assemblePromptContext, formatTranscriptWindow } from '../src/shared/context';
import { BUILT_IN_PERSONAS, DEFAULT_SETTINGS, isApiKeyOptional } from '../src/shared/defaults';
import {
  extractAnthropicSseDelta,
  extractGeminiSseDelta,
  extractOllamaNdjsonDelta,
  extractOpenAISseDelta,
  parseDataUrl,
} from '../src/main/providers';
import {
  computeRms,
  downsampleTo16k,
  encodeWavBuffer,
  floatToInt16Pcm,
  isEchoDuplicate,
} from '../src/shared/wavEncoder';
import { extractReliableWhisperText, filterWhisperHallucination } from '../src/main/stt';

describe('Context assembly & transcript windowing', () => {
  it('labels speakers clearly and respects rolling character budget', () => {
    const segments = [
      { id: '1', speaker: 'them' as const, text: 'First older line that should be dropped', timestamp: 1000, isFinal: true },
      { id: '2', speaker: 'you' as const, text: 'Recent response from user', timestamp: 2000, isFinal: true },
      { id: '3', speaker: 'them' as const, text: 'Latest question from interviewer', timestamp: 3000, isFinal: true },
    ];

    const full = formatTranscriptWindow(segments, 2000);
    expect(full).toContain('THEM: First older line');
    expect(full).toContain('YOU: Recent response from user');
    expect(full).toContain('THEM: Latest question from interviewer');

    const truncated = formatTranscriptWindow(segments, 95);
    expect(truncated).not.toContain('First older line');
    expect(truncated).toContain('Latest question from interviewer');
  });

  it('injects persona, response style, user context, transcript, and history', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      userContext: 'Senior distributed systems engineer, 8 years experience.',
      responseStyle: 'concise' as const,
    };

    const assembled = assemblePromptContext({
      persona: BUILT_IN_PERSONAS[1],
      settings,
      prompt: 'How do we prevent split-brain in Raft?',
      transcript: [
        { id: 't1', speaker: 'them', text: 'Tell me about Raft leader election.', timestamp: 1000, isFinal: true },
      ],
      history: [
        { id: 'm1', role: 'user', content: 'Hi', timestamp: 500 },
        { id: 'm2', role: 'assistant', content: 'Ready.', timestamp: 600 },
      ],
      screenshotDataUrl: 'data:image/jpeg;base64,AAAA',
    });

    expect(assembled.systemPrompt).toContain(BUILT_IN_PERSONAS[1].systemPrompt);
    expect(assembled.systemPrompt).toContain('Senior distributed systems engineer');
    expect(assembled.systemPrompt).toContain('THEM: Tell me about Raft leader election.');
    expect(assembled.systemPrompt).toContain('fresh screenshot');
    expect(assembled.messages).toHaveLength(3);
    expect(assembled.messages[2].screenshotDataUrl).toBe('data:image/jpeg;base64,AAAA');
  });

  it('strips empty aborted assistant turns from history', () => {
    const assembled = assemblePromptContext({
      persona: BUILT_IN_PERSONAS[0],
      settings: DEFAULT_SETTINGS,
      prompt: 'Analyze screen',
      transcript: [],
      history: [
        { id: 'm1', role: 'user', content: 'Analyze screen', timestamp: 100 },
        { id: 'm2', role: 'assistant', content: '   ', timestamp: 200 },
        { id: 'm3', role: 'user', content: 'Follow up', timestamp: 300 },
        { id: 'm4', role: 'assistant', content: 'Real reply', timestamp: 400 },
      ],
    });
    expect(assembled.messages.map((m) => m.content)).toEqual([
      'Analyze screen',
      'Follow up',
      'Real reply',
      'Analyze screen',
    ]);
  });

  it('respects attachUserContext toggle when assembling prompts', () => {
    const withCtx = assemblePromptContext({
      persona: BUILT_IN_PERSONAS[0],
      settings: {
        ...DEFAULT_SETTINGS,
        userContext: 'Principal backend engineer at Acme.',
        attachUserContext: true,
      },
      prompt: 'Hello',
      transcript: [],
      history: [],
    });
    expect(withCtx.systemPrompt).toContain('Principal backend engineer at Acme.');

    const withoutCtx = assemblePromptContext({
      persona: BUILT_IN_PERSONAS[0],
      settings: {
        ...DEFAULT_SETTINGS,
        userContext: 'Principal backend engineer at Acme.',
        attachUserContext: false,
      },
      prompt: 'What is the capital of France?',
      transcript: [],
      history: [],
    });
    expect(withoutCtx.systemPrompt).not.toContain('Principal backend engineer at Acme.');
  });
});

describe('AI streaming parsers', () => {
  it('parses OpenAI / OpenRouter SSE chunks', () => {
    expect(
      extractOpenAISseDelta('data: {"choices":[{"delta":{"content":"Hello"}}]}')
    ).toBe('Hello');
    expect(extractOpenAISseDelta('data: [DONE]')).toBeNull();
    expect(extractOpenAISseDelta(': keep-alive')).toBeNull();
  });

  it('parses Anthropic SSE text_delta chunks', () => {
    expect(
      extractAnthropicSseDelta(
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"World"}}'
      )
    ).toBe('World');
    expect(
      extractAnthropicSseDelta('data: {"type":"message_stop"}')
    ).toBeNull();
  });

  it('parses Gemini SSE candidate parts', () => {
    expect(
      extractGeminiSseDelta(
        'data: {"candidates":[{"content":{"parts":[{"text":"Fast "},{"text":"answer"}]}}]}'
      )
    ).toBe('Fast answer');
  });

  it('parses Ollama NDJSON chunks', () => {
    expect(
      extractOllamaNdjsonDelta('{"message":{"role":"assistant","content":"Local!"}}')
    ).toBe('Local!');
  });

  it('parses base64 data URLs safely', () => {
    expect(parseDataUrl('data:image/jpeg;base64,abc123')).toEqual({
      mimeType: 'image/jpeg',
      base64: 'abc123',
    });
    expect(parseDataUrl('not-a-data-url')).toBeNull();
  });

  it('treats API keys as optional for Ollama and custom OpenAI-compatible URLs', () => {
    expect(isApiKeyOptional('ollama', { baseUrl: 'http://localhost:11434' })).toBe(true);
    expect(isApiKeyOptional('openai', { baseUrl: 'https://api.openai.com/v1' })).toBe(false);
    expect(isApiKeyOptional('openrouter', { baseUrl: 'https://openrouter.ai/api/v1/' })).toBe(false);
    expect(isApiKeyOptional('openai', { baseUrl: 'http://100.120.143.79:11434/v1' })).toBe(true);
    expect(isApiKeyOptional('openrouter', { baseUrl: 'http://100.120.143.79:11434/v1' })).toBe(true);
    expect(isApiKeyOptional('openai', { baseUrl: 'https://api.openai.com/v1', useCustomBaseUrl: true })).toBe(true);
    expect(isApiKeyOptional('openrouter', { baseUrl: 'http://100.120.143.79:11434/v1', useCustomBaseUrl: false })).toBe(false);
    expect(isApiKeyOptional('anthropic', { baseUrl: 'http://100.120.143.79:8000', useCustomBaseUrl: true })).toBe(false);
  });
});

describe('Audio DSP & WAV encoder', () => {
  it('downsamples 48kHz to 16kHz cleanly', () => {
    const input = new Float32Array(480);
    input.fill(0.5);
    const out = downsampleTo16k(input, 48000, 16000);
    expect(out.length).toBe(160);
    expect(out[0]).toBeCloseTo(0.5, 4);
  });

  it('computes RMS and encodes valid 16kHz mono RIFF/WAVE header', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1.0]);
    expect(computeRms(samples)).toBeGreaterThan(0.5);

    const pcm = floatToInt16Pcm(samples);
    const wav = encodeWavBuffer(pcm, 16000);
    expect(wav.byteLength).toBe(44 + pcm.byteLength);

    const header = String.fromCharCode(wav[0], wav[1], wav[2], wav[3]);
    const waveTag = String.fromCharCode(wav[8], wav[9], wav[10], wav[11]);
    expect(header).toBe('RIFF');
    expect(waveTag).toBe('WAVE');
  });

  it('filters Whisper silence hallucinations and low-confidence segments', () => {
    expect(filterWhisperHallucination('Thank you.')).toBe('');
    expect(filterWhisperHallucination('[Music]')).toBe('');
    expect(filterWhisperHallucination('[SILENCE]')).toBe('');
    expect(filterWhisperHallucination("00:00:00.000 --> 00:00:03.000 I'm not sure.")).toBe('');
    expect(filterWhisperHallucination('Can you explain Raft consensus?')).toBe(
      'Can you explain Raft consensus?'
    );
    expect(
      extractReliableWhisperText({
        text: 'Thank you. Real speech here.',
        segments: [
          { text: 'Thank you.', no_speech_prob: 0.85, avg_logprob: -0.4 },
          { text: 'Real speech here.', no_speech_prob: 0.05, avg_logprob: -0.2 },
        ],
      })
    ).toBe('Real speech here.');
  });

  it('detects speaker-bleed echo duplicates on the mic channel', () => {
    expect(
      isEchoDuplicate('explain how raft leader election works', [
        'Can you explain how Raft leader election works in practice?',
      ])
    ).toBe(true);
    expect(
      isEchoDuplicate('Sure, each node starts as a follower with a randomized timeout.', [
        'Can you explain how Raft leader election works in practice?',
      ])
    ).toBe(false);
  });
});
