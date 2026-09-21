export interface Candidate {
  url: string;
  title: string;
  source: string;
  publishedAt: string | null;
  snippet: string;
  fullText?: string | null;
}
