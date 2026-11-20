import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { PostStatus } from '../../common/enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { BlogService } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService', () => {
  let service: BlogService;

  const mockLimit = jest.fn();
  const mockSkip = jest.fn();
  const mockSort = jest.fn();
  const mockPopulate = jest.fn();
  const mockLean = jest.fn();

  const mockBlogPostModel = {
    create: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
  };
  const mockCommentModel = {};
  const mockLikeModel = {};
  const mockTagModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockLean.mockResolvedValue([]);
    mockLimit.mockReturnValue({ lean: mockLean });
    mockSkip.mockReturnValue({ limit: mockLimit });
    mockSort.mockReturnValue({ skip: mockSkip });
    mockPopulate.mockReturnValue({ sort: mockSort });
    mockBlogPostModel.find.mockReturnValue({
      sort: mockSort,
      populate: mockPopulate,
    });
    mockBlogPostModel.countDocuments.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: mockCommentModel },
        { provide: getModelToken(Like.name), useValue: mockLikeModel },
        { provide: UploadsService, useValue: { deleteImage: jest.fn() } },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: getModelToken(Tag.name), useValue: mockTagModel },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('returns both drafts and published posts for current user when status is omitted', async () => {
    const userId = new Types.ObjectId().toHexString();
    const draftId = new Types.ObjectId();
    const publishedId = new Types.ObjectId();

    mockLean.mockResolvedValue([
      {
        _id: draftId,
        author: new Types.ObjectId(userId),
        title: 'Draft Trip',
        content: 'Draft content here.',
        status: PostStatus.DRAFT,
        isHidden: false,
        tags: [],
        tagRefs: [],
        images: [],
        likesCount: 0,
        commentsCount: 0,
        attachedItinerary: null,
      },
      {
        _id: publishedId,
        author: new Types.ObjectId(userId),
        title: 'Published Trip',
        content: 'Published content here.',
        status: PostStatus.PUBLISHED,
        isHidden: false,
        tags: ['egypt'],
        tagRefs: [],
        images: [],
        likesCount: 3,
        commentsCount: 1,
        attachedItinerary: null,
      },
    ]);
    mockBlogPostModel.countDocuments.mockResolvedValue(2);

    const result = await service.listMyPosts(userId, { page: 1, limit: 20 });

    expect(mockBlogPostModel.find).toHaveBeenCalledWith({
      author: new Types.ObjectId(userId),
    });
    expect(result.total).toBe(2);
    expect(result.data.map((p) => p.status)).toEqual([
      PostStatus.DRAFT,
      PostStatus.PUBLISHED,
    ]);
  });

  it('filters by optional status when provided', async () => {
    const userId = new Types.ObjectId().toHexString();

    await service.listMyPosts(userId, {
      status: PostStatus.DRAFT,
      page: 2,
      limit: 5,
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });

    expect(mockBlogPostModel.find).toHaveBeenCalledWith({
      author: new Types.ObjectId(userId),
      status: PostStatus.DRAFT,
    });
    expect(mockSort).toHaveBeenCalledWith({ createdAt: 1, _id: 1 });
    expect(mockSkip).toHaveBeenCalledWith(5);
    expect(mockLimit).toHaveBeenCalledWith(5);
  });

  it('throws BadRequestException for invalid user ID in listMyPosts', async () => {
    await expect(service.listMyPosts('invalid-id', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lists only PUBLISHED and non-hidden posts with author info and pagination', async () => {
    const authorId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const publishedAt = new Date('2026-11-18T10:00:00.000Z');

    mockLean.mockResolvedValue([
      {
        _id: postId,
        author: {
          _id: authorId,
          firstName: 'Abdullah',
          lastName: 'Emam',
          avatarUrl: '/uploads/avatar.png',
        },
        title: 'Luxor Guide',
        slug: 'luxor-guide-abc123',
        content: 'Full Luxor guide content.',
        excerpt: 'Full Luxor guide content.',
        status: PostStatus.PUBLISHED,
        isHidden: false,
        tags: ['egypt'],
        tagRefs: [],
        images: [],
        likesCount: 4,
        commentsCount: 2,
        attachedItinerary: null,
        publishedAt,
      },
    ]);
    mockBlogPostModel.countDocuments.mockResolvedValue(1);

    const result = await service.listPosts({ page: 1, limit: 20 });

    expect(mockBlogPostModel.find).toHaveBeenCalledWith({
      status: PostStatus.PUBLISHED,
      isHidden: false,
    });
    expect(mockPopulate).toHaveBeenCalledWith(
      'author',
      'firstName lastName avatarUrl',
    );
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.data[0].id).toBe(postId.toHexString());
    expect(result.data[0].author).toEqual({
      id: authorId.toHexString(),
      firstName: 'Abdullah',
      lastName: 'Emam',
      avatarUrl: '/uploads/avatar.png',
    });
  });

  it('combines author, tag, and escaped keyword search filters with $and', async () => {
    const authorId = new Types.ObjectId().toHexString();
    const tagId = new Types.ObjectId();

    mockTagModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: tagId }),
      }),
    });

    await service.listPosts({
      author: authorId,
      tag: 'Travel Tips',
      search: 'cairo (2026)+',
      page: 2,
      limit: 5,
      sortBy: 'likesCount',
      sortOrder: 'asc',
    });

    const calls = mockBlogPostModel.find.mock.calls as Array<
      [{ $and: unknown[] }]
    >;
    const calledFilter = calls[0][0];
    expect(calledFilter.$and).toHaveLength(4);
    expect(calledFilter.$and[0]).toEqual({
      status: PostStatus.PUBLISHED,
      isHidden: false,
    });
    expect(calledFilter.$and[1]).toEqual({
      author: new Types.ObjectId(authorId),
    });
    expect(mockSort).toHaveBeenCalledWith({ likesCount: 1, _id: 1 });
    expect(mockSkip).toHaveBeenCalledWith(5);
    expect(mockLimit).toHaveBeenCalledWith(5);
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
