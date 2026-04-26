import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

export const runtime = "edge";

// Common stop words to filter out
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "its", "this", "that", "are",
  "was", "were", "be", "been", "being", "have", "has", "had", "do", "does",
  "did", "will", "would", "could", "should", "may", "might", "shall",
  "can", "not", "no", "so", "if", "then", "than", "too", "very", "just",
  "about", "up", "out", "all", "also", "as", "we", "our", "you", "your",
  "they", "their", "them", "my", "me", "i", "he", "she", "his", "her",
  "who", "what", "when", "where", "how", "which", "more", "most",
  "some", "any", "each", "every", "much", "many", "own", "other",
  "into", "over", "such", "only", "new", "now", "way", "these", "those",
  "here", "there", "both", "between", "through", "during", "before",
  "after", "above", "below", "get", "got", "make", "made", "take",
  "like", "amp", "https", "http", "www", "com", "one", "two", "even",
  "well", "back", "still", "us", "day", "let", "see", "go", "know",
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Get all post text for this client
  const posts = await prisma.socialPost.findMany({
    where: { clientId: id },
    select: {
      postTextFull: true,
      postTextSnippet: true,
    },
  });

  // Count word frequencies
  const wordMap = new Map<string, number>();

  for (const post of posts) {
    const text = post.postTextFull || post.postTextSnippet || "";

    // Tokenize: split on non-alpha chars, lowercase, filter
    const words = text
      .toLowerCase()
      .replace(/[^a-zA-Z\s]/g, " ")
      .split(/\s+/)
      .filter((w: string) => w.length > 2 && !STOP_WORDS.has(w));

    for (const word of words) {
      wordMap.set(word, (wordMap.get(word) || 0) + 1);
    }
  }

  // Sort by count, take top 60
  const words = Array.from(wordMap.entries())
    .map(([word, count]) => ({ word, count }))
    .filter((w) => w.count >= 2) // Must appear at least twice
    .sort((a, b) => b.count - a.count)
    .slice(0, 60);

  return NextResponse.json({ words });
}
