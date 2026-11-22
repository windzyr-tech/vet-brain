import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const docs = defineCollection({
  loader: glob({ base: './src/content/docs', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional().default(''),
    category: z.string().optional().default('未分类'),
    tags: z.array(z.string()).optional().default([]),
    concepts: z.array(z.string()).optional().default([]),
    date: z.coerce.date().optional(),
    source: z.string().optional(),
    sourceType: z.string().optional(),
    sourceName: z.string().optional(),
    syncedFrom: z.string().optional(),
    contentHash: z.string().optional(),
    language: z.string().optional().default('zh'),
    needsTranslation: z.boolean().optional().default(false),
    translatedFrom: z.string().optional(),
    originalTitle: z.string().optional(),
  }),
});

export const collections = { docs };
