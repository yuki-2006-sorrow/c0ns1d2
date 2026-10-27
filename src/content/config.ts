import { defineCollection, z } from 'astro:content';

// 日期：支持完整(YYYY-MM-DD)、部分(YYYY-MM / YYYY)、未知(?)——一律转成字符串
const dateField = z.union([z.string(), z.date(), z.number()]).transform((v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
});

const events = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: dateField,
    persons: z.array(z.string()),
    summary: z.string().default(''),
    quotes: z.array(z.string()).default([]),
    category: z.enum(['core', 'food', 'exam', 'other']).default('other'),
    tags: z.array(z.string()).default([]),
    color: z.string().default('#4ca1af'),
    size: z.number().default(30),
    related: z.array(z.string()).default([]),
    source: z.string().default(''),
    images: z.array(z.string()).default([]),
    videos: z.array(z.string()).default([]),
    medium: z.string().default(''),
    draft: z.boolean().default(false),
  }),
});

const people = defineCollection({
  type: 'content',
  schema: z.object({
    name: z.string(),
    nickname: z.string(),
    university: z.string(),
    major: z.string(),
    role: z.string(),
    color: z.string(),
    messages: z.number(),
    featured: z.boolean().default(false),
    group: z.string().default(''),
    personality: z.object({
      openness: z.number(),
      conscientiousness: z.number(),
      extraversion: z.number(),
      agreeableness: z.number(),
      neuroticism: z.number(),
    }),
    tags: z.array(z.string()).default([]),
  }),
});

const journal = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: dateField,
    author: z.string().default('朱浩宇'),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const mediums = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    summary: z.string().default(''),
    date: dateField,
    color: z.string().default('#4ca1af'),
    parent: z.string().default(''),
    draft: z.boolean().default(false),
  }),
});

export const collections = { events, people, journal, mediums };
