import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { PostStatus } from '../../common/enums';
import { BlogService } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService (SCRUM-117 BLG-01 create post)', () => {
  let service: BlogService;

  const mockBlogPostModel = {
    create: jest.fn(),
  };
  const mockCommentModel = {};
  const mockLikeModel = {};
  const mockTagModel = {
    findOneAndUpdate: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: mockCommentModel },
        { provide: getModelToken(Like.name), useValue: mockLikeModel },
        { provide: getModelToken(Tag.name), useValue: mockTagModel },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('creates a DRAFT post without publishedAt when status is omitted', async () => {
    const userId = new Types.ObjectId().toHexString();
    const postId = new Types.ObjectId();

    mockBlogPostModel.create.mockImplementation(
      (payload: Record<string, unknown>) =>
        Promise.resolve({
          _id: postId,
          ...payload,
          createdAt: new Date('2026-11-19T12:00:00.000Z'),
          updatedAt: new Date('2026-11-19T12:00:00.000Z'),
        }),
    );

    const result = await service.createPost(userId, {
      title: 'My Draft Travel Notes',
      content: 'Planning a full two-week adventure across Italy and Greece.',
    });

    expect(result.id).toBe(postId.toHexString());
    expect(result.status).toBe(PostStatus.DRAFT);
    expect(result.publishedAt).toBeUndefined();
    expect(result.slug).toMatch(/^my-draft-travel-notes-[a-f0-9]{6}$/);
    expect(result.tags).toEqual([]);
    expect(mockTagModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('creates a PUBLISHED post, sets publishedAt, deduplicates and upserts tags', async () => {
    const userId = new Types.ObjectId().toHexString();
    const tagEgyptId = new Types.ObjectId();
    const tagTipsId = new Types.ObjectId();
    const postId = new Types.ObjectId();

    mockTagModel.findOneAndUpdate
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          _id: tagEgyptId,
          name: 'egypt',
          slug: 'egypt',
          usageCount: 1,
        }),
      })
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          _id: tagTipsId,
          name: 'travel tips',
          slug: 'travel-tips',
          usageCount: 3,
        }),
      });

    mockBlogPostModel.create.mockImplementation(
      (payload: Record<string, unknown>) =>
        Promise.resolve({
          _id: postId,
          ...payload,
        }),
    );

    const result = await service.createPost(userId, {
      title: 'Egypt Backpacking Essentials',
      content:
        'Carry cash for local transport and visit pyramids early morning.',
      status: PostStatus.PUBLISHED,
      tags: ['Egypt', '  egypt  ', 'Travel Tips', ''],
    });

    expect(mockTagModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(PostStatus.PUBLISHED);
    expect(result.publishedAt).toBeInstanceOf(Date);
    expect(result.tags).toEqual(['egypt', 'travel-tips']);
    expect(result.tagRefs).toEqual([
      tagEgyptId.toHexString(),
      tagTipsId.toHexString(),
    ]);
  });

  it('throws BadRequestException for punctuation-only tags', async () => {
    const userId = new Types.ObjectId().toHexString();

    await expect(
      service.createPost(userId, {
        title: 'Valid Post Title',
        content: 'Valid post content long enough for validation.',
        tags: ['!!!'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException for invalid user ID', async () => {
    await expect(
      service.createPost('invalid-id', {
        title: 'Valid Post Title',
        content: 'Valid post content long enough for validation.',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
