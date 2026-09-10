import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { runWithConcurrency } from "@/lib/concurrency";

const DEFAULT_MODEL = "claude-opus-5";
const BATCH_SIZE = 25;
const BATCH_CONCURRENCY = 3;
const EXCERPT_CHARS_IN_PROMPT = 600;

export interface ClassificationInput {
  id: string;
  name: string;
  mimeType: string;
  excerpt: string | null;
  contentAvailable: boolean;
}

export interface FileClassification {
  id: string;
  proposedClass: string;
  confidence: number;
  reasoning: string;
}

function getClient(): Anthropic {
  return new Anthropic();
}

function getModel(): string {
  return process.env.CLAUDE_MODEL?.trim() || DEFAULT_MODEL;
}

const BatchResponseSchema = z.object({
  classifications: z.array(
    z.object({
      id: z.string(),
      proposed_class: z
        .string()
        .describe(
          "Short (1-5 word) Title Case folder name for the class/subject this file belongs to, e.g. 'Biology 101' or 'Personal Finance'."
        ),
      confidence: z.number().min(0).max(1),
      reasoning: z.string().describe("One short sentence explaining the call."),
    })
  ),
});

const SYSTEM_PROMPT = `You help organize a user's Google Drive by splitting files into folders named after the "class" each file belongs to.

"Class" usually means an academic course or subject (e.g. "Biology 101", "CS 201 - Data Structures", "Organic Chemistry", "Spanish II"). When a file is clearly coursework - a syllabus, lecture notes, a problem set, a lab report, a paper for a class - infer the specific course or subject from its filename and content excerpt.

When a file is not coursework (receipts, personal photos, resumes, tax documents, etc.), assign a sensible general category instead (e.g. "Personal", "Financial", "Photos", "Resume & Job Search"). If there truly isn't enough signal, use "Uncategorized" and give it low confidence.

Rules:
- Keep class names short (1-5 words), Title Case.
- Use the SAME exact class name for files that clearly belong to the same class/category - consistency across files matters more than precision on any one file.
- Base your call on both the filename and the content excerpt when an excerpt is present. When no excerpt is present (content wasn't available), rely on the filename and file type alone, and lower your confidence accordingly.
- Return exactly one classification per input file, in the same order, echoing back its id.`;

function buildBatchPrompt(files: ClassificationInput[]): string {
  const items = files
    .map((f, idx) => {
      const excerpt = f.excerpt
        ? f.excerpt.slice(0, EXCERPT_CHARS_IN_PROMPT).replace(/\s+/g, " ").trim()
        : null;
      return [
        `${idx + 1}. id: ${f.id}`,
        `   filename: ${f.name}`,
        `   mimeType: ${f.mimeType}`,
        excerpt ? `   excerpt: ${excerpt}` : `   excerpt: (not available)`,
      ].join("\n");
    })
    .join("\n\n");

  return `Classify each of the following ${files.length} files.\n\n${items}`;
}

async function classifyBatch(
  client: Anthropic,
  model: string,
  files: ClassificationInput[]
): Promise<FileClassification[]> {
  const response = await client.messages.parse({
    model,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildBatchPrompt(files) }],
    output_config: {
      format: zodOutputFormat(BatchResponseSchema),
    },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    // Fall back to a single low-confidence "Uncategorized" bucket for this
    // batch rather than failing the whole scan.
    return files.map((f) => ({
      id: f.id,
      proposedClass: "Uncategorized",
      confidence: 0,
      reasoning: "Classification response could not be parsed.",
    }));
  }

  const byId = new Map(parsed.classifications.map((c) => [c.id, c]));
  return files.map((f) => {
    const c = byId.get(f.id);
    return {
      id: f.id,
      proposedClass: c?.proposed_class || "Uncategorized",
      confidence: c?.confidence ?? 0,
      reasoning: c?.reasoning || "No classification returned for this file.",
    };
  });
}

const ConsolidationSchema = z.object({
  mappings: z.array(
    z.object({
      original: z.string(),
      canonical: z
        .string()
        .describe("The normalized class name every near-duplicate of `original` should map to."),
    })
  ),
});

/**
 * Merges near-duplicate class labels that different batches proposed
 * (e.g. "Bio 101" / "Biology 101" / "BIOL 101") into one canonical name per
 * cluster. Returns a map from every original label to its canonical label
 * (labels with no duplicates map to themselves).
 */
async function consolidateLabels(
  client: Anthropic,
  model: string,
  labels: string[]
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(labels)).sort();
  const identity = new Map(unique.map((l) => [l, l]));
  if (unique.length <= 1) return identity;

  const response = await client.messages.parse({
    model,
    max_tokens: 4000,
    system:
      "You clean up a list of folder/class names produced by independent batches of an automated classifier. " +
      "Merge names that clearly refer to the same class or category (different capitalization, abbreviations, punctuation, or minor wording) into a single canonical Title Case name. " +
      "Do NOT merge names that plausibly refer to different classes, even if similar-sounding. " +
      "Return a mapping entry for every input label, including ones that don't need to change (canonical == original in that case).",
    messages: [
      {
        role: "user",
        content: `Labels:\n${unique.map((l) => `- ${l}`).join("\n")}`,
      },
    ],
    output_config: { format: zodOutputFormat(ConsolidationSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) return identity;

  const map = new Map(identity);
  for (const m of parsed.mappings) {
    if (unique.includes(m.original)) {
      map.set(m.original, m.canonical.trim() || m.original);
    }
  }
  return map;
}

export interface ClassifyProgress {
  batchesDone: number;
  batchesTotal: number;
  stage: "classifying" | "consolidating";
}

export async function classifyFiles(
  files: ClassificationInput[],
  onProgress?: (p: ClassifyProgress) => void
): Promise<FileClassification[]> {
  if (files.length === 0) return [];

  const client = getClient();
  const model = getModel();

  const batches: ClassificationInput[][] = [];
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    batches.push(files.slice(i, i + BATCH_SIZE));
  }

  let done = 0;
  const batchResults = await runWithConcurrency(batches, BATCH_CONCURRENCY, async (batch) => {
    const result = await classifyBatch(client, model, batch);
    done += 1;
    onProgress?.({ batchesDone: done, batchesTotal: batches.length, stage: "classifying" });
    return result;
  });

  const flat = batchResults.flat();

  onProgress?.({ batchesDone: batches.length, batchesTotal: batches.length, stage: "consolidating" });
  const canonicalMap = await consolidateLabels(
    client,
    model,
    flat.map((f) => f.proposedClass)
  );

  return flat.map((f) => ({
    ...f,
    proposedClass: canonicalMap.get(f.proposedClass) ?? f.proposedClass,
  }));
}
