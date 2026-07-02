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
}

export interface FetchedMessage {
  raw: Buffer;
  uid: number;
}

export interface ParsedMail {
  messageId: string;
  sender: string;
  subject: string;
  date: string;
  html: string;
  link: string | null;
}

export interface DigestItem {
  messageId: string;
  uid: number;
  sender: string;
  subject: string;
  date: string;
  cleanText: string;
  summary: string | null;
  link: string | null;
  createdAt?: string;
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
  gmailUser?: string;
  weather?: WeatherSummary | null;
  hackernews?: HackerNewsStory[] | null;
}

export interface RunSummary {
  id: number;
  ranAt: string;
  newItems: number;
  itemCount: number;
}

export type AppLogger = Logger;
