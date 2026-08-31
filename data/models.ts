export type RelationKind =
  | "article-concept"
  | "prerequisite"
  | "related"
  | "extends";

export interface Creator {
  id: string;
  name: string;
  handle: string;
  bio: string;
  focus: string[];
  articleIds: string[];
}

export interface Article {
  id: string;
  title: string;
  slug: string;
  summary: string;
  publishedAt: string;
  readingTimeMinutes: number;
  sourceUrl: string;
}

export interface Concept {
  id: string;
  name: string;
  slug: string;
  summary: string;
  domain: string;
  level: "foundation" | "intermediate" | "advanced";
  parentId?: string;
}

export interface Relation {
  id: string;
  kind: RelationKind;
  sourceId: string;
  targetId: string;
  note?: string;
}

export interface ReadingPath {
  id: string;
  title: string;
  summary: string;
  level: "beginner" | "intermediate" | "advanced";
  conceptIds: string[];
  articleIds: string[];
}

export interface DemoDataset {
  creator: Creator;
  articles: Article[];
  concepts: Concept[];
  relations: Relation[];
  readingPaths: ReadingPath[];
}
