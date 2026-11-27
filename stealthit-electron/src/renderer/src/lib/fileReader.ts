export interface AttachedFile {
  id: string;
  name: string;
  kind: 'text' | 'image';
  content: string; // plain text for 'text', base64 dataUrl for 'image'
  sizeBytes: number;
}

const MAX_TEXT_CHARS = 24000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Lightweight best-effort text extractor for uncompressed/simple PDFs in-memory.
 * Falls back cleanly with a helpful error if the PDF is scanned or compressed binary.
 */
async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const latin1 = new TextDecoder('latin1').decode(buf);

  const chunks: string[] = [];
  const tjRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
  let match: RegExpExecArray | null = tjRegex.exec(latin1);
  while (match !== null) {
    const cleaned = match[1]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\')
      .trim();
    if (cleaned) chunks.push(cleaned);
    match = tjRegex.exec(latin1);
  }

  const joined = chunks.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (joined.length < 20) {
    throw new Error(
      `Could not extract plain text from "${file.name}" (it may be compressed or scanned). Export as .txt/.md or copy-paste its text instead.`
    );
  }
  return joined.slice(0, MAX_TEXT_CHARS);
}

export async function readAttachmentFile(file: File): Promise<AttachedFile> {
  const lower = file.name.toLowerCase();
  const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(lower)) {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`Image "${file.name}" is larger than 8 MB.`);
    }
    const dataUrl = await readAsDataUrl(file);
    return {
      id,
      name: file.name || 'pasted-image.png',
      kind: 'image',
      content: dataUrl,
      sizeBytes: file.size,
    };
  }

  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    const text = await extractPdfText(file);
    return {
      id,
      name: file.name,
      kind: 'text',
      content: text,
      sizeBytes: file.size,
    };
  }

  // Plain text, Markdown, CSV, JSON, source code, logs
  const rawText = await file.text();
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error(`File "${file.name}" is empty.`);
  }

  const truncated =
    trimmed.length > MAX_TEXT_CHARS
      ? `${trimmed.slice(0, MAX_TEXT_CHARS)}\n\n[Truncated at ${MAX_TEXT_CHARS.toLocaleString()} characters]`
      : trimmed;

  return {
    id,
    name: file.name,
    kind: 'text',
    content: truncated,
    sizeBytes: file.size,
  };
}
