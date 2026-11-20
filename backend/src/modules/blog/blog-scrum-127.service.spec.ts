import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { BlogService } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService (SCRUM-127 BLG-06 unlike post)', () => {
  let service: BlogService;

  const mockBlogPostModel = {
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const mockLikeModel = {
    findOneAndDelete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: {} },
        { provide: getModelToken(Like.name), useValue: mockLikeModel },
        { provide: UploadsService, useValue: { deleteImage: jest.fn(), saveImage: jest.fn() } },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: getModelToken(Tag.name), useValue: {} },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  it('removes Like and decrements BlogPost.likesCount when a like existed', async () => {
    const postId = new Types.ObjectId();
    const userId = new Types.ObjectId();

    mockBlogPostModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: postId, likesCount: 4 }),
      }),
    });
    mockLikeModel.findOneAndDelete.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        post: postId,
        user: userId,
      }),
    });
    mockBlogPostModel.findOneAndUpdate.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: postId, likesCount: 3 }),
      }),
    });

    const result = await service.unlikePost(
      postId.toHexString(),
      userId.toHexString(),
    );

    expect(mockLikeModel.findOneAndDelete).toHaveBeenCalledWith({
      post: postId,
      user: userId,
    });
    expect(mockBlogPostModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: postId, likesCount: { $gt: 0 } },
      { $inc: { likesCount: -1 } },
      { returnDocument: 'after' },
    );
    expect(result).toEqual({
      message: 'Like removed successfully',
      postId: postId.toHexString(),
      liked: false,
      likesCount: 3,
    });
  });

  it('does not decrement likesCount when user had not liked the post', async () => {
    const postId = new Types.ObjectId();
    const userId = new Types.ObjectId();

    mockBlogPostModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: postId, likesCount: 4 }),
      }),
    });
    mockLikeModel.findOneAndDelete.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const result = await service.unlikePost(
      postId.toHexString(),
      userId.toHexString(),
    );

    expect(mockBlogPostModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: 'No active like found for this post',
      postId: postId.toHexString(),
      liked: false,
      likesCount: 4,
    });
  });

  it('throws NotFoundException when post does not exist and BadRequestException on invalid IDs', async () => {
    await expect(
      service.unlikePost('bad-post', new Types.ObjectId().toHexString()),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.unlikePost(new Types.ObjectId().toHexString(), 'bad-user'),
    ).rejects.toThrow(BadRequestException);

    mockBlogPostModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    await expect(
      service.unlikePost(
        new Types.ObjectId().toHexString(),
        new Types.ObjectId().toHexString(),
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
