import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { PostStatus } from '../../common/enums';
import { UploadsService } from '../uploads/uploads.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BlogService } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService (SCRUM-130 BLG-08 posts by tag)', () => {
  let service: BlogService;

  const mockLean = jest.fn();
  const mockLimit = jest.fn();
  const mockSkip = jest.fn();
  const mockSort = jest.fn();
  const mockPopulate = jest.fn();
  const mockBlogPostModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
  };
  const mockTagModel = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockLean.mockResolvedValue([]);
    mockLimit.mockReturnValue({ lean: mockLean });
    mockSkip.mockReturnValue({ limit: mockLimit });
    mockSort.mockReturnValue({ skip: mockSkip });
    mockPopulate.mockReturnValue({ sort: mockSort });
    mockBlogPostModel.find.mockReturnValue({ populate: mockPopulate });
    mockBlogPostModel.countDocuments.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: {} },
        { provide: getModelToken(Like.name), useValue: {} },
        { provide: UploadsService, useValue: { deleteImage: jest.fn(), saveImage: jest.fn() } },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: getModelToken(Tag.name), useValue: mockTagModel },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('normalizes tag name/slug and returns published non-hidden posts matching the tag', async () => {
    const tagId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const authorId = new Types.ObjectId();

    mockTagModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: tagId,
        name: 'travel tips',
        slug: 'travel-tips',
        usageCount: 1,
      }),
    });
    mockLean.mockResolvedValue([
      {
        _id: postId,
        author: {
          _id: authorId,
          firstName: 'Abdullah',
          lastName: 'Emam',
        },
        title: 'Packing Light',
        content: 'How to pack carry-on only.',
        status: PostStatus.PUBLISHED,
        isHidden: false,
        tags: ['travel-tips'],
        tagRefs: [tagId],
        images: [],
        likesCount: 2,
        commentsCount: 0,
        attachedItinerary: null,
      },
    ]);
    mockBlogPostModel.countDocuments.mockResolvedValue(1);

    const result = await service.getPostsByTag('Travel%20Tips', {
      page: 1,
      limit: 20,
    });

    expect(mockBlogPostModel.find).toHaveBeenCalledWith({
      status: PostStatus.PUBLISHED,
      isHidden: false,
      $or: [
        { tags: { $in: ['travel-tips', 'travel tips'] } },
        { tagRefs: tagId },
      ],
    });
    expect(result.tag).toEqual({
      id: tagId.toHexString(),
      name: 'travel tips',
      slug: 'travel-tips',
      usageCount: 1,
    });
    expect(result.data).toHaveLength(1);
    expect(result.totalPages).toBe(1);
  });

  it('falls back to normalized tag metadata when Tag doc does not exist yet', async () => {
    mockTagModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const result = await service.getPostsByTag('Unknown Tag', {});

    expect(result.tag).toEqual({
      name: 'unknown tag',
      slug: 'unknown-tag',
    });
    expect(result.data).toEqual([]);
  });

  it('throws BadRequestException for empty or punctuation-only tag', async () => {
    await expect(service.getPostsByTag('   ', {})).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.getPostsByTag('!!!', {})).rejects.toThrow(
      BadRequestException,
    );
  });
});
