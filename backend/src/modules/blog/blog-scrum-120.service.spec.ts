import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { PostStatus, Role } from '../../common/enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { BlogService } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { User } from '../users/schemas/user.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService (SCRUM-120 BLG-02 get blog post details)', () => {
  let service: BlogService;

  const mockPostPopulateLean = jest.fn();
  const mockPostPopulate = jest.fn(() => ({ lean: mockPostPopulateLean }));
  const mockBlogPostModel = {
    findById: jest.fn(() => ({ populate: mockPostPopulate })),
  };

  const mockCommentsLean = jest.fn();
  const mockCommentsSort = jest.fn(() => ({ lean: mockCommentsLean }));
  const mockCommentsPopulate = jest.fn(() => ({ sort: mockCommentsSort }));
  const mockCommentModel = {
    find: jest.fn(() => ({ populate: mockCommentsPopulate })),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: mockCommentModel },
        { provide: getModelToken(Like.name), useValue: {} },
        { provide: UploadsService, useValue: { deleteImage: jest.fn() } },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn() },
        },
        { provide: getModelToken(User.name), useValue: {} },
        { provide: getModelToken(Tag.name), useValue: {} },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('returns published non-hidden post with author info and visible comments to guests', async () => {
    const postId = new Types.ObjectId();
    const authorId = new Types.ObjectId();
    const commenterId = new Types.ObjectId();
    const commentId = new Types.ObjectId();

    mockPostPopulateLean.mockResolvedValue({
      _id: postId,
      author: {
        _id: authorId,
        firstName: 'Abdullah',
        lastName: 'Emam',
        bio: 'Traveler',
      },
      title: 'Aswan Sunset',
      content: 'Sailing the Nile at sunset.',
      status: PostStatus.PUBLISHED,
      isHidden: false,
      tags: ['egypt'],
      tagRefs: [],
      images: [],
      likesCount: 1,
      commentsCount: 1,
      attachedItinerary: null,
    });
    mockCommentsLean.mockResolvedValue([
      {
        _id: commentId,
        post: postId,
        author: {
          _id: commenterId,
          firstName: 'Sara',
          lastName: 'Ali',
        },
        content: 'Loved this!',
        isHidden: false,
      },
    ]);

    const result = await service.getPost(postId.toHexString());

    expect(mockCommentModel.find).toHaveBeenCalledWith({
      post: postId,
      isHidden: false,
    });
    expect(result.id).toBe(postId.toHexString());
    expect(result.author).toEqual({
      id: authorId.toHexString(),
      firstName: 'Abdullah',
      lastName: 'Emam',
      bio: 'Traveler',
    });
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].content).toBe('Loved this!');
  });

  it('allows author to view their own DRAFT post, while hiding it from others and guests', async () => {
    const postId = new Types.ObjectId();
    const authorId = new Types.ObjectId();
    const otherUserId = new Types.ObjectId();

    mockPostPopulateLean.mockResolvedValue({
      _id: postId,
      author: { _id: authorId, firstName: 'Abdullah', lastName: 'Emam' },
      title: 'Draft Notes',
      content: 'Unpublished notes.',
      status: PostStatus.DRAFT,
      isHidden: false,
      tags: [],
      tagRefs: [],
      images: [],
      likesCount: 0,
      commentsCount: 0,
      attachedItinerary: null,
    });
    mockCommentsLean.mockResolvedValue([]);

    await expect(service.getPost(postId.toHexString())).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.getPost(postId.toHexString(), {
        userId: otherUserId.toHexString(),
        email: 'other@example.com',
        role: Role.REGISTERED_USER,
        jti: 'jti-2',
      }),
    ).rejects.toThrow(NotFoundException);

    const authorResult = await service.getPost(postId.toHexString(), {
      userId: authorId.toHexString(),
      email: 'abdullah@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    });
    expect(authorResult.status).toBe(PostStatus.DRAFT);
  });

  it('hides moderated posts (isHidden: true) from public guests and non-admins', async () => {
    const postId = new Types.ObjectId();
    const authorId = new Types.ObjectId();

    mockPostPopulateLean.mockResolvedValue({
      _id: postId,
      author: { _id: authorId, firstName: 'Abdullah', lastName: 'Emam' },
      title: 'Moderated Post',
      content: 'Hidden content.',
      status: PostStatus.PUBLISHED,
      isHidden: true,
      tags: [],
      tagRefs: [],
      images: [],
      likesCount: 0,
      commentsCount: 0,
      attachedItinerary: null,
    });

    await expect(service.getPost(postId.toHexString())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws BadRequestException on invalid ObjectId and NotFoundException when missing', async () => {
    await expect(service.getPost('invalid-id')).rejects.toThrow(
      BadRequestException,
    );

    mockPostPopulateLean.mockResolvedValue(null);
    await expect(
      service.getPost(new Types.ObjectId().toHexString()),
    ).rejects.toThrow(NotFoundException);
  });
});
