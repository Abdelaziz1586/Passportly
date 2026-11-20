import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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

describe('BlogService (SCRUM-121 BLG-04/BLG-08 update post)', () => {
  let service: BlogService;

  const mockBlogPostModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  const mockTagModel = {
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
    updateMany: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: {} },
        { provide: getModelToken(Like.name), useValue: {} },
        { provide: UploadsService, useValue: { deleteImage: jest.fn() } },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: getModelToken(Tag.name), useValue: mockTagModel },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('updates post fields, syncs Tag usageCounts, and sets publishedAt only on first publish', async () => {
    const authorId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const oldTagId = new Types.ObjectId();
    const keptTagId = new Types.ObjectId();
    const newTagId = new Types.ObjectId();

    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        author: authorId,
        title: 'Old Title',
        slug: 'old-title-111111',
        content: 'Old content here.',
        excerpt: 'Old content here.',
        status: PostStatus.DRAFT,
        isHidden: false,
        tags: ['old-tag', 'kept-tag'],
        tagRefs: [oldTagId, keptTagId],
        images: [],
        likesCount: 0,
        commentsCount: 0,
        publishedAt: undefined,
      }),
    });

    mockTagModel.findOneAndUpdate
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          _id: keptTagId,
          name: 'kept tag',
          slug: 'kept-tag',
        }),
      })
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          _id: newTagId,
          name: 'new tag',
          slug: 'new-tag',
        }),
      });

    mockTagModel.updateMany.mockResolvedValue({ modifiedCount: 1 });

    mockBlogPostModel.findByIdAndUpdate.mockImplementation(
      (_id: Types.ObjectId, update: { $set: Record<string, unknown> }) => ({
        lean: jest.fn().mockResolvedValue({
          _id: postId,
          author: authorId,
          title: update.$set.title,
          slug: update.$set.slug,
          content: 'Old content here.',
          status: update.$set.status,
          isHidden: false,
          tags: update.$set.tags,
          tagRefs: update.$set.tagRefs,
          images: [],
          likesCount: 0,
          commentsCount: 0,
          publishedAt: update.$set.publishedAt,
        }),
      }),
    );

    const result = await service.updatePost(
      postId.toHexString(),
      authorId.toHexString(),
      {
        title: 'New Title',
        status: PostStatus.PUBLISHED,
        tags: ['Kept Tag', 'New Tag'],
      },
    );

    expect(mockTagModel.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [newTagId] } },
      { $inc: { usageCount: 1 } },
    );
    expect(mockTagModel.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [oldTagId] }, usageCount: { $gt: 0 } },
      { $inc: { usageCount: -1 } },
    );
    expect(result.status).toBe(PostStatus.PUBLISHED);
    expect(result.publishedAt).toBeInstanceOf(Date);
    expect(result.tags).toEqual(['kept-tag', 'new-tag']);
  });

  it('does not overwrite existing publishedAt when already published', async () => {
    const authorId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const existingPublishedAt = new Date('2026-11-10T08:00:00.000Z');

    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        author: authorId,
        title: 'Published Title',
        content: 'Published content.',
        status: PostStatus.PUBLISHED,
        isHidden: false,
        tags: [],
        tagRefs: [],
        publishedAt: existingPublishedAt,
      }),
    });

    mockBlogPostModel.findByIdAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        author: authorId,
        title: 'Published Title',
        content: 'Updated content text.',
        status: PostStatus.PUBLISHED,
        isHidden: false,
        tags: [],
        tagRefs: [],
        images: [],
        likesCount: 0,
        commentsCount: 0,
        publishedAt: existingPublishedAt,
      }),
    });

    await service.updatePost(postId.toHexString(), authorId.toHexString(), {
      content: 'Updated content text.',
      status: PostStatus.PUBLISHED,
    });

    const updateCalls = mockBlogPostModel.findByIdAndUpdate.mock.calls as Array<
      [unknown, { $set: Record<string, unknown> }]
    >;
    expect(updateCalls[0][1].$set.publishedAt).toBeUndefined();
  });

  it('throws ForbiddenException when another user tries to update the post', async () => {
    const postId = new Types.ObjectId();
    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        author: new Types.ObjectId(),
      }),
    });

    await expect(
      service.updatePost(
        postId.toHexString(),
        new Types.ObjectId().toHexString(),
        { title: 'Hijack Attempt' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws BadRequestException on invalid ID or empty payload, and NotFoundException when missing', async () => {
    await expect(
      service.updatePost('bad-id', new Types.ObjectId().toHexString(), {
        title: 'Test',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.updatePost(
        new Types.ObjectId().toHexString(),
        new Types.ObjectId().toHexString(),
        {},
      ),
    ).rejects.toThrow(BadRequestException);

    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.updatePost(
        new Types.ObjectId().toHexString(),
        new Types.ObjectId().toHexString(),
        { title: 'Missing Post' },
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
