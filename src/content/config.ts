import { defineCollection, z } from 'astro:content';

const events = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.union([z.string(), z.date()]).transform(v => typeof v === 'string' ? v : v.toISOString().slice(0, 10)),
    persons: z.array(z.string()),
    category: z.enum(['core', 'food', 'exam', 'other']).default('other'),
    tags: z.array(z.string()).default([]),
    color: z.string().default('#4ca1af'),
    size: z.number().default(30),
    related: z.array(z.string()).default([]),
    images: z.array(z.string()).default([]),
    videos: z.array(z.string()).default([]),
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
    date: z.union([z.string(), z.date()]).transform(v => typeof v === 'string' ? v : v.toISOString().slice(0, 10)),
    author: z.string().default('朱浩宇'),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { events, people, journal };
