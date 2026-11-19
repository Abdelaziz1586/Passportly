import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { PostStatus } from '../../common/enums';
import {
  BlogAuthorSummaryDto,
  BlogMediaItemDto,
  BlogPostItemDto,
} from './dto/blog-post-response.dto';

export interface NormalizedTagInput {
  name: string;
  slug: string;
}

export interface PopulatedAuthorLike {
  _id: Types.ObjectId | string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  bio?: string;
}

export interface LeanMediaLike {
  _id?: Types.ObjectId | string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
}

export interface LeanBlogPostLike {
  _id: Types.ObjectId | string;
  author: PopulatedAuthorLike | Types.ObjectId | string;
  title: string;
  slug?: string;
  content: string;
  excerpt?: string;
  status: PostStatus;
  isHidden: boolean;
  tags: string[];
  tagRefs?: Array<Types.ObjectId | string>;
  images?: LeanMediaLike[];
  likesCount: number;
  commentsCount: number;
  attachedItinerary?: Types.ObjectId | string | null;
  publishedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function generatePostSlug(title: string): string {
  const base = slugify(title).slice(0, 80) || 'post';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

export function buildExcerpt(
  content: string,
  explicitExcerpt?: string,
): string {
  if (explicitExcerpt && explicitExcerpt.trim().length > 0) {
    return explicitExcerpt.trim();
  }
  const normalized = content.trim().replace(/\s+/g, ' ');
  if (normalized.length <= 200) {
    return normalized;
  }
  return `${normalized.slice(0, 197).trimEnd()}...`;
}

export function normalizeTags(rawTags?: string[]): NormalizedTagInput[] {
  if (!rawTags || rawTags.length === 0) {
    return [];
  }

  const seenSlugs = new Set<string>();
  const normalized: NormalizedTagInput[] = [];

  for (const raw of rawTags) {
    const name = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!name) {
      continue;
    }
    const slug = slugify(name);
    if (!slug) {
      throw new BadRequestException(
        'Tags must contain at least one alphanumeric character',
      );
    }
    if (seenSlugs.has(slug)) {
      continue;
    }
    seenSlugs.add(slug);
    normalized.push({ name, slug });
  }

  return normalized;
}

export function formatAuthor(
  authorRef: PopulatedAuthorLike | Types.ObjectId | string,
): BlogAuthorSummaryDto | string {
  if (authorRef instanceof Types.ObjectId || typeof authorRef === 'string') {
    return String(authorRef);
  }
  if (
    typeof authorRef === 'object' &&
    authorRef !== null &&
    'firstName' in authorRef &&
    typeof authorRef.firstName === 'string'
  ) {
    return {
      id: String(authorRef._id),
      firstName: authorRef.firstName,
      lastName: authorRef.lastName ?? '',
      ...(authorRef.avatarUrl !== undefined
        ? { avatarUrl: authorRef.avatarUrl }
        : {}),
      ...(authorRef.bio !== undefined ? { bio: authorRef.bio } : {}),
    };
  }
  return String(authorRef._id);
}

export function formatMediaItem(item: LeanMediaLike): BlogMediaItemDto {
  return {
    ...(item._id !== undefined ? { id: String(item._id) } : {}),
    url: item.url,
    filename: item.filename,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    uploadedAt: item.uploadedAt,
  };
}

export function formatBlogPost(post: LeanBlogPostLike): BlogPostItemDto {
  return {
    id: String(post._id),
    author: formatAuthor(post.author),
    title: post.title,
    ...(post.slug !== undefined ? { slug: post.slug } : {}),
    content: post.content,
    ...(post.excerpt !== undefined ? { excerpt: post.excerpt } : {}),
    status: post.status,
    isHidden: post.isHidden,
    tags: post.tags ?? [],
    tagRefs: (post.tagRefs ?? []).map((id) => String(id)),
    images: (post.images ?? []).map(formatMediaItem),
    likesCount: post.likesCount ?? 0,
    commentsCount: post.commentsCount ?? 0,
    attachedItinerary: post.attachedItinerary
      ? String(post.attachedItinerary)
      : null,
    ...(post.publishedAt !== undefined
      ? { publishedAt: post.publishedAt }
      : {}),
    ...(post.createdAt !== undefined ? { createdAt: post.createdAt } : {}),
    ...(post.updatedAt !== undefined ? { updatedAt: post.updatedAt } : {}),
  };
}
