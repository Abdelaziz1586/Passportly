import { BadRequestException, NotFoundException } from '@nestjs/common';
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
import { User } from '../users/schemas/user.schema';
import { Itinerary } from '../itineraries/schemas/itinerary.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService (SCRUM-123 BLG-05 add comment)', () => {
  let service: BlogService;

  const mockBlogPostModel = {
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const mockCommentModel = {
    create: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockBlogPostModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: mockCommentModel },
        { provide: getModelToken(Like.name), useValue: {} },
        {
          provide: UploadsService,
          useValue: { deleteImage: jest.fn(), saveImage: jest.fn() },
        },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn() },
        },
        { provide: getModelToken(User.name), useValue: {} },
        { provide: getModelToken(Itinerary.name), useValue: {} },
        { provide: getModelToken(Tag.name), useValue: {} },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('atomically increments commentsCount and creates comment on published non-hidden post', async () => {
    const postId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const commentId = new Types.ObjectId();

    mockBlogPostModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        status: PostStatus.PUBLISHED,
        isHidden: false,
        commentsCount: 1,
      }),
    });

    mockCommentModel.create.mockImplementation(
      (payload: Record<string, unknown>) =>
        Promise.resolve({
          _id: commentId,
          ...payload,
        }),
    );

    const result = await service.addComment(
      postId.toHexString(),
      userId.toHexString(),
      { content: 'Awesome post!' },
    );

    expect(mockBlogPostModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: postId.toHexString(),
        status: PostStatus.PUBLISHED,
        isHidden: false,
      },
      { $inc: { commentsCount: 1 } },
      { returnDocument: 'after' },
    );
    expect(result).toEqual({
      id: commentId.toHexString(),
      post: postId.toHexString(),
      author: userId.toHexString(),
      content: 'Awesome post!',
      isHidden: false,
    });
  });

  it('throws NotFoundException when post is draft, hidden, or missing', async () => {
    mockBlogPostModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.addComment(
        new Types.ObjectId().toHexString(),
        new Types.ObjectId().toHexString(),
        { content: 'Test' },
      ),
    ).rejects.toThrow(NotFoundException);
    expect(mockCommentModel.create).not.toHaveBeenCalled();
  });

  it('rolls back commentsCount if Comment creation fails', async () => {
    const postId = new Types.ObjectId();
    mockBlogPostModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        status: PostStatus.PUBLISHED,
        isHidden: false,
      }),
    });
    mockCommentModel.create.mockRejectedValue(new Error('DB write error'));

    await expect(
      service.addComment(
        postId.toHexString(),
        new Types.ObjectId().toHexString(),
        { content: 'Test' },
      ),
    ).rejects.toThrow('DB write error');

    expect(mockBlogPostModel.updateOne).toHaveBeenCalledWith(
      { _id: postId, commentsCount: { $gt: 0 } },
      { $inc: { commentsCount: -1 } },
    );
  });

  it('throws BadRequestException on invalid IDs', async () => {
    await expect(
      service.addComment('bad-post', new Types.ObjectId().toHexString(), {
        content: 'Test',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.addComment(new Types.ObjectId().toHexString(), 'bad-user', {
        content: 'Test',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
