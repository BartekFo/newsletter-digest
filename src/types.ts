import type Database from 'better-sqlite3';
import type { Logger } from 'pino';

export type Db = Database.Database;

export interface AppConfig {
  gmailUser: string;
  gmailAppPassword: string;
  imapFolder: string;
  bootstrapDays: number;
  ollamaModel: string;
  dbPath: string;
  outPath: string;
  weatherCity: string;
  logLevel: string;
  sendDigestEmail: boolean;
  digestEmailRecipient: string;
}

export interface DigestItem {
  newsletterId: string;
  source: NewsletterSource;
  sender: string;
  subject: string;
  date: string;
  cleanText: string;
  summary: string | null;
  link: string | null;
  isPaywalled: boolean;
  createdAt?: string;
}

export interface NewsletterSourceIdentity {
  type: string;
  externalId: string;
}

export interface NewsletterSource extends NewsletterSourceIdentity {
  cursor: string;
  metadata: Record<string, string | number>;
}

export interface ResolvedSourceLink {
  url: string;
  label: string;
}

export interface SourceNewsletter {
  source: NewsletterSource;
  sender: string;
  subject: string;
  date: string;
  html: string;
  link: string | null;
  isPaywalled: boolean;
}

export interface SourceBatch {
  newsletters: SourceNewsletter[];
  cursor: string | null;
}

export interface NewsletterSourceAdapter {
  fetch(cursor: string | null): Promise<SourceBatch>;
  resolveSourceLink?(source: NewsletterSource): ResolvedSourceLink | null;
}

export interface WeatherSummary {
  city: string;
  temp: number;
  code: number;
  description: string;
  max: number;
  min: number;
  precipProb: number;
}

export interface HackerNewsStory {
  title: string;
  url: string;
  score: number;
  comments: number;
  hnUrl: string;
}

export interface DigestMeta {
  ranAt: string;
  newCount: number;
  runId?: number;
  resolveSourceLink?: (source: NewsletterSource) => ResolvedSourceLink | null;
  weather?: WeatherSummary | null;
  hackernews?: HackerNewsStory[] | null;
}

export interface RunSummary {
  id: number;
  ranAt: string;
  newItems: number;
  itemCount: number;
  weather?: WeatherSummary | null;
  hackernews?: HackerNewsStory[] | null;
}

export type AppLogger = Logger;
